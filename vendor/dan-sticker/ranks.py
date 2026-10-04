# -*- coding: utf-8 -*-
"""
段位名 → 贴纸文件 的映射
========================

群里写段位的默认格式是 ``(x)k[ln](x)``：
``(x)`` 是变量，``[ln]`` 表示这一段可有可无。

**光写数字或希腊字母时，按 4k 处理。**

============================  ==================  ==========================
群里怎么写                      归到哪组             对应文件
============================  ==================  ==========================
``3`` / ``4k3``                4k 数字              ``3.png``
``gamma`` / ``4kgamma``        4k 希腊字母           ``gamma.png``
``4kln3`` / ``ln3`` / ``ln-3`` 4kln                ``ln-3.png``
``7k3``                        7k 数字              ``7-3.png``
``7kstellium``                 7k 字母              ``7-stellium.png``
``7kln3``                      7kln 数字            ``7-ln-3.png``
``7klnstellium``               7kln 字母            ``7-ln-stellium.png``
============================  ==================  ==========================

字母部分**支持模糊拼写**（``7kstelium`` / ``7kstelliun`` 都认成 ``stellium``），
毕竟这几个单词确实不好记。匹配顺序是：

1. 完全一致
2. 唯一前缀（``7kstel`` → ``stellium``）
3. 拼写近似（difflib，保底 0.6 相似度）

四种段位组各自的内容（对应 dan/ 里的文件）：

* **4k**  —— 数字 ``1``~``10``，以及纯粹希腊字母 ``alpha``~``kappa``
* **4kln** —— ``ln-`` + 数字（``ln-1``~``ln-17``）
* **7k**  —— ``7-`` + 数字（``7-0``~``7-10``）或 ``7-`` + 字母
* **7kln** —— ``7-ln-`` + 数字或字母
"""

from __future__ import annotations

import difflib
import os
import re

__all__ = [
    "GREEK_LETTERS",
    "EXTRA_LETTERS",
    "resolve",
    "explain",
    "all_stems",
]

#: 4k 组的字母部分
GREEK_LETTERS = (
    "alpha", "beta", "gamma", "delta", "epsilon",
    "zeta", "eta", "theta", "iota", "kappa",
)

#: 7k / 7kln 组的字母部分
EXTRA_LETTERS = ("gamma", "azimuth", "zenith", "stellium")

#: 模糊匹配的最低相似度
FUZZY_CUTOFF = 0.6

#: 解析前先扔掉的后缀
_STRIP_EXT = (".svg", ".png", ".webp", ".jpg", ".jpeg", ".bmp")

#: ``(x)k[ln](x)``
_GRAMMAR = re.compile(r"^(?:(?P<key>\d+)k)?(?P<ln>ln)?(?P<who>.*)$")


def _normalize(text: str) -> str:
    """小写、去掉空格 / 连字符 / 下划线 / 后缀，便于统一比较。"""
    value = str(text).strip().lower()
    for ext in _STRIP_EXT:
        if value.endswith(ext):
            value = value[: -len(ext)]
            break
    return re.sub(r"[\s\-_]+", "", value)


def all_stems(sticker_dir: str):
    """列出贴纸目录里所有贴纸名（不含后缀）。"""
    if not os.path.isdir(sticker_dir):
        return set()
    stems = set()
    for name in os.listdir(sticker_dir):
        stem, ext = os.path.splitext(name)
        if ext.lower() in _STRIP_EXT:
            stems.add(stem.lower())
    return stems


def _match_letter(word: str, candidates):
    """把用户拼的字母部分对到规范名上：完全一致 → 唯一前缀 → 模糊拼写。"""
    if word in candidates:
        return word
    prefixed = [c for c in candidates if c.startswith(word)]
    if len(prefixed) == 1:
        return prefixed[0]
    hits = difflib.get_close_matches(word, candidates, n=1, cutoff=FUZZY_CUTOFF)
    return hits[0] if hits else None


def _letter_stem(word, key, ln, known, prefix=""):
    """字母部分 → 贴纸名。"""
    if key == 4 and ln:
        return None                       # 4kln 只有数字，没有字母

    if key == 7:
        candidates = EXTRA_LETTERS
        base = "7-ln-" if ln else "7-"
        matched = _match_letter(word, candidates)
        if matched:
            stem = base + matched
            if stem in known:
                return stem
        return None

    # key 是 4（或没写）且不是 ln：先当 4k 的希腊字母
    matched = _match_letter(word, GREEK_LETTERS)
    if matched and matched in known:
        return matched

    # 兜底：会不会其实是 7k 的字母（比如只写了 stellium）
    if not ln:
        matched = _match_letter(word, EXTRA_LETTERS)
        if matched:
            stem = "7-" + matched
            if stem in known:
                return stem
    return None


def _number_stem(number, key, ln):
    """数字部分 → 贴纸名。"""
    if key is None:
        key = 4                           # 光写数字 = 4k
    if key == 4:
        stem = f"ln-{number}" if ln else number
    elif key == 7:
        stem = f"7-ln-{number}" if ln else f"7-{number}"
    else:
        return None
    return stem


def resolve(text: str, known):
    """
    把群里写的段位解析成贴纸名（不含后缀）；解析不出来返回 ``None``。

    :param text: 用户写的那一小段，例如 ``"7kstellium"``
    :param known: 贴纸目录里实际存在的名字集合，见 :func:`all_stems`

    >>> stems = {"3", "gamma", "ln-3", "7-3", "7-stellium", "7-ln-3", "7-ln-stellium"}
    >>> resolve("3", stems)
    '3'
    >>> resolve("4k3", stems)
    '3'
    >>> resolve("gamma", stems)
    'gamma'
    >>> resolve("4kln3", stems)
    'ln-3'
    >>> resolve("7k3", stems)
    '7-3'
    >>> resolve("7kstellium", stems)
    '7-stellium'
    >>> resolve("7kstelium", stems)      # 拼错了也认
    '7-stellium'
    >>> resolve("7kstel", stems)         # 唯一前缀
    '7-stellium'
    >>> resolve("7klnstellium", stems)
    '7-ln-stellium'
    >>> resolve("ln-3", stems)
    'ln-3'
    >>> resolve("7-ln-zenith", {"7-ln-zenith"})   # 直接照文件名写也认
    '7-ln-zenith'
    >>> resolve("不存在", stems) is None
    True
    """
    if not text:
        return None
    # 归一化之后建表，这样 "7-ln-zenith" / "7lnzenith" / "7_LN_Zenith" 都能对上
    norm_map = {_normalize(stem): stem for stem in known}
    norm = _normalize(text)
    if not norm:
        return None

    # 1) 已经就是贴纸名（用户直接照文件名写）
    if norm in norm_map:
        return norm_map[norm]

    known = {k.lower() for k in known}

    # 2) 按 (x)k[ln](x) 语法拆
    match = _GRAMMAR.match(norm)
    if not match:
        return None
    raw_key = match.group("key")
    key = int(raw_key) if raw_key else None
    ln = bool(match.group("ln"))
    who = match.group("who")
    if not who:
        return None

    if who.isdigit():
        stem = _number_stem(str(int(who)), key, ln)
        return stem if stem in known else None

    if who.isalpha():
        return _letter_stem(who, key, ln, known)

    # 数字和字母混在一起、又没拆开 —— 不猜
    return None


def explain(key: str):
    """给帮助菜单用：把一次解析过程讲清楚。"""
    return (
        f"写法 {(key)!r} —— 归组规则：\n"
        f"  光写数字或希腊字母        -> 4k\n"
        f"  <数字>k 开头              -> 对应组（4k / 7k …）\n"
        f"  …k 后面跟 ln              -> 该组的 ln 版本\n"
        f"  4k     : 数字 1~10、希腊字母 alpha~kappa\n"
        f"  4kln   : ln-数字（ln-1~ln-17）\n"
        f"  7k     : 7-数字（7-0~7-10）或 7-字母\n"
        f"  7kln   : 7-ln-数字 或 7-ln-字母\n"
        f"  字母支持模糊拼写，例如 7kstelium / 7kstel 都认"
    )
