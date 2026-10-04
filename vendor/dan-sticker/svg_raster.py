# -*- coding: utf-8 -*-
"""
SVG -> PIL.Image 栅格化。

贴纸可能是 PNG，也可能是 SVG。Pillow 自己不会读 SVG，所以这里统一提供
``load_svg()``：输入 .svg 路径，输出带透明通道的 ``PIL.Image``（RGBA）。

后端按顺序自动选择，谁先可用就用谁：

1. ``cairosvg``  —— 如果环境里装了（跨平台，最省事）；
2. ``librsvg`` + ``cairo`` —— 用 ctypes 直接调用系统里已有的动态库。
   Windows 上很多软件（GTK 运行时、Inkscape、GIMP、msys2、uxplay 等）
   都会附带 ``librsvg-2-2.dll`` + ``libcairo-2.dll``，脚本会自动去常见
   位置找。也可以自己指定目录：

       set RSVG_LIB_DIR=D:\\some\\where\\bin

两个后端都不可用时会抛出 ``SvgRenderError``，并给出可操作的提示。
"""

from __future__ import annotations

import ctypes
import os
import re
import sys
import xml.etree.ElementTree as ET
from io import BytesIO

from PIL import Image

__all__ = [
    "SvgRenderError",
    "SVG_EXTENSIONS",
    "is_svg",
    "svg_intrinsic_size",
    "load_svg",
    "available_backend",
]

SVG_EXTENSIONS = {".svg"}

#: SVG 既没有 width/height 也没有 viewBox 时使用的兜底边长
DEFAULT_SVG_SIZE = 1024


class SvgRenderError(RuntimeError):
    """SVG 无法被栅格化时抛出。"""


def is_svg(path: str) -> bool:
    return os.path.splitext(path)[1].lower() in SVG_EXTENSIONS


# --------------------------------------------------------------------------
# 读取 SVG 的固有尺寸
# --------------------------------------------------------------------------

_LENGTH_UNITS = ("px", "pt", "pc", "mm", "cm", "in", "em", "ex", "%")


def _parse_length(text):
    """把 ``"1024"`` / ``"1024px"`` 解析成 float；带 ``%`` 或无法解析时返回 None。"""
    if not text:
        return None
    t = text.strip()
    if t.endswith("%"):
        return None
    low = t.lower()
    for unit in _LENGTH_UNITS:
        if low.endswith(unit):
            t = t[: -len(unit)]
            break
    try:
        value = float(t)
    except ValueError:
        return None
    return value if value > 0 else None


def _localname(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _svg_root(path: str):
    try:
        tree = ET.parse(path)
    except ET.ParseError as exc:
        raise SvgRenderError(f"SVG 解析失败：{path}（{exc}）") from exc
    root = tree.getroot()
    if _localname(root.tag) != "svg":
        # 少数文件外面套了一层，往下找第一个 <svg>
        for node in root.iter():
            if _localname(node.tag) == "svg":
                return node
        raise SvgRenderError(f"不是有效的 SVG（找不到 <svg> 根元素）：{path}")
    return root


def svg_intrinsic_size(path: str):
    """
    返回 SVG 的固有像素尺寸 ``(width, height)``（float）。

    优先用 width/height 属性，其次用 viewBox；都没有则返回 ``None``。
    ``dan/*.svg`` 只写了 ``viewBox="0 0 1024 1024"``，属于第二种情况。
    """
    root = _svg_root(path)
    width = _parse_length(root.get("width"))
    height = _parse_length(root.get("height"))
    if width and height:
        return width, height

    raw_viewbox = root.get("viewBox") or root.get("viewbox")
    vb_w = vb_h = None
    if raw_viewbox:
        parts = [p for p in re.split(r"[\s,]+", raw_viewbox.strip()) if p]
        if len(parts) == 4:
            try:
                vb_w, vb_h = float(parts[2]), float(parts[3])
            except ValueError:
                vb_w = vb_h = None
            if vb_w is not None and (vb_w <= 0 or vb_h <= 0):
                vb_w = vb_h = None

    if vb_w and vb_h:
        # 只给了一个方向时，按 viewBox 的比例推另一个方向
        if width and not height:
            return width, width * vb_h / vb_w
        if height and not width:
            return height * vb_w / vb_h, height
        return vb_w, vb_h
    if width and height:
        return width, height
    if width:
        return width, width
    if height:
        return height, height
    return None


# --------------------------------------------------------------------------
# 后端 1：cairosvg
# --------------------------------------------------------------------------

def _render_with_cairosvg(path: str, size) -> Image.Image:
    import cairosvg  # noqa: WPS433  (延迟导入：没装就走别的后端)

    png_bytes = cairosvg.svg2png(
        url=path, output_width=int(size[0]), output_height=int(size[1])
    )
    return Image.open(BytesIO(png_bytes)).convert("RGBA")


def _has_cairosvg() -> bool:
    try:
        import cairosvg  # noqa: F401
    except Exception:
        return False
    return True


# --------------------------------------------------------------------------
# 后端 2：librsvg + cairo（ctypes）
# --------------------------------------------------------------------------

_CAIRO_FORMAT_ARGB32 = 0
_CAIRO_STATUS_SUCCESS = 0

_CAIRO_WRITE_FUNC = ctypes.CFUNCTYPE(
    ctypes.c_int, ctypes.c_void_p, ctypes.POINTER(ctypes.c_ubyte), ctypes.c_uint
)


class _GError(ctypes.Structure):
    _fields_ = [
        ("domain", ctypes.c_uint),
        ("code", ctypes.c_int),
        ("message", ctypes.c_char_p),
    ]


class _RsvgRectangle(ctypes.Structure):
    _fields_ = [
        ("x", ctypes.c_double),
        ("y", ctypes.c_double),
        ("width", ctypes.c_double),
        ("height", ctypes.c_double),
    ]


#: 动态库文件名（按平台）
_LIB_NAMES = {
    "win32": ("libcairo-2.dll", "librsvg-2-2.dll"),
    "linux": ("libcairo.so.2", "librsvg-2.so.2"),
    "darwin": ("libcairo.2.dylib", "librsvg-2.2.dylib"),
}

#: Windows 上常见的附带 librsvg 的安装目录（支持 * 通配）
_WINDOWS_LIB_DIR_PATTERNS = (
    r"C:\Program Files\*\bin",
    r"C:\Program Files\*",
    r"C:\Program Files (x86)\*\bin",
    r"C:\Program Files (x86)\*",
    r"C:\msys64\mingw64\bin",
    r"C:\msys64\ucrt64\bin",
    r"C:\msys64\clang64\bin",
    r"C:\ProgramData\chocolatey\bin",
    r"C:\tools\*\bin",
)

#: 明确知道会带 librsvg 的目录名，优先命中
_KNOWN_WINDOWS_APPS = (
    "GTK3-Runtime Win64",
    "GTK2-Runtime Win64",
    "Inkscape",
    "GIMP 2",
    "GIMP 3",
    "uxplay-windows",
    "QGIS",
    "R",
)


def _iter_candidate_dirs():
    """按优先级依次产出可能含有 cairo / librsvg 动态库的目录。"""
    seen = set()

    def _yield(directory):
        if not directory:
            return
        key = os.path.normcase(os.path.abspath(directory))
        if key in seen or not os.path.isdir(directory):
            return
        seen.add(key)
        return directory

    env_dir = os.environ.get("RSVG_LIB_DIR")
    if env_dir:
        got = _yield(env_dir)
        if got:
            yield got

    # PATH 里已有的目录
    for entry in os.environ.get("PATH", "").split(os.pathsep):
        got = _yield(entry)
        if got:
            yield got

    if sys.platform == "win32":
        import glob as _glob

        for app in _KNOWN_WINDOWS_APPS:
            for base in (r"C:\Program Files", r"C:\Program Files (x86)"):
                got = _yield(os.path.join(base, app))
                if got:
                    yield got
        for pattern in _WINDOWS_LIB_DIR_PATTERNS:
            try:
                matches = _glob.glob(pattern)
            except OSError:
                continue
            for match in matches:
                got = _yield(match)
                if got:
                    yield got


def _find_lib_dir(cairo_name: str, rsvg_name: str):
    """找到同时含有 cairo 与 librsvg 的目录。"""
    for directory in _iter_candidate_dirs():
        if os.path.isfile(os.path.join(directory, rsvg_name)):
            return directory
    return None


class _LibrsvgRenderer:
    """用 ctypes 调用 librsvg / cairo 的最小封装。"""

    def __init__(self, lib_dir: str):
        self.lib_dir = lib_dir
        cairo_name, rsvg_name = _LIB_NAMES.get(
            "win32" if sys.platform == "win32" else sys.platform,
            _LIB_NAMES["linux"],
        )
        # 依赖库（glib/gobject）先加载，保证 GObject 类型系统就绪
        self._dll_handles = []
        if sys.platform == "win32" and hasattr(os, "add_dll_directory"):
            self._dll_handles.append(os.add_dll_directory(lib_dir))
            for dep in ("libglib-2.0-0.dll", "libgobject-2.0-0.dll"):
                dep_path = os.path.join(lib_dir, dep)
                if os.path.isfile(dep_path):
                    self._dll_handles.append(ctypes.CDLL(dep_path))

        self.cairo = ctypes.CDLL(os.path.join(lib_dir, cairo_name))
        self.rsvg = ctypes.CDLL(os.path.join(lib_dir, rsvg_name))
        self._bind()

    def _bind(self):
        c = self.cairo
        c.cairo_image_surface_create.restype = ctypes.c_void_p
        c.cairo_image_surface_create.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_int]
        c.cairo_create.restype = ctypes.c_void_p
        c.cairo_create.argtypes = [ctypes.c_void_p]
        c.cairo_destroy.argtypes = [ctypes.c_void_p]
        c.cairo_surface_destroy.argtypes = [ctypes.c_void_p]
        c.cairo_surface_write_to_png_stream.restype = ctypes.c_int
        c.cairo_surface_write_to_png_stream.argtypes = [
            ctypes.c_void_p,
            _CAIRO_WRITE_FUNC,
            ctypes.c_void_p,
        ]

        r = self.rsvg
        r.rsvg_handle_new_from_data.restype = ctypes.c_void_p
        r.rsvg_handle_new_from_data.argtypes = [
            ctypes.POINTER(ctypes.c_ubyte),
            ctypes.c_size_t,
            ctypes.POINTER(ctypes.POINTER(_GError)),
        ]
        r.rsvg_handle_render_document.restype = ctypes.c_int
        r.rsvg_handle_render_document.argtypes = [
            ctypes.c_void_p,
            ctypes.c_void_p,
            ctypes.POINTER(_RsvgRectangle),
            ctypes.POINTER(ctypes.POINTER(_GError)),
        ]
        r.rsvg_handle_free.argtypes = [ctypes.c_void_p]
        try:
            self._glib = ctypes.CDLL(
                os.path.join(self.lib_dir, "libglib-2.0-0.dll")
            )
            self._glib.g_error_free.argtypes = [ctypes.POINTER(_GError)]
        except OSError:
            self._glib = None

    # -- helpers ----------------------------------------------------------
    def _take_error(self, err_ptr) -> str:
        err = err_ptr.contents
        message = err.message.decode("utf-8", "replace") if err.message else "未知错误"
        if self._glib is not None:
            self._glib.g_error_free(err_ptr)
        return message

    def render(self, path: str, size) -> Image.Image:
        with open(path, "rb") as fh:
            data = fh.read()
        if not data:
            raise SvgRenderError(f"SVG 文件是空的：{path}")

        buf = (ctypes.c_ubyte * len(data)).from_buffer_copy(data)
        err = ctypes.POINTER(_GError)()
        handle = self.rsvg.rsvg_handle_new_from_data(buf, len(data), ctypes.byref(err))
        if not handle:
            detail = self._take_error(err) if err else "未知错误"
            raise SvgRenderError(f"librsvg 无法读取 SVG：{path}（{detail}）")

        width, height = int(round(size[0])), int(round(size[1]))
        surface = None
        context = None
        try:
            surface = self.cairo.cairo_image_surface_create(
                _CAIRO_FORMAT_ARGB32, width, height
            )
            if not surface:
                raise SvgRenderError("cairo 无法创建绘图表面（可能内存不足）")
            context = self.cairo.cairo_create(surface)

            viewport = _RsvgRectangle(0.0, 0.0, float(width), float(height))
            err = ctypes.POINTER(_GError)()
            ok = self.rsvg.rsvg_handle_render_document(
                handle, context, ctypes.byref(viewport), ctypes.byref(err)
            )
            if not ok:
                detail = self._take_error(err) if err else "未知错误"
                raise SvgRenderError(f"librsvg 渲染失败：{path}（{detail}）")

            png_bytes = self._surface_to_png(surface, path)
        finally:
            if context:
                self.cairo.cairo_destroy(context)
            if surface:
                self.cairo.cairo_surface_destroy(surface)
            self.rsvg.rsvg_handle_free(handle)

        # 走 PNG 编解码而不是直接读像素，是为了拿到“非预乘”的 RGBA
        # （cairo 的 ARGB32 是预乘 alpha，直接当 RGBA 用会让半透明边缘发暗）
        return Image.open(BytesIO(png_bytes)).convert("RGBA")

    def _surface_to_png(self, surface, path: str) -> bytes:
        chunks = []

        def _write(_closure, data, length):
            chunks.append(ctypes.string_at(data, length))
            return _CAIRO_STATUS_SUCCESS

        callback = _CAIRO_WRITE_FUNC(_write)
        status = self.cairo.cairo_surface_write_to_png_stream(
            surface, callback, None
        )
        if status != _CAIRO_STATUS_SUCCESS or not chunks:
            raise SvgRenderError(f"cairo 导出 PNG 失败：{path}（status={status}）")
        return b"".join(chunks)


_librsvg_renderer = None
_librsvg_failed = False


def _get_librsvg_renderer():
    """惰性创建 librsvg 渲染器；找不到库时返回 None（只尝试一次）。"""
    global _librsvg_renderer, _librsvg_failed
    if _librsvg_renderer is not None or _librsvg_failed:
        return _librsvg_renderer
    platform_key = "win32" if sys.platform == "win32" else sys.platform
    names = _LIB_NAMES.get(platform_key)
    if names is None:
        _librsvg_failed = True
        return None
    cairo_name, rsvg_name = names
    lib_dir = _find_lib_dir(cairo_name, rsvg_name)
    if lib_dir is None:
        _librsvg_failed = True
        return None
    try:
        _librsvg_renderer = _LibrsvgRenderer(lib_dir)
    except OSError:
        _librsvg_failed = True
        return None
    return _librsvg_renderer


# --------------------------------------------------------------------------
# 对外接口
# --------------------------------------------------------------------------

def available_backend() -> str:
    """返回当前可用的后端名字：``"cairosvg"`` / ``"librsvg"`` / ``""``。"""
    if _has_cairosvg():
        return "cairosvg"
    if _get_librsvg_renderer() is not None:
        return "librsvg"
    return ""


def load_svg(path: str, size=None) -> Image.Image:
    """
    把 SVG 渲染成 RGBA 的 ``PIL.Image``。

    :param path: .svg 文件路径
    :param size: ``(width, height)`` 目标像素尺寸；省略则用 SVG 的固有尺寸
                 （没有就退到 1024x1024）。宽高比不一致时 SVG 会按
                 preserveAspectRatio 居中留白，不会变形。
    """
    if not os.path.isfile(path):
        raise SvgRenderError(f"找不到 SVG 文件：{path}")

    if size is None:
        size = svg_intrinsic_size(path) or (DEFAULT_SVG_SIZE, DEFAULT_SVG_SIZE)
    size = (max(1, int(round(size[0]))), max(1, int(round(size[1]))))

    errors = []

    if _has_cairosvg():
        try:
            return _render_with_cairosvg(path, size)
        except Exception as exc:  # cairosvg 装了但 cairo 库缺失等情况
            errors.append(f"cairosvg: {exc}")

    renderer = _get_librsvg_renderer()
    if renderer is not None:
        try:
            return renderer.render(path, size)
        except SvgRenderError:
            raise
        except Exception as exc:
            errors.append(f"librsvg: {exc}")

    detail = ("；".join(errors)) if errors else "没有找到可用的 SVG 渲染后端"
    raise SvgRenderError(
        "无法渲染 SVG：{0}\n{1}\n"
        "解决办法（任选其一）：\n"
        "  1) pip install cairosvg\n"
        "  2) 让脚本能找到 librsvg + cairo 动态库，例如：\n"
        "     set RSVG_LIB_DIR=<含 librsvg-2-2.dll 和 libcairo-2.dll 的目录>".format(
            path, detail
        )
    )
