# -*- coding: utf-8 -*-
"""
贴纸合成工具
============

把贴纸贴到目标图片（静态图或 GIF 动画）的**正中央**。

支持情况
--------
* 目标图片：``.gif`` / ``.png`` / ``.jpg`` / ``.jpeg``（静态图与 GIF 动画都行）
* 贴纸：``.png`` / ``.jpg`` / ``.jpeg`` / ``.webp`` / ``.bmp`` / ``.svg``
  —— SVG 由 :mod:`svg_raster` 负责栅格化，用法上和 PNG 完全一样

主要行为
--------
* 贴纸等比缩放后居中；缩放采用 "contain"（完整放进主图，不裁切、不变形）。
  贴纸长宽比 ≥ 主图长宽比时，结果与"贴纸与主图等高"完全一致。
* **贴纸大小可调**：默认 75%，范围 50% ~ 125%。
  100% = 贴纸刚好铺满主图（旧版行为），125% 会超出画面被裁边。
* **底图故障效果**：段位越高的贴纸，底图崩得越厉害（贴纸本身不变）。
  详见 :mod:`glitch` —— 色散 → 水平切片 → 块状撕裂，逐级叠加。
* GIF 逐帧粘贴，并**保留每一帧自己的时长**与原始循环次数；
  底图故障**逐帧抖动**，动起来才像信号出了问题。
* 输出文件名 = ``输出目录/<主图名>_<贴纸名><主图后缀>``。

用法
----
直接改下面「仅修改这 5 个参数」的五个常量，然后 ``python init.py``。
"""

from __future__ import annotations

import os
import sys

from PIL import Image

from svg_raster import (
    SVG_EXTENSIONS,
    SvgRenderError,
    is_svg,
    load_svg,
    svg_intrinsic_size,
)
import glitch as glitch_fx

# --------------------------------------------------------------------------
# 常量
# --------------------------------------------------------------------------

#: 可以作为"主图"的格式
SUPPORTED_MAIN_FORMATS = (".gif", ".png", ".jpg", ".jpeg", ".webp", ".bmp")

#: 可以作为"贴纸"的格式（SVG 也在内）
SUPPORTED_STICKER_FORMATS = (
    ".png",
    ".jpg",
    ".jpeg",
    ".webp",
    ".bmp",
) + tuple(sorted(SVG_EXTENSIONS))

#: GIF 某帧没有 duration 信息时的兜底值（毫秒）
DEFAULT_FRAME_DURATION = 100

#: 缩放方式：``contain`` = 完整放进主图；``height`` = 老逻辑（贴纸与主图等高）
DEFAULT_FIT = "contain"

#: 贴纸大小（相对主图的缩放比例）。100% = 贴纸刚好铺满主图（即旧版行为）
STICKER_SIZE_MIN = 0.50
STICKER_SIZE_MAX = 1.25
DEFAULT_STICKER_SIZE = 0.75


def parse_size(value):
    """
    把用户输入的"贴纸大小"统一解析成 0.5 ~ 1.25 的比例。

    三种写法都认：

    * ``75``   -> 0.75（不带 % 的百分数，最常用）
    * ``"75%"`` -> 0.75（带了 % 也照样认）
    * ``0.75`` -> 0.75（直接写比例）

    区分规则：合法范围是 50%~125%，也就是 0.5~1.25；所以大于 2 的一律
    当成百分数处理。超出范围直接报错，不再猜。
    """
    if isinstance(value, bool):
        raise ValueError(f"贴纸大小不接受布尔值：{value!r}")

    if isinstance(value, (int, float)):
        number = float(value)
    else:
        text = str(value).strip()
        if text.endswith("%"):
            text = text[:-1].strip()
        try:
            number = float(text)
        except ValueError:
            raise ValueError(
                f"看不懂的贴纸大小：{value!r}（可以写 75 / 75% / 0.75）"
            ) from None

    if number > 2.0:
        number /= 100.0

    if not (STICKER_SIZE_MIN <= number <= STICKER_SIZE_MAX + 1e-9):
        raise ValueError(
            f"贴纸大小超出范围：{value!r} -> {number:.0%}，"
            f"允许 {STICKER_SIZE_MIN:.0%} ~ {STICKER_SIZE_MAX:.0%}"
        )
    return round(number, 6)


def ensure_utf8_stdio():
    """
    让日志里的 emoji / 中文在 Windows 上不会把脚本搞崩。

    控制台直连时 Python 走 UTF-8，没问题；但一旦输出被重定向
    （``python init.py > log.txt``、被别的程序调用等），stdout 会退回
    系统 ANSI 代码页（简体中文是 GBK），print emoji 就会抛
    ``UnicodeEncodeError``。
    """
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is None:
            continue
        try:
            reconfigure(encoding="utf-8", errors="replace")
        except (ValueError, OSError):
            pass


# --------------------------------------------------------------------------
# 贴纸加载与缩放
# --------------------------------------------------------------------------

def _fit_size(main_w, main_h, sticker_w, sticker_h, fit="contain", scale_percent=1.0):
    """算出贴纸贴上去之后的像素尺寸，保持长宽比。"""
    if sticker_w <= 0 or sticker_h <= 0:
        raise ValueError(f"贴纸尺寸不合法：{sticker_w}x{sticker_h}")

    if fit == "height":
        # 老逻辑：贴纸高度 == 主图高度（贴纸比主图"宽"时会溢出被裁掉）
        base = main_h / sticker_h
    elif fit == "contain":
        # 完整放进主图；贴纸长宽比 >= 主图长宽比时与 height 等价
        base = min(main_w / sticker_w, main_h / sticker_h)
    else:
        raise ValueError(f"未知的缩放方式：{fit!r}（可选 'contain' 或 'height'）")

    # scale_percent = 1.0 时就是"铺满主图"；0.75 就是只铺 75%
    scale = base * scale_percent
    return max(1, int(round(sticker_w * scale))), max(1, int(round(sticker_h * scale)))


def load_sticker(sticker_path, size, resample=Image.Resampling.LANCZOS):
    """
    读取贴纸并缩放到 ``size``，返回 RGBA 图像。

    PNG / JPG / ... 走 Pillow；SVG 走 :mod:`svg_raster`。
    SVG 直接按目标尺寸栅格化，比"先渲染成大图再缩小"更清晰、也更快。
    """
    ext = os.path.splitext(sticker_path)[1].lower()
    width, height = int(size[0]), int(size[1])

    if ext in SVG_EXTENSIONS:
        # 让 librsvg / cairosvg 直接按目标像素渲染
        return load_svg(sticker_path, (width, height))

    with Image.open(sticker_path) as opened:
        sticker = opened.convert("RGBA")
        if sticker.size != (width, height):
            sticker = sticker.resize((width, height), resample)
        return sticker


def sticker_pixel_size(sticker_path, main_size, fit=DEFAULT_FIT, scale_percent=DEFAULT_STICKER_SIZE):
    """
    返回 ``(目标宽, 目标高, 居中坐标 x, 居中坐标 y)``。

    这里会先拿到贴纸的"原始尺寸"—— PNG 用 Pillow 读，SVG 用 viewBox 算，
    因为 SVG 本身没有像素尺寸。

    :param scale_percent: 贴纸大小比例，``1.0`` = 铺满主图
    """
    main_w, main_h = main_size

    if is_svg(sticker_path):
        intrinsic = svg_intrinsic_size(sticker_path)
        if intrinsic is None:
            intrinsic = (main_w, main_h)
        sticker_w, sticker_h = intrinsic
    else:
        with Image.open(sticker_path) as opened:
            sticker_w, sticker_h = opened.size

    new_w, new_h = _fit_size(main_w, main_h, sticker_w, sticker_h, fit, scale_percent)
    return new_w, new_h, (main_w - new_w) // 2, (main_h - new_h) // 2


# --------------------------------------------------------------------------
# 核心：把一张贴纸贴到主图上
# --------------------------------------------------------------------------

#: 底图故障强度的「自动」取值：按贴纸名查 glitch.py 里的段位阶梯
GLITCH_AUTO = "auto"


def resolve_glitch(glitch, sticker_path):
    """
    把 ``glitch`` 参数解析成三种成分的强度 ``{"色散":x,"切片":y,"块状":z}``。

    * ``"auto"``（默认）—— 按贴纸名查段位阶梯
    * ``0.5`` / ``"50"`` / ``"50%"`` —— 只给总强度，由它换算出三种成分
    * ``{"色散":0.8,"切片":0.3,"块状":0}`` / ``(0.8, 0.3, 0)`` / ``"0.8,0.3,0"``
      —— 三种成分各自指定，范围都是 0 ~ 1.0
    * ``None`` / ``False`` / ``"none"`` —— 关闭，底图保持原样
    """
    if glitch is None or glitch is False:
        return glitch_fx.normalize_components(None)
    if isinstance(glitch, (dict, list, tuple)):
        return glitch_fx.normalize_components(glitch)

    if isinstance(glitch, str):
        text = glitch.strip()
        lowered = text.lower()
        if lowered in (GLITCH_AUTO, ""):
            return glitch_fx.components_for_sticker(sticker_path)
        if lowered in ("none", "off", "no"):
            return glitch_fx.normalize_components(None)
        if "," in text or "，" in text:
            return glitch_fx.normalize_components(text)
        try:
            glitch = float(text.rstrip("%").strip())
        except ValueError:
            raise ValueError(
                f"看不懂的故障参数：{glitch!r}"
                f"（可以写 auto / none / 0.5 / 50 / \"0.8,0.3,0\"）"
            ) from None

    if glitch is True:
        return glitch_fx.components_for_sticker(sticker_path)

    value = float(glitch)
    if value > 1.0:
        value /= 100.0
    if value < 0.0:
        raise ValueError(f"故障强度不能是负数：{glitch!r}")
    return glitch_fx.components_for(min(1.0, value))


def _output_path_for(output_name, main_img_path):
    """``output_name`` 不含后缀时，自动补上主图的后缀。"""
    main_ext = os.path.splitext(main_img_path)[1].lower()
    given_ext = os.path.splitext(output_name)[1].lower()
    if given_ext in SUPPORTED_MAIN_FORMATS:
        return output_name
    return f"{output_name}{main_ext}"


def paste_sticker_to_center(
    main_img_path,
    sticker_img_path,
    output_name,
    fit=DEFAULT_FIT,
    scale_percent=DEFAULT_STICKER_SIZE,
    glitch=GLITCH_AUTO,
    verbose=True,
):
    """
    把 ``sticker_img_path`` 贴到 ``main_img_path`` 正中央，结果存成 ``output_name``。

    注意：故障效果是加在**底图**上的，贴纸本身不做任何处理。

    :param output_name: 输出文件名，**不用写后缀**（会自动补主图的后缀）；
                        写了受支持的后缀也不会重复追加
    :param fit: ``"contain"``（默认）或 ``"height"``
    :param scale_percent: 贴纸大小，``0.75`` = 75%（默认）。也接受 75 / "75%" 写法。
                          100%（``1.0``）就是"贴纸刚好铺满主图"。
    :param glitch: 底图故障强度。``"auto"``（默认）按贴纸对应的段位自动取值；
                   也可以手动给 ``0.5`` / ``50``；``None`` / ``"none"`` 关闭。
    :returns: 实际写出的文件路径
    """
    scale_percent = parse_size(scale_percent)
    glitch_parts = resolve_glitch(glitch, sticker_img_path)
    glitch_on = any(value > 0 for value in glitch_parts.values())

    main_ext = os.path.splitext(main_img_path)[1].lower()
    if main_ext not in SUPPORTED_MAIN_FORMATS:
        raise ValueError(
            f"不支持的主图格式 {main_ext!r}，仅支持 {list(SUPPORTED_MAIN_FORMATS)}"
        )

    sticker_ext = os.path.splitext(sticker_img_path)[1].lower()
    if sticker_ext not in SUPPORTED_STICKER_FORMATS:
        raise ValueError(
            f"不支持的贴纸格式 {sticker_ext!r}，"
            f"仅支持 {list(SUPPORTED_STICKER_FORMATS)}"
        )
    if not os.path.isfile(sticker_img_path):
        raise FileNotFoundError(f"找不到贴纸文件：{sticker_img_path}")

    output_img_path = _output_path_for(output_name, main_img_path)
    out_dir = os.path.dirname(os.path.abspath(output_img_path))
    os.makedirs(out_dir, exist_ok=True)

    with Image.open(main_img_path) as main_img:
        main_w, main_h = main_img.size
        frame_count = getattr(main_img, "n_frames", 1)
        new_w, new_h, paste_x, paste_y = sticker_pixel_size(
            sticker_img_path, (main_w, main_h), fit, scale_percent
        )

        if verbose:
            print(
                f"📸 主图 {os.path.basename(main_img_path)} {main_ext} "
                f"{main_w}×{main_h}，{frame_count} 帧"
            )
            if glitch_on:
                active = " + ".join(
                    f"{k}{v:.0%}" for k, v in glitch_parts.items() if v > 0
                )
                print(f"🌫️ 底图故障：{active}")
            print(
                f"🔍 贴纸 {os.path.basename(sticker_img_path)} "
                f"@ {scale_percent:.0%} → {new_w}×{new_h}，"
                f"居中粘贴 ({paste_x}, {paste_y})"
            )

        sticker = load_sticker(sticker_img_path, (new_w, new_h))

        if frame_count > 1:
            _write_animated_gif(
                main_img,
                sticker,
                (paste_x, paste_y),
                output_img_path,
                frame_count,
                glitch_parts=glitch_parts,
                glitch_key=sticker_img_path,
            )
        else:
            frame = main_img.convert("RGBA")
            if glitch_on:
                frame = glitch_fx.glitch_frame(
                    frame,
                    seed=glitch_fx.seed_for(sticker_img_path, 0),
                    components=glitch_parts,
                )
            frame.paste(sticker, (paste_x, paste_y), mask=sticker)
            if main_ext == ".jpg" or main_ext == ".jpeg":
                frame.convert("RGB").save(output_img_path, quality=95)
            else:
                frame.save(output_img_path)

    if verbose:
        size_kb = os.path.getsize(output_img_path) / 1024
        print(f"✅ 已保存：{output_img_path}（{size_kb:.0f} KB）")
    return output_img_path


def _write_animated_gif(
    main_img,
    sticker,
    position,
    output_img_path,
    frame_count,
    glitch_parts=None,
    glitch_key="",
):
    """
    逐帧粘贴并写出 GIF。

    三个关键点（前两个是老代码踩过的坑）：
    * ``duration`` 必须逐帧收集 —— 各帧时长可以不一样，统一写一个值会改变动画速度；
    * ``loop`` 沿用原图，不要硬写成 0；
    * 故障施加在**底图**上，且**逐帧换种子**，动起来才像真的信号抖动。
    """
    frames = []
    durations = []
    durations_missing = False
    glitch_on = bool(glitch_parts) and any(v > 0 for v in glitch_parts.values())

    for index in range(frame_count):
        main_img.seek(index)
        duration = main_img.info.get("duration")
        if duration is None:
            duration = DEFAULT_FRAME_DURATION
            durations_missing = True
        durations.append(duration)

        frame = main_img.convert("RGBA")
        if glitch_on:
            frame = glitch_fx.glitch_frame(
                frame,
                seed=glitch_fx.seed_for(glitch_key, index),
                components=glitch_parts,
            )
        frame.paste(sticker, position, mask=sticker)
        frames.append(frame)

    loop = main_img.info.get("loop", 0)
    if durations_missing:
        print(f"   ⚠️ 原图部分帧没有时长信息，这些帧按 {DEFAULT_FRAME_DURATION}ms 处理")

    frames[0].save(
        output_img_path,
        save_all=True,
        append_images=frames[1:],
        duration=durations,   # 逐帧时长，而不是一个固定值
        loop=loop,            # 沿用原图的循环次数
        disposal=2,
        optimize=False,
    )


# --------------------------------------------------------------------------
# 批量：把一个文件夹里的贴纸全部贴一遍
# --------------------------------------------------------------------------

def _natural_key(name):
    """让 2.svg 排在 10.svg 前面。"""
    import re

    return [
        int(part) if part.isdigit() else part.lower()
        for part in re.split(r"(\d+)", name)
    ]


def list_stickers(sticker_dir):
    """列出贴纸目录里所有受支持的文件（按名字自然排序）。"""
    if not os.path.isdir(sticker_dir):
        raise FileNotFoundError(f"找不到贴纸目录：{sticker_dir}")
    stickers = []
    for name in sorted(os.listdir(sticker_dir), key=_natural_key):
        path = os.path.join(sticker_dir, name)
        if not os.path.isfile(path):
            continue
        ext = os.path.splitext(name)[1].lower()
        if ext in SUPPORTED_STICKER_FORMATS:
            stickers.append(path)
    return stickers


def process_all(
    main_img_path,
    sticker_dir="dan",
    output_dir="out",
    fit=DEFAULT_FIT,
    scale_percent=DEFAULT_STICKER_SIZE,
    glitch=GLITCH_AUTO,
    verbose=True,
):
    """
    把 ``sticker_dir`` 里所有贴纸依次贴到 ``main_img_path`` 上。

    :param scale_percent: 贴纸大小，``0.75`` = 75%（默认）。也接受 75 / "75%" 写法。
    :param glitch: 底图故障强度，``"auto"``（默认）按贴纸段位自动取值
    :param verbose: ``True`` 打印每个贴纸的详细过程；``False`` 只打印一行进度
    :returns: ``(成功列表, 失败列表)``，失败项为 ``(贴纸路径, 异常)``
    """
    stickers = list_stickers(sticker_dir)
    if not stickers:
        raise FileNotFoundError(f"{sticker_dir} 里没有找到任何贴纸")
    ensure_utf8_stdio()
    scale_percent = parse_size(scale_percent)

    main_stem = os.path.splitext(os.path.basename(main_img_path))[0]
    os.makedirs(output_dir, exist_ok=True)

    print(f"🎨 主图：{main_img_path}")
    print(f"📁 贴纸：{sticker_dir}（共 {len(stickers)} 个）")
    print(f"📁 输出：{output_dir}")
    print(f"📐 贴纸大小：{scale_percent:.0%}")
    if glitch == GLITCH_AUTO:
        count = sum(1 for s in stickers if glitch_fx.intensity_for(s) > 0)
        print(f"🌫️ 底图故障：auto（{count} 张贴纸会触发）")
    else:
        shown = resolve_glitch(glitch, "")
        if any(shown.values()):
            active = " + ".join(f"{k}{v:.0%}" for k, v in shown.items() if v > 0)
            print(f"🌫️ 底图故障：{active}")
        else:
            print("🌫️ 底图故障：关闭")
    print()

    results, failures = [], []
    for index, sticker_path in enumerate(stickers, 1):
        stem = os.path.splitext(os.path.basename(sticker_path))[0]
        output_name = os.path.join(output_dir, f"{main_stem}_{stem}")
        print(f"[{index}/{len(stickers)}] {os.path.basename(sticker_path)}")
        try:
            results.append(
                paste_sticker_to_center(
                    main_img_path,
                    sticker_path,
                    output_name,
                    fit=fit,
                    scale_percent=scale_percent,
                    glitch=glitch,
                    verbose=verbose,
                )
            )
        except (SvgRenderError, OSError, ValueError) as exc:
            print(f"   ❌ 失败：{exc}")
            failures.append((sticker_path, exc))
        if verbose:
            print()

    print("=" * 60)
    print(f"完成：成功 {len(results)} 个，失败 {len(failures)} 个")
    for path, exc in failures:
        print(f"  ❌ {os.path.basename(path)}：{exc}")
    return results, failures


# ------------------- 【仅修改这5个参数】 -------------------
if __name__ == "__main__":
    # 1. 主图：后缀必须是 .gif / .png / .jpg / .jpeg
    MAIN_FILE = "测试1.gif"
    # 2. 贴纸目录：里面可以混放 PNG 和 SVG
    STICKER_DIR = "dan"
    # 3. 输出目录
    OUTPUT_DIR = "out"
    # 4. 贴纸大小：写 75 就是 75%（不用写 %），范围 50 ~ 125，默认 75
    STICKER_SIZE = 75
    # 5. 底图故障：auto = 按贴纸段位自动；也可写 none 关闭，或 0.5 / 50 手动指定
    GLITCH = "auto"

    try:
        ensure_utf8_stdio()
        process_all(
            MAIN_FILE,
            STICKER_DIR,
            OUTPUT_DIR,
            scale_percent=STICKER_SIZE,
            glitch=GLITCH,
        )
    except Exception as error:  # 让报错信息更友好一点
        print(f"\n💥 出错了：{error}", file=sys.stderr)
        raise
