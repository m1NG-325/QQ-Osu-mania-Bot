# -*- coding: utf-8 -*-
"""
聊天机器人接口
==============

把贴纸生成器包成一个**可以直接被别的程序调用**的接口：解析聊天指令 →
合成图片 → 返回文件。用标准库实现 HTTP 服务，**不需要装任何新依赖**。

为什么是 HTTP
-------------
你朋友用的是 NapCatQQ（``napqq``）+ JavaScript，你这边是 Python。
NapCatQQ 实现的是 **OneBot 11** 协议，这是个语言无关的协议，两边不需要
同一种语言 —— 让 JS 那边 ``fetch`` 一下这个服务就够了，
Python 这边完全不用懂 QQ 协议。

指令格式
--------
::

    !dan <段位> [大小] [色散] [切片] [块状]

* **``!`` 是必须的** —— 否则普通聊天里出现 "dan" 就会被误判。
  半角 ``!`` 和全角 ``！`` 都行，``!`` 后面、``dan`` 后面加不加空格都无所谓。
* ``段位``  —— 写法见 :mod:`ranks`：默认格式 ``(x)k[ln](x)``，
  光写数字或希腊字母按 4k 算，字母部分支持模糊拼写。
* ``大小``  —— 50 ~ 125（不用写 ``%``），默认 75
* ``色散`` ``切片`` ``块状`` —— 各自 0 ~ 1.0；也接受 0 ~ 100 的百分数写法
  （``80`` == ``0.8``，大于 1 的一律当百分数）。
  **都不写** = 按段位自动；**写了任意一个** = 手动模式，没写的按 0 算

例子::

    !dan kappa                  # 4k 的 kappa，75%，故障按段位自动
    ！dan 7kstellium            # 7k 的 stellium（拼错也认）
    ! dan 4kln3 60              # 4kln 的 ln-3，60%
    !dan 7klnazimuth 75 0.8 0.3 0
    !dan 7-ln-zenith 100 1 1 1

HTTP 接口
---------
::

    GET  /cmd?text=dan%20kappa%2075    -> 直接回图片（把聊天原文丢过来就行）
    GET  /dan?rank=kappa&size=75&chroma=0.8&slice=0.3&block=0
    POST /cmd?text=dan%20kappa%2075    -> 请求体放群友发的那张图，拿它当底图
    POST /dan?rank=kappa&size=75       -> 同上
    GET  /ranks                        -> JSON，段位列表 + 各自的默认故障值
    GET  /health                       -> JSON，存活探针

**底图**：不带图就是默认那张（``DEFAULT_BASE``）；带图（POST）就用群友
发给机器人那张。内容相同的图只存一份，所以同一个群友反复发同一张图会
直接命中缓存。

命令行
------
::

    python bot.py --serve --port 8099  # 起服务
    python bot.py --parse "dan kappa 75"
    python bot.py --render "dan kappa 75"
    python bot.py --ranks
    python bot.py --help
"""

from __future__ import annotations

import argparse
import hashlib
import hmac
import io
import json
import os
import re
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import glitch as glitch_fx  # noqa: E402
import init as tool  # noqa: E402
import ranks  # noqa: E402

# --------------------------------------------------------------------------
# 配置
# --------------------------------------------------------------------------

#: 默认底图（没带图来的时候用它）
DEFAULT_BASE = "测试1.gif"

#: 贴纸目录（相对本文件，也可以给绝对路径）。
#: 换成纯 PNG 的 ``dan_png`` 就完全不需要 SVG 渲染后端了。
STICKER_DIR = "dan"

#: 生成的图片和群友上传的底图都放这里（也是缓存目录）
CACHE_DIR = "_bot_cache"

#: 群友上传的底图大小上限
MAX_UPLOAD_BYTES = 20 * 1024 * 1024

#: 缓存目录里最多留多少个文件，超了从最旧的开始删
MAX_CACHE_FILES = 300

#: 指令前缀。**必须带 ``!``**（半角全角都行），否则普通聊天里的 "dan" 会被误判
COMMAND_PREFIX = "dan"

#: ``!dan`` —— ! 必须有，! 和 dan 之间、dan 和参数之间的空格都无所谓
_COMMAND_RE = re.compile(r"^\s*[!！]\s*dan\s*", re.IGNORECASE)

#: 大小默认值与范围（沿用 init.py 的设定）
DEFAULT_SIZE = tool.DEFAULT_STICKER_SIZE

#: 能当底图的图片格式
EXT_BY_FORMAT = {
    "GIF": ".gif",
    "PNG": ".png",
    "JPEG": ".jpg",
    "WEBP": ".webp",
    "BMP": ".bmp",
}


# --------------------------------------------------------------------------
# 指令解析
# --------------------------------------------------------------------------

class CommandError(ValueError):
    """指令有问题时抛出，消息直接可以回给用户。"""


def _split_tokens(text: str, known_stems):
    """
    把聊天原文拆成参数列表。

    * **必须**以 ``!dan`` / ``！dan`` 开头（``!`` 和 ``dan`` 之间的空格随意），
      否则返回 ``None`` —— 这样普通聊天不会被误伤；
    * ``!dan`` 后面的空格随意，甚至完全连写：``!dankappa`` / ``!dan7kstellium``；
    * 段位和大小之间也能连写：``!dankappa75`` / ``!dan4kln375``。

    :returns: 参数列表（第一个是段位），不是本机器人的指令时返回 ``None``
    """
    raw = str(text or "").strip()
    if not raw:
        return None

    match = _COMMAND_RE.match(raw)
    if not match:
        return None                       # 没有 ! ，或者不是 dan

    rest = raw[match.end():].strip()
    if not rest:
        return []                         # 只有 !dan，缺参数

    # 先看第一个空格前的词能不能整个当段位（覆盖 "!dan kappa 75" 这种常规写法）
    first_and_tail = rest.split(None, 1)
    first = first_and_tail[0]
    tail = first_and_tail[1] if len(first_and_tail) > 1 else ""
    stem = ranks.resolve(first, known_stems)
    if stem:
        return [stem] + tail.split()

    # 连写形式：在 rest 里从长到短切，切出的头能解析成段位、尾又是纯数字就成立
    for cut in range(len(rest), 0, -1):
        head, remainder = rest[:cut], rest[cut:]
        if remainder.strip() and not re.fullmatch(r"[\s\d.]+%?", remainder):
            continue
        stem = ranks.resolve(head, known_stems)
        if stem:
            return [stem] + remainder.split()

    # 到这里说明 ``!dan`` 是有的，但第一个词不是能认出来的段位。
    # 这仍然是"在跟机器人说话"，所以照常往下走，让 parse_command 报清楚错，
    # 而不是当成普通聊天悄悄放过去。
    return [first] + tail.split()


def parse_command(text: str, sticker_dir=None):
    """
    解析一条聊天指令。

    :returns: ``{"rank":…, "size":…, "glitch":{…}}``；不是本机器人的指令时返回 ``None``
    :raises CommandError: 是机器人指令但参数有问题
    """
    directory = sticker_dir or sticker_dir_path()
    known = ranks.all_stems(directory)

    args = _split_tokens(text, known)
    if args is None:
        return None
    if not args:
        raise CommandError(
            "用法：!dan <段位> [大小] [色散] [切片] [块状]\n"
            "例如：!dan kappa 75   /   ！dan 7kstellium"
        )

    # 段位（_split_tokens 已经解析过了，这里只是取回来）
    rank = args[0]
    if rank not in known:
        raise CommandError(
            f"不认识这个段位：{args[0]}\n"
            + ranks.explain(args[0])
        )
    rest = args[1:]
    if len(rest) > 4:
        raise CommandError("参数太多：!dan <段位> [大小] [色散] [切片] [块状]")

    # 大小
    size = DEFAULT_SIZE
    if rest:
        try:
            size = tool.parse_size(rest[0])
        except ValueError as exc:
            raise CommandError(str(exc)) from None
        rest = rest[1:]

    # 三个可自定义的 0~1.0 选项
    if not rest:
        parts = glitch_fx.components_for_sticker(rank)
    else:
        values = []
        for token in rest[:3]:
            values.append(_parse_unit(token))
        while len(values) < 3:
            values.append(0.0)
        parts = dict(zip(glitch_fx.COMPONENT_NAMES, values))

    return {"rank": rank, "size": size, "glitch": parts}


def _parse_unit(token: str) -> float:
    """
    把一个 0~1.0 的选项解析成 float。

    也接受 0~100 的百分数写法（``80`` == ``0.8``）—— 聊天里手打 ``80`` 更顺手。
    因此规则是：**大于 1 的一律当百分数**（``2.0`` == 2%）。
    """
    text = str(token).strip().rstrip("%").strip()
    try:
        value = float(text)
    except ValueError:
        raise CommandError(
            f"这三个选项要写 0 ~ 1.0 的数字，收到的是：{token!r}"
        ) from None
    if value > 1.0:
        value /= 100.0
    if not (0.0 <= value <= 1.0):
        raise CommandError(f"选项要落在 0 ~ 1.0（或 0 ~ 100）：{token!r}")
    return round(value, 4)


def components_text(parts):
    """把三种成分渲染成一句人话。"""
    active = [f"{name}{value:.0%}" for name, value in parts.items() if value > 0]
    return " + ".join(active) if active else "关闭"


# --------------------------------------------------------------------------
# 合成
# --------------------------------------------------------------------------

def sticker_dir_path():
    """贴纸目录的绝对路径。"""
    if os.path.isabs(STICKER_DIR):
        return STICKER_DIR
    return os.path.join(HERE, STICKER_DIR)


def sticker_path_for(stem: str):
    """按贴纸名找到实际文件（PNG / SVG 都行）。``stem`` 已经是规范名。"""
    directory = sticker_dir_path()
    if not os.path.isdir(directory):
        raise CommandError(f"找不到贴纸目录：{directory}")
    for ext in tool.SUPPORTED_STICKER_FORMATS:
        candidate = os.path.join(directory, stem + ext)
        if os.path.isfile(candidate):
            return candidate
    lowered = stem.lower()
    for name in sorted(os.listdir(directory)):
        base, ext = os.path.splitext(name)
        if base.lower() == lowered and ext.lower() in tool.SUPPORTED_STICKER_FORMATS:
            return os.path.join(directory, name)
    raise CommandError(f"贴纸目录里找不到 {stem!r}：{directory}")


def resolve_rank(text: str):
    """把群里写的段位解析成规范贴纸名；解析不出来抛 CommandError。"""
    known = ranks.all_stems(sticker_dir_path())
    stem = ranks.resolve(text, known)
    if stem is None:
        raise CommandError(f"不认识这个段位：{text}\n" + ranks.explain(text))
    return stem


def save_uploaded_base(data: bytes, tag: str = ""):
    """
    把群友发来的图片存成一张底图，返回文件路径。

    内容相同的图片只会存一份（按内容哈希命名），所以重复发同一张图不会
    反复占盘，也能直接命中缓存。
    """
    if not data:
        raise CommandError("收到的底图是空的")
    try:
        with Image.open(io.BytesIO(data)) as probe:
            fmt = (probe.format or "").upper()
            width, height = probe.size
            frames = getattr(probe, 'n_frames', 1)
            if width * height > 16_000_000 or frames > 500 or width * height * frames > 80_000_000:
                raise CommandError("图片尺寸或动画帧数太大，请缩小图片或缩短动画后再试。")
            probe.load()                     # 真解码一下，避免收半张坏图
    except CommandError:
        raise
    except Exception as exc:                 # noqa: BLE001
        raise CommandError(f"这不是一张能识别的图片：{exc}") from None

    ext = EXT_BY_FORMAT.get(fmt)
    if ext is None:
        raise CommandError(
            f"不支持的底图格式 {fmt or '未知'}，"
            f"支持：{'、'.join(sorted(EXT_BY_FORMAT))}"
        )

    cache_dir = os.path.join(HERE, CACHE_DIR)
    os.makedirs(cache_dir, exist_ok=True)
    digest = hashlib.sha1(data).hexdigest()[:16]
    path = os.path.join(cache_dir, f"base_{digest}{ext}")
    if not os.path.isfile(path):
        with open(path, "wb") as fh:
            fh.write(data)
        prune_cache()
    return path


def prune_cache(keep=MAX_CACHE_FILES):
    """缓存目录别无限长胖：超了就按修改时间删最旧的。"""
    cache_dir = os.path.join(HERE, CACHE_DIR)
    if not os.path.isdir(cache_dir):
        return
    entries = []
    for name in os.listdir(cache_dir):
        full = os.path.join(cache_dir, name)
        if os.path.isfile(full):
            entries.append((os.path.getmtime(full), full))
    if len(entries) <= keep:
        return
    entries.sort()
    for _mtime, full in entries[: len(entries) - keep]:
        try:
            os.remove(full)
        except OSError:
            pass


def render(rank, size=DEFAULT_SIZE, glitch=None, base_image=None, use_cache=True):
    """
    合成一张图并返回它的路径。

    :param rank: 段位，写法随意 —— ``kappa`` / ``4kgamma`` / ``7kstellium`` /
                 ``7-ln-zenith`` 都行，也可以是规范贴纸名
    :param glitch: ``None`` = 按段位自动；字典 / 3 元序列 = 手动指定三种成分
    :param use_cache: 同样的参数重复请求时直接复用上次结果
    """
    base = base_image or os.path.join(HERE, DEFAULT_BASE)
    if not os.path.isfile(base):
        raise FileNotFoundError(f"找不到底图：{base}")

    stem = resolve_rank(rank)
    sticker = sticker_path_for(stem)
    size = tool.parse_size(size)
    parts = (glitch_fx.components_for_sticker(stem)
             if glitch is None else glitch_fx.normalize_components(glitch))

    cache_dir = os.path.join(HERE, CACHE_DIR)
    os.makedirs(cache_dir, exist_ok=True)

    key = "|".join([
        "v2", os.path.abspath(base), os.path.abspath(sticker),
        str(os.stat(sticker).st_mtime_ns), f"{size:.4f}",
        ",".join(f"{v:.4f}" for v in parts.values()),
    ])
    digest = hashlib.sha1(key.encode("utf-8")).hexdigest()[:16]
    ext = os.path.splitext(base)[1].lower()
    with Image.open(base) as probe:
        if getattr(probe, 'n_frames', 1) > 1:
            ext = '.gif'
    out_path = os.path.join(cache_dir, f"{digest}{ext}")

    if use_cache and os.path.isfile(out_path):
        return out_path

    out_path = tool.paste_sticker_to_center(
        base, sticker, out_path,
        scale_percent=size,
        glitch=parts,
        verbose=False,
    )
    prune_cache()
    return out_path


# --------------------------------------------------------------------------
# HTTP 服务
# --------------------------------------------------------------------------

CONTENT_TYPES = {
    ".gif": "image/gif",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
}


class _Handler(BaseHTTPRequestHandler):
    server_version = "dan-bot/1.0"
    base_image = None
    token = ""
    lock = threading.RLock()

    # -- 输出 ------------------------------------------------------------
    def log_message(self, fmt, *args):        # 少刷屏，只留一行
        sys.stderr.write("[dan-bot] %s\n" % (fmt % args))

    def _authorized(self, query):
        """
        没设 token 就全放行；设了就要求 ``?token=xxx`` 或 ``X-Dan-Token`` 头。

        绑定在 127.0.0.1 时其实用不着；一旦用 ``--host 0.0.0.0`` 暴露出去，
        **务必**设一个，否则任何人都能刷爆你的机器。
        """
        if not self.token:
            return True
        supplied = query.get("token") or self.headers.get("X-Dan-Token", "")
        return hmac.compare_digest(str(supplied), self.token)

    def _send_json(self, payload, status=200):
        body = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_text(self, text, status=200):
        body = text.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_image(self, path):
        ext = os.path.splitext(path)[1].lower()
        with open(path, "rb") as fh:
            body = fh.read()
        self.send_response(200)
        self.send_header("Content-Type", CONTENT_TYPES.get(ext, "application/octet-stream"))
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    # -- 路由 ------------------------------------------------------------
    def do_GET(self):
        parsed = urlparse(self.path)
        route = parsed.path.rstrip("/") or "/"
        query = {k: v[0] for k, v in parse_qs(parsed.query).items()}

        try:
            if route in ("/", "/help"):
                self._send_text(HELP_TEXT)
            elif route == "/health":
                self._send_json({"status": "ok", "base": self.base_image})
            elif not self._authorized(query):
                self._send_text("token 不对", status=403)
            elif route == "/ranks":
                self._send_json(ranks_payload())
            elif route == "/cmd":
                self._handle_text(query.get("text", ""))
            elif route == "/dan":
                self._handle_params(query)
            else:
                self._send_text(f"未知路径：{route}\n\n{HELP_TEXT}", status=404)
        except CommandError as exc:
            self._send_text(str(exc), status=400)
        except Exception as exc:                       # noqa: BLE001
            self._send_text(f"出错了：{exc}", status=500)

    def _handle_text(self, text, base_image=None):
        """把聊天原文丢过来，自己解析后再回图片。"""
        command = parse_command(text)
        if command is None:
            raise CommandError(
                "这看起来不是 dan 指令 —— 要以 !dan 开头（半角 ! 或全角 ！都行）"
            )
        with self.lock:
            path = render(command["rank"], command["size"], command["glitch"],
                          base_image=base_image or self.base_image)
        self._send_image(path)
        return ""

    def _handle_params(self, query, base_image=None):
        raw_rank = query.get("rank")
        if not raw_rank:
            raise CommandError("缺少 rank 参数，例如 /dan?rank=7kstellium&size=75")
        resolved = resolve_rank(raw_rank)

        try:
            size = tool.parse_size(query.get("size", DEFAULT_SIZE))
        except ValueError as exc:
            raise CommandError(str(exc)) from None
        manual = [query.get(k) for k in ("chroma", "slice", "block")]
        if any(v is not None for v in manual):
            values = [_parse_unit(v) if v is not None else 0.0 for v in manual]
            parts = dict(zip(glitch_fx.COMPONENT_NAMES, values))
        else:
            parts = None

        with self.lock:
            path = render(resolved, size, parts,
                          base_image=base_image or self.base_image)
        self._send_image(path)
        return ""

    # -- 带图请求：群友发的图当底图 --------------------------------------
    def do_POST(self):
        parsed = urlparse(self.path)
        route = parsed.path.rstrip("/") or "/"
        query = {k: v[0] for k, v in parse_qs(parsed.query).items()}

        try:
            if route not in ("/dan", "/cmd"):
                self._send_text("POST 只支持 /dan 和 /cmd", status=404)
                return
            if not self._authorized(query):
                self._send_text("token 不对", status=403)
                return

            length = int(self.headers.get("Content-Length") or 0)
            if length <= 0:
                self._send_text(
                    "POST 需要把底图（群友那张图）放在请求体里，"
                    "指令放在 query 里，例如 /cmd?text=dan%20kappa%2075",
                    status=400,
                )
                return
            if length > MAX_UPLOAD_BYTES:
                self._send_text(
                    f"底图太大了：{length} 字节，上限 {MAX_UPLOAD_BYTES}",
                    status=413,
                )
                return

            data = self.rfile.read(length)
            if len(data) != length:
                raise CommandError("图片上传不完整，请重新发送。")
            with self.lock:
                base_image = save_uploaded_base(data)
                if route == "/cmd":
                    self._handle_text(query.get("text", ""), base_image=base_image)
                else:
                    self._handle_params(query, base_image=base_image)
        except CommandError as exc:
            self._send_text(str(exc), status=400)
        except Exception as exc:                       # noqa: BLE001
            self._send_text(f"出错了：{exc}", status=500)


HELP_TEXT = """dan 贴纸机器人 —— Python 端接口

指令（! 必须有，半角 ! 和全角 ！都行）：
  !dan <段位> [大小] [色散] [切片] [块状]
    !dan kappa                 4k 的 kappa，75%，故障按段位自动
    ！dan 7kstellium           7k 的 stellium（拼错也认）
    ! dan 4kln3 60             4kln 的 ln-3，60%
    !dan 7klnazimuth 75 0.8 0.3 0

  段位写法 = (x)k[ln](x)：
    光写数字或希腊字母 -> 4k       3 / gamma / 4k3 / 4kgamma
    4kln              -> ln-数字   4kln3 / ln3 / ln-3
    7k                -> 7-…       7k3 / 7kstellium
    7kln              -> 7-ln-…    7kln3 / 7klnstellium
    字母支持模糊拼写（7kstelium / 7kstel 都认）

HTTP：
  GET  /cmd?text=<聊天原文>        直接回图片（底图用默认那张）
  GET  /dan?rank=&size=&chroma=&slice=&block=
  POST /cmd?text=<聊天原文>        请求体 = 群友发的图，拿它当底图
  POST /dan?rank=&size=…           同上
  GET  /ranks                     段位表（JSON）
  GET  /health                    存活探针
"""


def ranks_payload():
    """给机器人做「帮助」菜单用：段位 + 各自默认的故障值。"""
    groups = []
    for group, names, curve in glitch_fx.EFFECT_GROUPS:
        entries = []
        for name in names:
            parts = glitch_fx.components_for_sticker(name)
            entries.append({
                "rank": name,
                "default_glitch": parts,
                "label": " + ".join(f"{k}{v:.0%}" for k, v in parts.items() if v > 0) or "无",
            })
        groups.append({"group": group, "curve": curve, "members": entries})
    return {"groups": groups, "plain": "不在表里的贴纸底图原样不动"}


def serve(port=8099, host="127.0.0.1", base_image=None, token=""):
    _Handler.base_image = base_image or os.path.join(HERE, DEFAULT_BASE)
    _Handler.token = token or ""
    httpd = ThreadingHTTPServer((host, port), _Handler)
    print(f"🐞 dan 机器人接口已启动： http://{host}:{port}")
    print(f"   底图：{_Handler.base_image}")
    print(f"   鉴权：{'已开启（需要 token）' if _Handler.token else '关闭'}")
    if host not in ("127.0.0.1", "localhost") and not _Handler.token:
        print("   ⚠️  你监听了非本机地址却没设 token，任何人都能调用 —— 建议加 --token")
    print(f"   试试： http://{host}:{port}/cmd?text=dan%20kappa%2075")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n⏹  已停止")
    finally:
        httpd.server_close()


# --------------------------------------------------------------------------
# 命令行
# --------------------------------------------------------------------------

def build_parser():
    parser = argparse.ArgumentParser(
        prog="python bot.py",
        description="dan 贴纸机器人：指令解析 + HTTP 接口",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--serve", action="store_true", help="起 HTTP 服务")
    parser.add_argument("--port", type=int, default=8099, help="端口（默认 8099）")
    parser.add_argument("--host", default="127.0.0.1",
                        help="监听地址（默认 127.0.0.1，只给本机用）")
    parser.add_argument("--base", default=None, help=f"底图（默认 {DEFAULT_BASE}）")
    parser.add_argument("--stickers", default=None,
                        help=f"贴纸目录（默认 {STICKER_DIR}）；换成纯 PNG 的 dan_png "
                             f"就不再需要 SVG 渲染后端")
    parser.add_argument("--token", default="",
                        help="可选共享密钥；设了之后请求要带 ?token=xxx 或 X-Dan-Token 头")
    parser.add_argument("--parse", metavar="指令", help="只解析指令，打印结果")
    parser.add_argument("--render", metavar="指令", help="解析并合成一张图")
    parser.add_argument("--ranks", action="store_true", help="打印段位表")
    return parser


def main(argv=None):
    tool.ensure_utf8_stdio()
    args = build_parser().parse_args(argv)

    if args.stickers:
        global STICKER_DIR
        STICKER_DIR = (args.stickers if os.path.isabs(args.stickers)
                       else os.path.join(HERE, args.stickers))

    if args.ranks:
        print(glitch_fx.describe_ladder())
        return 0

    if args.parse:
        try:
            command = parse_command(args.parse)
        except CommandError as exc:
            print(f"❌ {exc}")
            return 2
        if command is None:
            print("（不是 dan 指令）")
            return 1
        print(json.dumps({
            "rank": command["rank"],
            "size": f"{command['size']:.0%}",
            "glitch": command["glitch"],
            "text": components_text(command["glitch"]),
        }, ensure_ascii=False, indent=2))
        return 0

    if args.render:
        try:
            command = parse_command(args.render)
        except CommandError as exc:
            print(f"❌ {exc}")
            return 2
        if command is None:
            print("（不是 dan 指令）")
            return 1
        path = render(command["rank"], command["size"], command["glitch"],
                      base_image=args.base)
        print(f"✅ {command['rank']} @ {command['size']:.0%} | "
              f"{components_text(command['glitch'])}")
        print(f"   -> {path}")
        return 0

    if args.serve:
        serve(port=args.port, host=args.host, base_image=args.base, token=args.token)
        return 0

    build_parser().print_help()
    return 0


if __name__ == "__main__":
    sys.exit(main())
