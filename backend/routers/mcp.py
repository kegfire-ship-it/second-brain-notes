"""MCP server: lets the owner's Claude read and write notes."""
from datetime import datetime
from typing import Optional
import uuid

from mcp.server.fastmcp import FastMCP

from core.auth_user import OWNER_ID
from services import notes as notes_svc, note_search as note_search_svc, vector


mcp = FastMCP("Second Brain Notes")
# Inner route is "/", so with app.mount("/mcp", ...) the public path is /mcp/.
mcp.settings.streamable_http_path = "/"
mcp.settings.stateless_http = True
mcp.settings.json_response = True


def get_user_id() -> str:
    return OWNER_ID


@mcp.tool()
def note_search(
    query: str,
    limit: int = 10,
    category: Optional[str] = None,
    full_content: bool = False,
) -> list[dict]:
    """Searches the user's personal Second Brain knowledge base.

    Hybrid: notes containing the words (with synonyms and RU/EN spellings —
    "insta" also finds instagram.com links) come first, then notes that
    match by meaning. Short keywords and natural-language phrases both work. By default, returns lightweight results with a snippet — call
    `note_get(id)` afterwards for the full content of the relevant ones.

    Use `full_content=True` only when the user explicitly asks for a synthesis
    across multiple notes. With `full_content=True`, `limit` is capped at 3 to
    avoid context blowup.
    """
    user_id = get_user_id()
    effective_limit = min(limit, 3) if full_content else limit
    try:
        outcome = note_search_svc.hybrid_search(
            query, user_id, limit=effective_limit, category=category,
            semantic_floor=None, semantic_only_rank=effective_limit,
        )
    except note_search_svc.SearchUnavailable:
        raise ValueError("Search temporarily unavailable (embedding service down) — retry shortly.")

    results = []
    for h in outcome.hits:
        e = h.entry
        item = {
            "id": str(e["id"]),
            "title": str(e.get("title") or ""),
            "category": str(e.get("category") or ""),
            "score": h.vec_score or 0.0,  # semantic similarity; 0.0 for keyword-only hits
            "match": h.match,             # "both" | "keyword" | "semantic"
            "snippet": notes_svc.get_note_snippet(e.get("content"), 300),
        }
        if full_content:
            item["content"] = e.get("content", "")
        results.append(item)
    return results


@mcp.tool()
def note_get(note_id: str) -> dict:
    """Retrieves a single note by id. Returns full HTML content — call only
    after `note_search` has identified relevant ids."""
    user_id = get_user_id()
    note = notes_svc.get_note(note_id)
    if note is None:
        raise ValueError(f"Note {note_id} not found")
    if note.get("user_id") != user_id:
        # Treat ownership mismatch as not found to avoid information leakage
        raise ValueError(f"Note {note_id} not found")
    return {
        "id": note["id"],
        "title": note["title"],
        "content": note["content"],
        "category": note["category"],
        "color": note.get("color", "white"),
        "pinned": note.get("pinned", False),
        "updatedAt": note.get("updatedAt", ""),
    }


@mcp.tool()
def note_list_recent(
    limit: int = 20,
    category: Optional[str] = None,
    pinned: Optional[bool] = None,
) -> list[dict]:
    """Lists the user's notes ordered by recency (or by manual position when
    `pinned=True`). Returns metadata only — no content. Use this for browsing.
    To read or analyse notes of a period ("this month", "this year"), use
    `note_digest` — one call with full text, not note_get per note. For
    semantic search, use `note_search` instead."""
    user_id = get_user_id()
    items = notes_svc.get_all_notes(
        user_id=user_id, include_deleted=False, pinned=pinned, limit=limit,
    )
    if category:
        items = [n for n in items if n.get("category") == category]
    return [
        {
            "id": n["id"],
            "title": n["title"],
            "category": n["category"],
            "color": n.get("color", "white"),
            "pinned": n.get("pinned", False),
            "updatedAt": n.get("updatedAt", ""),
        }
        for n in items
    ]


DIGEST_PAGE_CHARS = 60_000


def _digest_pages(notes: list[dict]) -> list[int]:
    """Start offsets of each page. A page holds whole notes only — a note is
    never split, and one bigger than the budget gets a page of its own."""
    starts, size = [0], 0
    for i, n in enumerate(notes):
        cost = len(n["text"]) + len(n["title"]) + 150  # ~metadata overhead
        if size and size + cost > DIGEST_PAGE_CHARS:
            starts.append(i)
            size = 0
        size += cost
    return starts


@mcp.tool()
def note_digest(
    date_from: str,
    date_to: str,
    cursor: Optional[str] = None,
    tz: str = "UTC",
) -> dict:
    """ALL of the user's notes for a period, with FULL text, in one call. Use
    this for any question about a time span — "what was I thinking about this month",
    "last month", "the last 3 months", "this year", "in October last year".

    You convert the user's phrase into dates yourself: `date_from` and
    `date_to` are inclusive calendar days, YYYY-MM-DD, in `tz`. A note is
    included if it was created OR edited in the period (`match` says which).
    Bodies are full plain text (HTML stripped, link URLs kept) — never
    truncated. Notes come oldest first; empty notes are skipped.

    Long periods are paged by size, never splitting a note. The first page
    reports `pages` and `total_notes`; while `next_cursor` is not null, call
    again with `cursor=next_cursor` (same dates) to get the rest — read every
    page before drawing conclusions about the whole period."""
    from datetime import date, timedelta
    from zoneinfo import ZoneInfo

    user_id = get_user_id()
    try:
        zone = ZoneInfo(tz)
    except Exception:
        raise ValueError(f"Unknown timezone {tz!r} — use an IANA name like Europe/Berlin")
    try:
        d_from, d_to = date.fromisoformat(date_from), date.fromisoformat(date_to)
    except ValueError:
        raise ValueError("date_from / date_to must be YYYY-MM-DD")
    if d_to < d_from:
        raise ValueError("date_to is before date_from")
    start = datetime(d_from.year, d_from.month, d_from.day, tzinfo=zone)
    end_day = d_to + timedelta(days=1)
    end = datetime(end_day.year, end_day.month, end_day.day, tzinfo=zone)

    notes = notes_svc.notes_in_period(user_id, start, end)
    starts = _digest_pages(notes) if notes else [0]
    try:
        offset = int(cursor) if cursor else 0
    except ValueError:
        raise ValueError("Invalid cursor — pass next_cursor from the previous page")
    if offset not in starts:
        raise ValueError("Invalid cursor — pass next_cursor from the previous page")
    page = starts.index(offset)
    stop = starts[page + 1] if page + 1 < len(starts) else len(notes)

    def _fmt(ms: float) -> str:
        return datetime.fromtimestamp(ms / 1000, zone).strftime("%Y-%m-%d %H:%M")

    return {
        "period": {"from": date_from, "to": date_to, "tz": tz},
        "total_notes": len(notes),
        "total_chars": sum(len(n["text"]) for n in notes),
        "page": page + 1,
        "pages": len(starts),
        "next_cursor": str(stop) if stop < len(notes) else None,
        "notes": [
            {
                "id": n["id"],
                "title": n["title"],
                "category": n["category"],
                "color": n["color"],
                "pinned": n["pinned"],
                "created": _fmt(n["created_ms"]),
                "edited": _fmt(n["edited_ms"]),
                "match": n["match"],
                "text": n["text"],
            }
            for n in notes[offset:stop]
        ],
    }


@mcp.tool()
def note_list_categories() -> list[dict]:
    """Returns the user's categories — useful before `note_create` to pick an
    existing category instead of inventing a new one."""
    user_id = get_user_id()
    cats = notes_svc.get_categories(user_id=user_id)
    return [{"id": c.get("id", ""), "color": c.get("color")} for c in cats]


@mcp.tool()
def note_create(
    title: str,
    content: str,
    category: str,
    color: str = "white",
    pinned: bool = False,
) -> dict:
    """Creates a new note in the user's Second Brain.

    IMPORTANT: `content` MUST be valid HTML. The editor stores HTML, not Markdown.
    Use `<p>`, `<ul>`, `<li>`, `<h2>`, `<a>`, `<strong>`, `<em>` tags as appropriate.
    Do NOT use Markdown syntax like `**bold**` or `# heading`.

    Use `note_list_categories()` first to pick an existing category instead of inventing one."""
    user_id = get_user_id()
    note_id = str(uuid.uuid4())
    result = notes_svc.create_or_update_note_file(
        note_id=note_id, title=title, category=category, content=content,
        color=color, pinned=pinned, user_id=user_id,
    )
    vector.upsert_note_vector(
        note_id=note_id, title=title, content=content,
        category=category, user_id=user_id,
    )
    return {
        "id": result["id"],
        "title": result["title"],
        "content": result["content"],
        "category": result["category"],
        "color": result["color"],
        "pinned": result["pinned"],
        "updatedAt": result["updatedAt"],
    }


def _owned_live_note_or_raise(note_id: str, user_id: str) -> dict:
    """Return the note if it exists, belongs to the user and is not in trash.
    Ownership mismatch is reported as "not found" to avoid leaking ids."""
    note = notes_svc.get_note(note_id)
    if note is None or note.get("user_id") != user_id or note.get("deletedAt"):
        raise ValueError(f"Note {note_id} not found")
    return note


@mcp.tool()
def note_update(
    note_id: str,
    title: Optional[str] = None,
    content: Optional[str] = None,
    category: Optional[str] = None,
    color: Optional[str] = None,
    pinned: Optional[bool] = None,
) -> dict:
    """Edits an existing note. Only the fields you pass change; omitted fields
    keep their current value.

    IMPORTANT: `content` REPLACES the whole note body and MUST be valid HTML
    (same rules as `note_create`). To append or tweak, first `note_get` the note,
    edit its HTML, then send the full result back. Notes in trash can't be edited."""
    user_id = get_user_id()
    note = _owned_live_note_or_raise(note_id, user_id)

    new_title = note.get("title", "") if title is None else title
    new_content = note.get("content", "") if content is None else content
    new_category = note.get("category", "") if category is None else category

    result = notes_svc.create_or_update_note_file(
        note_id=note_id,
        title=new_title,
        category=new_category,
        content=new_content,
        color=note.get("color", "white") if color is None else color,
        pinned=note.get("pinned", False) if pinned is None else pinned,
        order_index=note.get("order_index", 0),
        position=note.get("position", 0.0),
        user_id=user_id,
    )
    vector.upsert_note_vector(
        note_id=note_id, title=new_title, content=result["content"],
        category=new_category, user_id=user_id,
    )
    return {
        "id": result["id"],
        "title": result["title"],
        "content": result["content"],
        "category": result["category"],
        "color": result["color"],
        "pinned": result["pinned"],
        "updatedAt": result["updatedAt"],
    }


@mcp.tool()
def note_delete(note_id: str) -> dict:
    """Moves a note to the trash (soft delete). It disappears from search and
    lists but can be restored from the trash in the Second Brain app. Permanent
    deletion is only possible from the app itself — ask the user before deleting."""
    user_id = get_user_id()
    note = _owned_live_note_or_raise(note_id, user_id)
    if not notes_svc.soft_delete_note_file(note_id):
        raise ValueError(f"Note {note_id} not found")
    vector.delete_note_vector(note_id)
    return {"id": note_id, "title": note.get("title", ""), "deleted": True}
