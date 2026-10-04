# -*- coding: utf-8 -*-
"""
底图故障效果（glitch）
======================

贴纸**本身不改**。这套效果只作用在**底图**上：段位越高，底图越崩。

三种成分逐级叠加（不是同时出现）
--------------------------------
    色散（R/B 通道分离）  ── 所有有特效的段位都有，越难越明显
      └─ 水平切片错位     ── 强度超过 ``SLICE_FROM`` 才开始出现
           └─ 块状撕裂    ── 强度超过 ``BLOCK_FROM`` 才开始出现，最崩

段位 → 强度阶梯
---------------
四组（4k / 4kln / 7k / 7kln）是**平行且互不关联**的：每组各自独立地从
「轻微」走到「严重」，都覆盖 ``LADDER_LOW`` ~ ``LADDER_HIGH``。
不是一条贯穿四组的大斜坡。

``切片`` / ``块状`` 由组内线性推进的总强度决定；``色散`` 另有自己的曲线
（见 ``EFFECT_GROUPS`` 的第三个字段）：

* ``"linear"`` —— 色散跟着总强度线性涨；
* ``"steep"``  —— **前段陡、后段匀**：从组内第 1 张到第
  ``CHROMA_KINK_INDEX + 1`` 张色散猛涨（4k 就是 gamma → epsilon），
  之后每张等步长缓慢推进。这是 4k 组专用的手感。

四组配置：

===========  ==========================================  ============
组            贴纸（各自由轻到重）                             色散曲线
===========  ==========================================  ============
4k           gamma → kappa                                steep
4kln         ln-14 → ln-17                                linear
7k           7-gamma → 7-stellium                         linear
7kln         7-ln-gamma → 7-ln-stellium                   linear
===========  ==========================================  ============

不在表里的贴纸一律 0（底图保持原样）。
"""

from __future__ import annotations

import os
import random
import zlib

import numpy as np
from PIL import Image

__all__ = [
    "EFFECT_GROUPS",
    "LADDER_LOW",
    "LADDER_HIGH",
    "SLICE_FROM",
    "BLOCK_FROM",
    "COMPONENT_NAMES",
    "intensity_for",
    "components_for",
    "components_for_sticker",
    "normalize_components",
    "glitch_frame",
    "seed_for",
    "describe_ladder",
    "find_sticker",
]

# --------------------------------------------------------------------------
# 阶梯配置（想调手感就改这里）
# --------------------------------------------------------------------------

#: (组名, 贴纸名（各自由轻到重）, 色散曲线 "steep" / "linear")
EFFECT_GROUPS = (
    ("4k", (
        "gamma", "delta", "epsilon", "zeta", "eta", "theta", "iota", "kappa",
    ), "steep"),
    ("4kln", (
        "ln-14", "ln-15", "ln-16", "ln-17",
    ), "linear"),
    ("7k", (
        "7-gamma", "7-azimuth", "7-zenith", "7-stellium",
    ), "linear"),
    ("7kln", (
        "7-ln-gamma", "7-ln-azimuth", "7-ln-zenith", "7-ln-stellium",
    ), "linear"),
)

#: 每一组自己从「最轻」走到「最崩」的总强度端点（四组一样）
LADDER_LOW = 0.10
LADDER_HIGH = 1.00

#: 总强度超过这个值才开始出现「水平切片错位」
SLICE_FROM = 0.32

#: 总强度超过这个值才开始出现「块状撕裂」（最崩的一层）
BLOCK_FROM = 0.72

#: 三种成分的固定顺序（对外接口、命令行都用这个顺序）
COMPONENT_NAMES = ("色散", "切片", "块状")

# --- 色散曲线参数（只对 "steep" 的组生效）---------------------------------

#: 组内第 1 张的色散强度（轻微但要看得见）
CHROMA_START = 0.12

#: 拐点在第几张（0 起算）。4k 要的是 gamma(0) → epsilon(2)，所以是 2
CHROMA_KINK_INDEX = 2

#: 到拐点时色散已经涨到多少，剩下的匀给后面几张
CHROMA_KINK_VALUE = 0.60

# --- 色散像素量 ------------------------------------------------------------

#: 色散偏移量占画面宽度的比例，随色散强度从 MIN 线性长到 MAX
CHROMA_MIN = 0.0025
CHROMA_MAX = 0.0165

#: 色散的垂直分量（相对水平分量的比例）
CHROMA_Y_RATIO = 0.35


def _clamp01(value) -> float:
    return min(1.0, max(0.0, float(value)))


def _ramp(value, start):
    """value 从 start 涨到 1.0 时，输出从 0 涨到 1。"""
    if value <= start:
        return 0.0
    return min(1.0, (value - start) / (1.0 - start))


# --------------------------------------------------------------------------
# 强度查表
# --------------------------------------------------------------------------

def _stem(sticker) -> str:
    """从路径或文件名里取出贴纸名（小写、不含后缀）。"""
    return os.path.splitext(os.path.basename(str(sticker)))[0].strip().lower()


def _lookup(sticker):
    """返回 ``(组名, 贴纸名列表, 组内下标, 色散曲线)``；不在表里返回 None。"""
    name = _stem(sticker)
    for group, names, curve in EFFECT_GROUPS:
        if name in names:
            return group, names, names.index(name), curve
    return None


def find_sticker(key):
    """
    按关键字找贴纸名，供聊天指令用。支持精确名、也支持唯一前缀/片段。

    >>> find_sticker("kappa")
    'kappa'
    >>> find_sticker("7-ln-zen")
    '7-ln-zenith'
    >>> find_sticker("不存在")
    """
    text = str(key).strip().lower()
    all_names = [n for _g, names, _c in EFFECT_GROUPS for n in names]
    if text in all_names:
        return text
    hits = [n for n in all_names if text and text in n]
    if len(hits) == 1:
        return hits[0]
    return None


def ladder_names():
    """按阶梯顺序列出所有有特效的贴纸名。"""
    return [n for _g, names, _c in EFFECT_GROUPS for n in names]


def intensity_for(sticker) -> float:
    """
    按贴纸名查「总强度」，返回 0.0 ~ 1.0（组内线性推进）。
    不在表里的贴纸返回 0.0。它负责驱动切片 / 块状。

    >>> intensity_for("dan/gamma.png")
    0.1
    >>> intensity_for("dan/kappa.png")
    1.0
    >>> intensity_for("dan/ln-14.svg")
    0.1
    """
    found = _lookup(sticker)
    if found is None:
        return 0.0
    _group, names, index, _curve = found
    if len(names) == 1:
        return LADDER_HIGH
    span = LADDER_HIGH - LADDER_LOW
    return round(LADDER_LOW + span * index / (len(names) - 1), 4)


def _chroma_for(index, count, curve):
    """组内第 index 张的色散强度。"""
    if count <= 1:
        return LADDER_HIGH
    if curve != "steep":
        span = LADDER_HIGH - LADDER_LOW
        return LADDER_LOW + span * index / (count - 1)

    kink = min(CHROMA_KINK_INDEX, count - 1)
    if index <= kink:
        if kink == 0:
            return CHROMA_KINK_VALUE
        step = (CHROMA_KINK_VALUE - CHROMA_START) / kink
        return CHROMA_START + step * index
    tail = (count - 1) - kink
    if tail <= 0:
        return CHROMA_KINK_VALUE
    step = (1.0 - CHROMA_KINK_VALUE) / tail
    return CHROMA_KINK_VALUE + step * (index - kink)


def components_for_sticker(sticker):
    """
    按贴纸名算出三种成分各自的强度（自动模式用这个）。

    >>> round(components_for_sticker("gamma")["色散"], 3)
    0.12
    >>> round(components_for_sticker("epsilon")["色散"], 3)
    0.6
    >>> round(components_for_sticker("zeta")["色散"], 3)
    0.68
    >>> components_for_sticker("alpha")
    {'色散': 0.0, '切片': 0.0, '块状': 0.0}
    """
    found = _lookup(sticker)
    if found is None:
        return {name: 0.0 for name in COMPONENT_NAMES}
    _group, names, index, curve = found
    intensity = intensity_for(names[index])
    return {
        "色散": round(_chroma_for(index, len(names), curve), 4),
        "切片": round(_ramp(intensity, SLICE_FROM), 4),
        "块状": round(_ramp(intensity, BLOCK_FROM), 4),
    }


def components_for(intensity):
    """
    把「总强度」拆成三种成分各自的强度（手动模式用这个）。
    色散跟着总强度线性走。

    >>> components_for(0.2)["切片"]
    0.0
    >>> round(components_for(1.0)["块状"], 3)
    1.0
    """
    value = _clamp01(intensity)
    if value <= 0.0:
        return {name: 0.0 for name in COMPONENT_NAMES}
    return {
        "色散": value,
        "切片": round(_ramp(value, SLICE_FROM), 4),
        "块状": round(_ramp(value, BLOCK_FROM), 4),
    }


def normalize_components(value):
    """
    把各种写法统一成 ``{"色散":x, "切片":y, "块状":z}``。

    支持：``None`` / dict / 3 元序列 / ``"0.5,0.3,0.2"`` 字符串。
    缺的按 0 处理。
    """
    if value is None:
        return {name: 0.0 for name in COMPONENT_NAMES}
    if isinstance(value, dict):
        source = value
    elif isinstance(value, (list, tuple)):
        source = dict(zip(COMPONENT_NAMES, value))
    elif isinstance(value, str):
        parts = [p for p in value.replace("，", ",").split(",") if p.strip()]
        source = dict(zip(COMPONENT_NAMES, parts))
    else:
        source = {"色散": value}

    out = {}
    for name in COMPONENT_NAMES:
        raw = source.get(name, 0.0)
        if isinstance(raw, str) and raw.strip().lower() in ("", "auto", "a", "-"):
            out[name] = 0.0
        else:
            out[name] = round(_clamp01(float(raw)), 4)
    return out


def seed_for(sticker, frame_index=0, salt=0) -> int:
    """
    生成稳定的随机种子。

    同一张贴纸 + 同一帧永远得到同一个结果（可复现），
    但不同贴纸、不同帧之间互不相同 —— 这样故障图案会逐帧抖动，
    看起来才像真的信号出了问题。
    """
    base = zlib.crc32(_stem(sticker).encode("utf-8")) & 0xFFFFFFFF
    return (base * 1000003 + frame_index * 7919 + salt * 104729) & 0xFFFFFFFF


# --------------------------------------------------------------------------
# 三种成分
# --------------------------------------------------------------------------

def _shift_clamp(arr, dx, dy):
    """平移数组，越界处用边缘像素补齐（不留黑边）。"""
    height, width = arr.shape[:2]
    ys = np.clip(np.arange(height) - int(dy), 0, height - 1)
    xs = np.clip(np.arange(width) - int(dx), 0, width - 1)
    return arr[ys][:, xs]


def _chromatic(arr, dx, dy):
    """色散：R 往一个方向、B 往另一个方向拉，G 和 A 不动。"""
    dx, dy = int(round(dx)), int(round(dy))
    if dx == 0 and dy == 0:
        return arr
    out = arr.copy()
    out[..., 0] = _shift_clamp(arr, -dx, -dy)[..., 0]   # R
    out[..., 2] = _shift_clamp(arr, dx, dy)[..., 2]     # B
    return out


def _slices(arr, strength, rng):
    """水平切片错位：随机抽若干横条整体平移。"""
    height, width = arr.shape[:2]
    count = int(round(2 + strength * 9))
    for _ in range(count):
        band_h = max(1, int(rng.uniform(0.008, 0.045) * height))
        top = rng.randrange(0, max(1, height - band_h))
        dx = int(round(rng.uniform(-1, 1) * strength * 0.055 * width))
        if dx == 0:
            continue
        band = arr[top:top + band_h]
        arr[top:top + band_h] = _shift_clamp(band, dx, 0)
    return arr


def _blocks(arr, strength, rng):
    """块状撕裂 + 偏色块：随机小方块被平移、被压亮/压暗、被拉偏某个通道。"""
    height, width = arr.shape[:2]
    count = int(round(2 + strength * 16))
    for _ in range(count):
        block_w = max(2, int(rng.uniform(0.03, 0.20) * width))
        block_h = max(1, int(rng.uniform(0.004, 0.03) * height))
        left = rng.randrange(0, max(1, width - block_w))
        top = rng.randrange(0, max(1, height - block_h))
        block = arr[top:top + block_h, left:left + block_w]

        roll = int(round(rng.uniform(-1, 1) * strength * 0.05 * width))
        if roll:
            block = _shift_clamp(block, roll, 0)

        if rng.random() < 0.55:                       # 亮度撕裂
            block = block * rng.uniform(0.50, 1.35)

        if rng.random() < 0.50:                       # 通道偏色
            channel = rng.randrange(3)
            block = block.copy()
            block[..., channel] = (
                block[..., channel] * rng.uniform(1.30, 1.90)
                + rng.uniform(10.0, 40.0)
            )

        arr[top:top + block_h, left:left + block_w] = np.clip(block, 0, 255)
    return arr


# --------------------------------------------------------------------------
# 对外接口
# --------------------------------------------------------------------------

def glitch_frame(image, intensity=0.0, seed=0, components=None):
    """
    对**底图的一帧**施加故障效果。

    :param image: 底图帧（任意模式，内部转 RGBA）
    :param intensity: 0.0 ~ 1.0 的总强度（``components`` 给定时忽略）
    :param seed: 随机种子，逐帧换一个就能得到"信号抖动"的动感
    :param components: 直接指定三种成分，比如 ``{"色散":0.8,"切片":0.4,"块状":0}``；
                       给了它就不再按 ``intensity`` 换算
    :returns: 新的 RGBA 图像（不修改传入的 image）
    """
    parts = (normalize_components(components) if components is not None
             else components_for(intensity))
    frame = image.convert("RGBA")
    if not any(v > 0 for v in parts.values()):
        return frame

    rng = random.Random(seed)
    arr = np.asarray(frame, dtype=np.float32)

    # 1) 色散 —— 永远先来这一层
    chroma = parts["色散"]
    if chroma > 0:
        spread = (CHROMA_MIN + (CHROMA_MAX - CHROMA_MIN) * chroma) * arr.shape[1]
        arr = _chromatic(arr, spread, spread * CHROMA_Y_RATIO)

    # 2) 水平切片错位
    if parts["切片"] > 0:
        arr = _slices(arr, parts["切片"], rng)

    # 3) 块状撕裂
    if parts["块状"] > 0:
        arr = _blocks(arr, parts["块状"], rng)

    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGBA")


def describe_ladder():
    """给调试程序 / 机器人用：把整张阶梯表渲染成几行文本。"""
    lines = []
    for group, names, curve in EFFECT_GROUPS:
        lines.append(f"  [{group}]  {len(names)} 张 · 色散曲线 {curve}")
        for name in names:
            parts = components_for_sticker(name)
            active = " + ".join(
                f"{k}{v:.2f}" for k, v in parts.items() if v > 0
            ) or "无"
            lines.append(
                f"      {name:<16} 总强度 {intensity_for(name):.2f}   {active}"
            )
    lines.append("  其他贴纸             0.00   （底图不动）")
    return "\n".join(lines)
