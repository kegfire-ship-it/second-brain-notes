import logging
import os
import re
import html
import secrets
import json
import shutil
import threading
import uuid
from functools import wraps
from html.parser import HTMLParser
import frontmatter
from pathlib import Path
from datetime import datetime, timedelta, timezone
from typing import List, Optional, Dict
from core.config import settings

_log = logging.getLogger(__name__)


def _clean_markdown_in_html(html: str) -> str:
    """Convert stray Markdown fragments (bold, bullets) inside HTML content."""
    if not html:
        return html
    # Convert **text** to <strong>text</strong>
    out = re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', html)
    # Convert bullet patterns (* <strong>...) into <ul><li> structure
    parts = re.split(r'\*\s{1,3}(?=<strong>)', out)
    if len(parts) > 1:
        prefix = parts[0].rstrip()
        if prefix.endswith('<p>'):
            prefix = prefix[:-3]
        items = list(parts[1:])
        last = items[-1]
        m = re.search(r'</p>', last)
        if m:
            trailing = last[m.start():]
            trailing = trailing.replace('</p>', '', 1)
            items[-1] = last[:m.start()].rstrip()
        else:
            trailing = ''
        li_html = ''.join(f'<li>{item.strip()}</li>' for item in items)
        out = f'{prefix}<ul>{li_html}</ul>{trailing}'
    return out


def get_note_snippet(content_html: Optional[str], max_chars: int = 150) -> str:
    """Plain-text preview of a note body for attached-item cards.

    Strips HTML tags, decodes entities, collapses whitespace, and truncates
    at a whole-word boundary (falling back to a hard cut for a single long
    word) with a trailing ellipsis. Plain text only — no inline formatting
    (spec §C1)."""
    if not content_html:
        return ""
    # Drop tags, then decode entities (&lt; &amp; &nbsp; …).
    text = re.sub(r"<[^>]+>", " ", content_html)
    text = html.unescape(text)
    # &nbsp; decodes to U+00A0 — normalise to a plain space before collapsing.
    text = text.replace(" ", " ")
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) <= max_chars:
        return text
    head = text[:max_chars]
    cut = head.rsplit(" ", 1)[0].rstrip()
    if not cut:  # single word longer than max_chars → hard cut
        cut = head
    return f"{cut}…"


CATEGORIES_FILE = Path(settings.NOTES_DIR) / ".." / "categories.json"

def _ensure_categories_file():
    """Ensure dynamic categories JSON exists."""
    if not CATEGORIES_FILE.parent.exists():
        CATEGORIES_FILE.parent.mkdir(parents=True, exist_ok=True)
    if not CATEGORIES_FILE.exists():
        with open(CATEGORIES_FILE, "w", encoding="utf-8") as f:
            json.dump([
                {"id": "Ideas", "user_id": "default_user"},
                {"id": "Philosophy and Knowledge", "user_id": "default_user"},
                {"id": "Projects and Technology", "user_id": "default_user"},
                {"id": "Health and Body", "user_id": "default_user"},
                {"id": "Miscellaneous", "user_id": "default_user"}
            ], f, indent=4)

def get_categories(user_id: Optional[str] = None) -> List[Dict]:
    _ensure_categories_file()
    try:
        with open(CATEGORIES_FILE, "r", encoding="utf-8") as f:
            cats = json.load(f)
            
            for c in cats:
                if "user_id" not in c:
                    c["user_id"] = "default_user"
                    
            if user_id:
                return [c for c in cats if c["user_id"] == user_id]
            return cats
    except Exception:
        return []

def save_categories(categories: List[Dict], user_id: Optional[str] = None):
    _ensure_categories_file()
    
    if user_id:
        for c in categories:
            c["user_id"] = user_id
            
        existing = get_categories()
        others = [c for c in existing if c.get("user_id", "default_user") != user_id]
        cats_to_save = others + categories
    else:
        cats_to_save = categories
        
    with open(CATEGORIES_FILE, "w", encoding="utf-8") as f:
         json.dump(cats_to_save, f, indent=4)

def _get_file_path(filename: str) -> Path:
    safe_name = os.path.basename(filename)
    if not safe_name.endswith('.md'):
        safe_name += '.md'
    return Path(settings.NOTES_DIR) / safe_name

def _parse_note_file(file_path: Path) -> dict:
    """Reads and parses a markdown file with optional YAML frontmatter."""
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            post = frontmatter.load(f)
            
        return {
            "id": post.get("id", file_path.stem),
            "title": post.get("title", ""),
            "category": post.get("category", "Miscellaneous"),
            "content": _clean_markdown_in_html(post.content),
            "color": post.get("color", "white"),
            "pinned": bool(post.get("pinned", False)),
            "order_index": int(post.get("order_index", 0)),
            "position": float(post.get("position", 0.0)),
            "user_id": str(post.get("user_id", "default_user")),
            "deletedAt": post.get("deletedAt", None),
            "share_token": post.get("share_token", None)
        }
    except Exception as e:
        print(f"Error reading {file_path}: {e}")
        # Return fallback on error
        return {
            "id": file_path.stem,
            "title": "",
            "category": "Miscellaneous",
            "content": "",
            "color": "white",
            "pinned": False,
            "order_index": 0,
            "position": 0.0,
            "user_id": "default_user",
            "deletedAt": None,
            "share_token": None
        }

def _write_note_file(file_path: Path, metadata: dict, content: str):
    """Writes content and metadata to a markdown file natively using YAML frontmatter.

    When the file already exists, its current frontmatter is loaded first so
    that fields the caller does not manage — notably `share_token` — survive
    the write instead of being silently dropped. The keys passed in `metadata`
    are authoritative: a value of None removes that key (e.g. restore clears
    `deletedAt`); everything else in the existing frontmatter is preserved.
    """
    if file_path.exists():
        with open(file_path, "r", encoding="utf-8") as f:
            post = frontmatter.load(f)
        post.content = content
    else:
        post = frontmatter.Post(content)

    # Safely assign managed fields, ensuring empty title stays "" and isn't None
    for key, value in metadata.items():
        if key == "title" and not value:
            post[key] = ""
        elif value is None:
            post.metadata.pop(key, None)
        else:
            post[key] = value

    _atomic_write_text(file_path, frontmatter.dumps(post))


def _atomic_write_text(file_path: Path, text: str) -> None:
    """Write via a temp file + os.replace, so a crash or a full disk mid-write
    leaves the previous note intact instead of a truncated one. The temp name
    does not end in `.md`, so the notes scan never picks it up."""
    tmp = file_path.with_name(f".{file_path.name}.{uuid.uuid4().hex}.tmp")
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            f.write(text)
            f.flush()
            os.fsync(f.fileno())
        if file_path.exists():
            shutil.copymode(file_path, tmp)
        os.replace(tmp, file_path)
    finally:
        if tmp.exists():
            try:
                tmp.unlink()
            except OSError:
                pass

# Serialize extraction append and editor saves in the single API process.
# RLock permits append_extraction to reuse the ordinary note writer.
_note_write_lock = threading.RLock()
_EXTRACTION_BLOCK = re.compile(r'<blockquote\b[^>]*data-extraction-id=["\']([a-f0-9-]+)["\'][^>]*>.*?</blockquote>', re.S)


def extraction_blocks(content):
    blocks = []
    for match in _EXTRACTION_BLOCK.finditer(content or ''):
        source = re.search(r'\bdata-video-url=["\']([^"\']*)["\']', match.group(0).split('>', 1)[0])
        blocks.append({'id': match.group(1), 'html': match.group(0),
                       'source_url': html.unescape(source.group(1)) if source else None})
    return blocks


def _insert_extraction(content, block, source_url=None):
    """Keep a generated block beside its source without rewriting existing HTML."""
    if not source_url:
        return content + block
    from services.video_metadata import youtube_url
    canonical = youtube_url(source_url) or source_url

    class SourceParagraph(HTMLParser):
        def __init__(self):
            super().__init__()
            self.in_paragraph = False
            self.matches = False
            self.text = []
            self.end = None
            self.quote_depth = 0
            self.lines = [0]
            for match in re.finditer('\n', content):
                self.lines.append(match.end())

        def handle_starttag(self, tag, attrs):
            if tag == 'blockquote':
                self.quote_depth += 1
            if tag == 'p' and not self.quote_depth:
                self.in_paragraph, self.matches, self.text = True, False, []
            if tag == 'a' and self.in_paragraph:
                href = dict(attrs).get('href', '')
                self.matches |= (youtube_url(href) or href) == canonical

        def handle_data(self, text):
            if self.in_paragraph:
                self.text.append(text)

        def handle_endtag(self, tag):
            if tag == 'blockquote':
                self.quote_depth = max(0, self.quote_depth - 1)
            if tag == 'p' and self.in_paragraph:
                if self.end is None and (self.matches or source_url in ''.join(self.text)):
                    line, col = self.getpos()
                    self.end = content.find('>', self.lines[line - 1] + col) + 1
                self.in_paragraph = False

    parser = SourceParagraph()
    parser.feed(content)
    if parser.end is None:
        return content + block
    position = parser.end
    # Newest result stays directly below the card, replacing its live preview.
    return content[:position] + block + content[position:]


def _serialized_write(fn):
    @wraps(fn)
    def wrapped(*args, **kwargs):
        with _note_write_lock:
            return fn(*args, **kwargs)
    return wrapped


def append_extraction(note_id, user_id, extraction_id, generated_html, source_url=None):
    with _note_write_lock:
        note = get_note(note_id)
        if not note or note.get("user_id") != user_id or note.get("deletedAt"):
            raise ValueError("Note unavailable")
        source_attr = f' data-video-url="{html.escape(source_url, quote=True)}"' if source_url else ''
        block = generated_html.replace("<blockquote>", f'<blockquote data-extraction-id="{extraction_id}"{source_attr}>', 1)
        if extraction_id not in {b["id"] for b in extraction_blocks(note["content"])}:
            note["content"] = _insert_extraction(note['content'], block, source_url)
        fields = {key: note[key] for key in ("title", "category", "content", "color", "pinned", "position", "order_index", "user_id")}
        return create_or_update_note_file(note_id=note_id, **fields)


@_serialized_write
def create_or_update_note_file(note_id: str, title: str, category: str, content: str, color: str = "white", pinned: bool = False, order_index: int = 0, position: float = 0.0, user_id: str = "default_user", deletedAt: Optional[str] = None, base_content: Optional[str] = None) -> dict:
    """
    Saves a note to the local disk as a Markdown file using YAML frontmatter.
    """
    file_path = _get_file_path(f"{note_id}.md")

    # Snapshot BEFORE the write so the ingest emit can detect create vs update
    # vs soft-delete (the latter is a deletedAt transition).
    pre = get_note(note_id)
    # Preserve only AI blocks the editor never saw. Once present in its base,
    # normal editing/deletion wins. Non-editor service callers retain replace semantics.
    incoming_ids = {b["id"] for b in extraction_blocks(content)}
    known_ids = {b["id"] for b in extraction_blocks(base_content)}
    for block in reversed(extraction_blocks(pre.get("content", "") if pre and base_content is not None else "")):
        if block["id"] not in incoming_ids and block["id"] not in known_ids:
            content = _insert_extraction(content, block['html'], block.get('source_url'))


    clean_title = title.strip() if title else ""
    metadata = {
        "id": note_id,
        "title": clean_title,
        "category": category,
        "color": color,
        "pinned": pinned,
        "order_index": order_index,
        "position": position,
        "user_id": user_id,
        "deletedAt": deletedAt
    }

    _write_note_file(file_path, metadata, content)

    stat = os.stat(file_path)
    # Return formatted date string "DD/MM/YYYY HH:mm" as requested for sorting and UI
    time_str = datetime.fromtimestamp(stat.st_mtime).strftime("%d/%m/%Y %H:%M")

    result = {
        "id": note_id,
        "title": clean_title,
        "category": category,
        "content": content,
        "color": color,
        "pinned": pinned,
        "order_index": order_index,
        "position": position,
        "user_id": user_id,
        "deletedAt": deletedAt,
        "filename": f"{note_id}.md",
        "updatedAt": time_str
    }

    return result

def get_note(note_id: str) -> Optional[dict]:
    file_path = _get_file_path(f"{note_id}.md")
    if file_path.exists():
        parsed = _parse_note_file(file_path)
        stat = os.stat(file_path)
        time_obj = datetime.fromtimestamp(stat.st_mtime)
        return {
            **parsed,
            "filename": file_path.name,
            "updatedAt": time_obj.strftime("%d/%m/%Y %H:%M")
        }
    return None


def get_live_note(note_id: str, user_id: str) -> Optional[dict]:
    """get_note + the standard liveness filter that every note-reference resolver
    must apply (anchor notes, task-linked notes, project_read). Returns the note
    only if it exists, is owned by `user_id`, and is NOT soft-deleted; otherwise
    None so the caller skips a dead/foreign reference.

    Soft-delete keeps the .md file on disk (only stamps `deletedAt`), so a plain
    `get_note() is not None` check is not enough — without the `deletedAt` guard a
    deleted note lingers in a project's attached notes and in AI context.
    """
    note = get_note(note_id)
    if note is None or note.get("user_id") != user_id or note.get("deletedAt"):
        return None
    return note

# In-process cache of parsed note files, keyed by absolute path → (mtime_ns, entry).
# get_all_notes() used to frontmatter.load() EVERY file on EVERY request (~326ms
# over ~1200 notes on prod) before applying `limit` — so even returning 4 pinned
# notes took ~580ms. Re-validating the directory via scandir is only ~12ms, so we
# reuse already-parsed entries for files whose mtime is unchanged and re-parse only
# the ones that actually changed. Any write — in-process or external — bumps the
# file's mtime (we key on nanosecond mtime), so the cache can never serve stale data.
_PARSE_CACHE: Dict[str, tuple] = {}
# Serialises cache reads/writes across FastAPI's sync-endpoint threadpool. The
# Dashboard fires two /api/notes requests in parallel, so without this both could
# do the full cold rebuild at once; it also keeps the evict/refresh sequence atomic.
_CACHE_LOCK = threading.Lock()


def _clear_notes_cache() -> None:
    """Drop the whole parse cache. Used by tests and available as an escape hatch."""
    with _CACHE_LOCK:
        _PARSE_CACHE.clear()


def _load_notes_index() -> List[dict]:
    """All .md files in NOTES_DIR as parsed entries, served from an mtime-keyed
    cache. Each entry has the same shape get_all_notes built inline before: the
    parsed fields + filename + updatedAt + an internal `_raw_time` used for sorting.

    Cheap path (nothing changed): one scandir (stat-only, no file open) + dict
    lookups. Expensive path: only files whose mtime differs are re-parsed."""
    notes_dir = Path(settings.NOTES_DIR)
    current: Dict[str, os.stat_result] = {}
    try:
        with os.scandir(notes_dir) as it:
            for entry in it:
                if not entry.name.endswith(".md"):
                    continue
                try:
                    current[entry.path] = entry.stat()
                except OSError:
                    continue
    except FileNotFoundError:
        current = {}

    with _CACHE_LOCK:
        # Evict entries whose file no longer exists (deleted, or — in tests — a
        # stale NOTES_DIR). Snapshot keys first so we can mutate while iterating.
        for path in list(_PARSE_CACHE.keys()):
            if path not in current:
                _PARSE_CACHE.pop(path, None)

        entries: List[dict] = []
        for path, st in current.items():
            cached = _PARSE_CACHE.get(path)
            if cached is not None and cached[0] == st.st_mtime_ns:
                entries.append(cached[1])
                continue
            try:
                parsed = _parse_note_file(Path(path))
            except Exception as e:
                print(f"Error reading {path}: {e}")
                continue
            entry = {
                **parsed,
                "filename": os.path.basename(path),
                "updatedAt": datetime.fromtimestamp(st.st_mtime).strftime("%d/%m/%Y %H:%M"),
                "_raw_time": st.st_mtime,  # internal use for sorting
            }
            _PARSE_CACHE[path] = (st.st_mtime_ns, entry)
            entries.append(entry)
        return entries


def get_all_notes(
    user_id: Optional[str] = None,
    include_deleted: bool = False,
    only_deleted: bool = False,
    pinned: Optional[bool] = None,
    after: Optional[str] = None,
    limit: Optional[int] = None,
    category: Optional[str] = None,
) -> List[dict]:
    """
    Returns notes read from disk via an mtime-keyed parse cache (see _load_notes_index),
    then filtered / sorted / paginated. Cached entries are never mutated here.
    """
    notes = []
    for entry in _load_notes_index():
        deleted_at_str = entry.get("deletedAt")
        if deleted_at_str:
            try:
                deleted_time = datetime.fromisoformat(deleted_at_str)
                # Use utc timezone for naive datetimes if needed
                now = datetime.now(timezone.utc) if deleted_time.tzinfo else datetime.utcnow()
                if (now - deleted_time).days > 30:
                    file_path = Path(settings.NOTES_DIR) / entry["filename"]
                    try:
                        os.remove(file_path)
                        _PARSE_CACHE.pop(str(file_path), None)
                        from services import vector
                        vector.delete_note_vector(entry["id"])
                    except Exception:
                        pass
                    continue
            except ValueError:
                pass

        if only_deleted and not deleted_at_str:
            continue
        if not include_deleted and not only_deleted and deleted_at_str:
            continue

        note_user_id = entry.get("user_id")
        if user_id and note_user_id and note_user_id != user_id:
            continue

        notes.append(entry)

    # Filter by pin state if requested — do this BEFORE sorting so we don't
    # sort items that will be discarded, and so each sort branch operates on
    # a homogeneous list.
    if pinned is not None:
        notes = [n for n in notes if bool(n.get("pinned", False)) == pinned]

    # Filter by category if requested — before sorting, so limit applies
    # to the most-recent matches of that category.
    if category is not None:
        notes = [n for n in notes if n["category"] == category]

    # Sort: matches what the frontend renders.
    # - When `pinned=True`: position DESC (manual drag order).
    # - When `pinned=False`: effective time DESC, where effective time =
    #   order_index (ms since epoch, set at creation) if non-zero, otherwise
    #   the file's mtime (in ms). Falling back to mtime keeps notes that lack
    #   a proper order_index (created via the bot, or pre-migration) sorted
    #   correctly into the chronological stream instead of dumped at the end.
    # - When `pinned` not specified (legacy callers): pinned first, then position, then mtime.
    def _effective_time_ms(n):
        oi = int(n.get("order_index") or 0)
        return oi if oi > 0 else int(n["_raw_time"] * 1000)

    if pinned is True:
        notes.sort(key=lambda x: -x.get("position", 0.0))
    elif pinned is False:
        notes.sort(key=lambda x: -_effective_time_ms(x))
    else:
        notes.sort(key=lambda x: (
            not x["pinned"],
            -x.get("position", 0.0),
            -x["_raw_time"],
        ))

    # Cursor: skip past the cursor note (it was the last item of the previous page).
    if after is not None:
        try:
            idx = next(i for i, n in enumerate(notes) if n["id"] == after)
            notes = notes[idx + 1:]
        except StopIteration:
            return []

    # Limit
    if limit is not None:
        notes = notes[:limit]

    # Return shallow copies of the final page with the internal sort key removed,
    # so the cached entries themselves stay pristine and the public shape is unchanged.
    return [{k: v for k, v in n.items() if k != "_raw_time"} for n in notes]


_BLOCK_TAGS = {"p", "div", "blockquote", "pre", "ul", "ol", "table", "tr", "hr",
               "h1", "h2", "h3", "h4", "h5", "h6", "li", "details", "summary"}


def _link_label_redundant(label: str, href: str) -> bool:
    """True when the visible link text is just (part of) the URL itself —
    e.g. the auto-label «coggle.it» for https://coggle.it/diagram/… ."""
    bare = re.sub(r"^https?://(www\.)?", "", label.strip().lower()).rstrip("/")
    return not bare or bare in href.lower()


class _PlainText(HTMLParser):
    """HTML note body → readable plain text that keeps everything meaningful:
    every word, every link URL, headings, list items and line structure.
    Only presentation (tags, classes, inline styles) is dropped."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out: List[str] = []
        self.link: Optional[tuple] = None  # (href, collected label parts)
        self.skip = 0
        self.pre = 0

    def _newline(self):
        self.out.append("\n")

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag in ("script", "style"):
            self.skip += 1
        elif tag == "br":
            self._newline()
        elif tag == "pre":
            self.pre += 1
            self._newline()
        elif tag == "li":
            self.out.append("\n- ")
        elif tag in ("h1", "h2", "h3", "h4", "h5", "h6"):
            self.out.append("\n" + "#" * int(tag[1]) + " ")
        elif tag in _BLOCK_TAGS:
            self._newline()
        elif tag == "a" and a.get("href"):
            self.link = (a["href"], [])
        elif tag == "img":
            src = a.get("src") or ""
            alt = (a.get("alt") or "").strip()
            label = "image" + (f": {alt}" if alt else "")
            if src and not src.startswith("data:"):
                label += f" {src}"
            self.out.append(f"[{label}]")

    def handle_endtag(self, tag):
        if tag in ("script", "style"):
            self.skip = max(0, self.skip - 1)
        elif tag == "pre":
            self.pre = max(0, self.pre - 1)
            self._newline()
        elif tag == "a" and self.link is not None:
            href, parts = self.link
            self.link = None
            label = re.sub(r"\s+", " ", "".join(parts)).strip()
            if _link_label_redundant(label, href):
                self.out.append(href)
            else:
                self.out.append(f"{label} ({href})")
        elif tag in _BLOCK_TAGS and tag != "li":  # next <li> opens its own line
            self._newline()

    def handle_data(self, data):
        if self.skip:
            return
        if not self.pre:
            data = re.sub(r"\s+", " ", data)
        if self.link is not None:
            self.link[1].append(data)
        else:
            self.out.append(data)

    def text(self) -> str:
        if self.link is not None:  # unclosed <a> — keep what we collected
            self.handle_endtag("a")
        lines = [ln.strip() for ln in "".join(self.out).replace("\u00a0", " ").split("\n")]
        text = "\n".join(lines)
        return re.sub(r"\n{3,}", "\n\n", text).strip()


def note_plain_text(content_html: Optional[str]) -> str:
    """Full note body as plain text — nothing is truncated (see _PlainText)."""
    if not content_html:
        return ""
    parser = _PlainText()
    parser.feed(content_html)
    parser.close()
    return parser.text()


# note id → (mtime it was converted at, plain text). Converting HTML is the only
# non-trivial cost of note_digest, so it is done once per note version.
_TEXT_CACHE: Dict[str, tuple] = {}


def notes_in_period(user_id: str, start: datetime, end: datetime) -> List[dict]:
    """Live notes of `user_id` CREATED or EDITED in [start, end), oldest first,
    each with its full plain-text body. Empty notes are skipped.

    Created = order_index (ms since epoch, set at creation) or, when absent,
    the file mtime; edited = file mtime. Served from the parse cache, so a
    call touches the disk only for notes that changed since the last read."""
    start_ms, end_ms = start.timestamp() * 1000, end.timestamp() * 1000
    out: List[dict] = []
    for e in _load_notes_index():
        if e.get("deletedAt"):
            continue
        if e.get("user_id") and e["user_id"] != user_id:
            continue
        edited_ms = float(e["_raw_time"]) * 1000
        created_ms = int(e.get("order_index") or 0) or edited_ms
        created_in = start_ms <= created_ms < end_ms
        if not created_in and not (start_ms <= edited_ms < end_ms):
            continue
        cached = _TEXT_CACHE.get(e["id"])
        if cached is not None and cached[0] == e["_raw_time"]:
            text = cached[1]
        else:
            text = note_plain_text(e.get("content"))
            _TEXT_CACHE[e["id"]] = (e["_raw_time"], text)
        if not text and not (e.get("title") or "").strip():
            continue
        out.append({
            "id": e["id"],
            "title": e.get("title") or "",
            "category": e.get("category") or "",
            "color": e.get("color", "white"),
            "pinned": bool(e.get("pinned", False)),
            "created_ms": created_ms,
            "edited_ms": edited_ms,
            "match": "created" if created_in else "edited",
            "text": text,
        })
    out.sort(key=lambda n: n["created_ms"])
    return out

def soft_delete_note_file(note_id: str) -> bool:
    note = get_note(note_id)
    if note:
        deleted_at = datetime.utcnow().isoformat()
        create_or_update_note_file(
            note_id=note["id"],
            title=note.get("title", ""),
            category=note.get("category", ""),
            content=note.get("content", ""),
            color=note.get("color", "white"),
            pinned=note.get("pinned", False),
            order_index=note.get("order_index", 0),
            position=note.get("position", 0.0),
            user_id=note.get("user_id", "default_user"),
            deletedAt=deleted_at
        )
        return True
    return False

def restore_note_file(note_id: str) -> bool:
    note = get_note(note_id)
    if note:
        create_or_update_note_file(
            note_id=note["id"],
            title=note.get("title", ""),
            category=note.get("category", ""),
            content=note.get("content", ""),
            color=note.get("color", "white"),
            pinned=note.get("pinned", False),
            order_index=note.get("order_index", 0),
            position=note.get("position", 0.0),
            user_id=note.get("user_id", "default_user"),
            deletedAt=None
        )
        return True
    return False


def delete_note_file_permanently(note_id: str) -> bool:
    file_path = _get_file_path(f"{note_id}.md")
    if file_path.exists():
        os.remove(file_path)
        return True
    return False

def rename_category(old_name: str, new_name: str, user_id: str):
    cats = get_categories()
    for c in cats:
        if c.get("id") == old_name and c.get("user_id", "default_user") == user_id:
            c["id"] = new_name
    save_categories(cats)
    
    # Cascade update
    all_n = get_all_notes(user_id=user_id)
    from services import vector
    for n in all_n:
        if n.get("category") == old_name:
            create_or_update_note_file(
                note_id=n["id"],
                title=n["title"],
                category=new_name,
                content=n["content"],
                color=n.get("color", "white"),
                pinned=n.get("pinned", False),
                order_index=n.get("order_index", 0),
                position=n.get("position", 0.0),
                user_id=n.get("user_id", "default_user")
            )
            vector.upsert_note_vector(
                note_id=n["id"],
                title=n["title"],
                category=new_name,
                content=n["content"],
                user_id=n.get("user_id", "default_user"),
            )

def delete_category(name: str, user_id: str):
    cats = [c for c in get_categories() if not (c.get("id") == name and c.get("user_id", "default_user") == user_id)]
    save_categories(cats)
    
    # Cascade update
    all_n = get_all_notes(user_id=user_id)
    from services import vector
    for n in all_n:
        if n.get("category") == name:
            create_or_update_note_file(
                note_id=n["id"],
                title=n["title"],
                category="",
                content=n["content"],
                color=n.get("color", "white"),
                pinned=n.get("pinned", False),
                order_index=n.get("order_index", 0),
                position=n.get("position", 0.0),
                user_id=n.get("user_id", "default_user")
            )
            vector.upsert_note_vector(
                note_id=n["id"],
                title=n["title"],
                category="",
                content=n["content"],
                user_id=n.get("user_id", "default_user"),
            )


def generate_share_token(note_id: str) -> Optional[str]:
    """Generate a share token for a note. Returns existing token if already shared."""
    file_path = _get_file_path(f"{note_id}.md")
    if not file_path.exists():
        return None

    with open(file_path, "r", encoding="utf-8") as f:
        post = frontmatter.load(f)

    existing_token = post.get("share_token")
    if existing_token:
        return existing_token

    token = secrets.token_urlsafe(6)
    post["share_token"] = token

    _atomic_write_text(file_path, frontmatter.dumps(post))

    return token


def remove_share_token(note_id: str) -> bool:
    """Remove the share token from a note, disabling public access."""
    file_path = _get_file_path(f"{note_id}.md")
    if not file_path.exists():
        return False

    with open(file_path, "r", encoding="utf-8") as f:
        post = frontmatter.load(f)

    if "share_token" not in post.metadata:
        return True  # Already unshared

    del post.metadata["share_token"]

    _atomic_write_text(file_path, frontmatter.dumps(post))

    return True


def get_note_by_share_token(token: str) -> Optional[dict]:
    """Scan all notes and return the one matching the share token. Excludes deleted notes."""
    for file_path in Path(settings.NOTES_DIR).glob("*.md"):
        try:
            parsed = _parse_note_file(file_path)
            if parsed.get("share_token") == token and not parsed.get("deletedAt"):
                stat = os.stat(file_path)
                time_obj = datetime.fromtimestamp(stat.st_mtime)
                return {
                    "title": parsed.get("title", ""),
                    "content": parsed.get("content", ""),
                    "color": parsed.get("color", "white"),
                    "category": parsed.get("category", ""),
                    "updatedAt": time_obj.strftime("%d/%m/%Y %H:%M")
                }
        except Exception:
            continue
    return None
