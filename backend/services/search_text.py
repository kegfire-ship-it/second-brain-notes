"""Pure text helpers for the hybrid notes search (no I/O, no app imports).

The same `fold` is applied to indexed text and to queries, so the two sides
always agree on case, ё/е, diacritics and odd whitespace. Synonyms and Russian
endings are expanded on the QUERY side only, so editing the dictionary never
needs a reindex.
"""
import html
import re
import unicodedata
from html.parser import HTMLParser
from typing import List, Optional, Set, Tuple

MAX_QUERY_CHARS = 200
MAX_TOKENS = 8
MAX_TOKEN_LEN = 64

_ZW = dict.fromkeys(map(ord, "​‌‍⁠﻿­"), None)
_WS = re.compile(r"\s+")
_WORD = re.compile(r"\w+")


def fold(s: str) -> str:
    """Lowercase + ё→е + strip Latin diacritics (ș ț ă â î é …) + collapse
    whitespace. Cyrillic й is left alone."""
    s = unicodedata.normalize("NFKC", s or "").translate(_ZW).casefold().replace("ё", "е")
    s = "".join(unicodedata.normalize("NFD", c)[0] if 0x7F < ord(c) < 0x250 else c for c in s)
    return _WS.sub(" ", s).strip()


# --- HTML → text ---------------------------------------------------------------

_KNOWN_TAG = re.compile(
    r"<\s*/?\s*(p|br|div|span|a|li|ul|ol|h[1-6]|blockquote|pre|code|strong|em|b|i|u|s|mark|hr"
    r"|table|tr|td|th|img|figure|iframe)\b", re.I)
_INLINE = {"strong", "em", "b", "i", "u", "s", "mark", "code", "span", "a", "sub", "sup"}


class _TextExtractor(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts: List[str] = []
        self.hrefs: List[str] = []

    def handle_starttag(self, tag, attrs):
        if tag not in _INLINE:
            self.parts.append(" ")
        for name, value in attrs:
            if name in ("href", "src", "data-video-url") and value and not value.startswith("data:"):
                self.hrefs.append(value)

    def handle_endtag(self, tag):
        if tag not in _INLINE:
            self.parts.append(" ")

    def handle_data(self, data):
        self.parts.append(data)


def html_to_text(content: str) -> Tuple[str, List[str]]:
    """Visible text (block tags become spaces, so words never glue together)
    plus link targets. Link targets matter: a URL that lives only in href=""
    is invisible to a plain tag-strip."""
    content = content or ""
    if not _KNOWN_TAG.search(content):
        return html.unescape(content), []
    p = _TextExtractor()
    try:
        p.feed(content)
        p.close()
        return "".join(p.parts), p.hrefs
    except Exception:
        return html.unescape(re.sub(r"<[^>]+>", " ", content)), []


_URL = re.compile(r"https?://(?:www\.)?([^\s?#]+)\S*", re.I)


def strip_urls(s: str) -> str:
    """Keep host + path of URLs, drop scheme/www/query string (?igsh=, utm_…)
    so tracking noise never becomes searchable tokens."""
    return _URL.sub(r"\1", s)


def index_tokens(s: str) -> str:
    return " ".join(t for t in _WORD.findall(s.replace("_", " ")) if len(t) <= MAX_TOKEN_LEN)


# --- query side ----------------------------------------------------------------

STOPWORDS = frozenset((
    "и в во на с со к по о об от до для за из у не но а или что как это то же ли бы я "
    "мой моя мои при про без над под через "
    "the a an of for to in on at and or is are with my me it this that how what about from by "
    "si de la cu pe un sa"
).split())

# `x*` = prefix term, otherwise exact. A variant with a space is a phrase (never a trigger).
SYNONYM_GROUPS: Tuple[Tuple[str, ...], ...] = (
    ("instagram*", "инстаграм*", "инста", "инсту", "инсты", "инсте", "insta"),
    ("youtube*", "youtu", "ютуб*", "ютьюб*", "ютюб*"),
    ("telegram*", "телеграм*", "телега", "телеги", "телеге", "телегу", "тг", "tg"),
    ("reel", "reels", "рилс*", "рилз*"),
    ("stories", "story", "сторис*"),
    ("tiktok*", "тикток*", "тик ток"),
    ("ai", "ии", "нейросет*", "нейронк*"),
    ("claude*", "клод*"),
    ("chatgpt*", "чатгпт*", "чат гпт"),
    ("gemini*", "гемини*", "джемини*"),
    ("agent*", "агент*"),
    ("skill*", "скилл*", "скил*"),
    ("prompt*", "промпт*", "промт*"),
    ("video*", "видео*"),
    ("site", "sites", "website*", "сайт*"),
    ("3d", "3д"),
    ("google*", "гугл*"),
    ("github*", "гитхаб*"),
    ("notion*", "ноушн*", "ноушен*"),
    ("figma*", "фигм*"),
    ("whatsapp*", "ватсап*", "вотсап*", "вацап*"),
    ("midjourney*", "миджорни*", "мидджорни*"),
    ("facebook*", "фейсбук*", "фэйсбук*"),
    ("manychat*", "меничат*", "мэничат*"),
    ("lisbon*", "lisboa*", "лиссабон*"),
    ("madeira*", "мадейр*"),
    ("api", "апи"),
    ("mcp", "мцп"),
    ("todoist*", "тудуист*"),
)


def _parse_variant(v: str) -> Tuple[str, bool]:
    return (v[:-1], True) if v.endswith("*") else (v, False)


def synonyms_for(token: str) -> Set[Tuple[str, bool]]:
    """(term, is_prefix) variants for every group the token belongs to. A token
    triggers a group if it equals an exact variant, or starts with a prefix
    variant's stem and is at most 3 chars longer (инстаграмом → yes,
    агентство → no)."""
    out: Set[Tuple[str, bool]] = set()
    for group in SYNONYM_GROUPS:
        hit = False
        for v in group:
            term, is_prefix = _parse_variant(v)
            if " " in term:
                continue
            if token == term or (is_prefix and token.startswith(term) and len(token) - len(term) <= 3):
                hit = True
                break
        if hit:
            out.update(_parse_variant(v) for v in group)
    return out


_CYR = re.compile(r"^[а-я]+$")
_RU_ENDINGS = ("", "а", "я", "ы", "и", "е", "у", "ю", "ой", "ей", "ом", "ем", "ам", "ям",
               "ами", "ями", "ах", "ях", "ов", "ев", "ь", "ью", "й")


def ru_noun_forms(t: str) -> Set[str]:
    """Exact case forms for a Cyrillic word ending in а/я/ь/и/ы (идея → идеи,
    идей, идею…). Exact, never prefix, so short stems can't explode."""
    if len(t) < 4 or not _CYR.match(t) or t[-1] not in "аяьиы":
        return set()
    stem = t[:-1]
    return {stem + e for e in _RU_ENDINGS if len(stem + e) >= 3} - {t}


def _q(term: str, prefix: bool) -> str:
    # Every term is a quoted FTS5 string: user input can never inject syntax
    # (AND/OR/NOT/NEAR, *, ^, :, parentheses) — only our own `*` is appended.
    return '"' + term.replace('"', '""') + '"' + ("*" if prefix else "")


def query_tokens(q_fold: str) -> List[str]:
    seen, toks = set(), []
    for t in _WORD.findall(q_fold.replace("_", " ")):
        if 2 <= len(t) <= MAX_TOKEN_LEN and t not in seen:
            seen.add(t)
            toks.append(t)
    content = [t for t in toks if t not in STOPWORDS]
    return (content or toks)[:MAX_TOKENS]


def build_match_query(q_fold: str) -> Optional[str]:
    """FTS5 MATCH expression: one OR-group per query word, groups AND-ed.
    Returns None when nothing indexable is left (emoji, punctuation…)."""
    groups = []
    for t in query_tokens(strip_urls(q_fold)):
        terms: Set[Tuple[str, bool]] = {(t, False)}
        if len(t) >= 3:
            terms.add((t, True))
        terms.update((f, False) for f in ru_noun_forms(t))
        terms.update(synonyms_for(t))
        parts = []
        for term, prefix in sorted(terms):
            words = _WORD.findall(term)
            if not words:
                continue
            if len(words) > 1:  # phrase variant, e.g. "тик ток"
                parts.append('"' + " ".join(w.replace('"', '""') for w in words) + '"')
            else:
                parts.append(_q(words[0], prefix and len(words[0]) >= 2))
        if parts:
            groups.append("(" + " OR ".join(parts) + ")")
    return " AND ".join(groups) if groups else None
