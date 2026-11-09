import uuid
from typing import List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Response, status
from pydantic import BaseModel

from core.security import get_current_user
from services import note_search, notes, vector

router = APIRouter(prefix="/api", tags=["notes"])


class NoteCreateUpdate(BaseModel):
    title: str
    content: str
    category: str
    base_content: Optional[str] = None
    color: Optional[str] = "white"
    pinned: Optional[bool] = False
    position: Optional[float] = 0.0


class NoteResponse(BaseModel):
    id: str
    title: str
    content: str
    category: str
    color: str
    pinned: bool
    position: float
    updatedAt: str
    deletedAt: Optional[str] = None


class NoteIndexItem(BaseModel):
    """Content-free row for the project NotePicker. Carries only what the picker
    renders — title to search/show, category chip, color + pin to mirror the notes
    page. The HTML body is deliberately omitted so the whole library is cheap on
    the wire (~100KB for ~1200 notes vs ~1.5MB of full HTML)."""
    id: str
    title: str
    category: str
    color: str
    pinned: bool


@router.get("/notes", response_model=List[NoteResponse])
def get_notes(
    pinned: Optional[bool] = None,
    after: Optional[str] = None,
    limit: Optional[int] = None,
    category: Optional[str] = None,
    current_user: str = Depends(get_current_user),
):
    """Returns notes read directly from disk, with optional pinned/cursor/limit/category filters."""
    return notes.get_all_notes(
        user_id=current_user,
        include_deleted=False,
        pinned=pinned,
        after=after,
        limit=limit,
        category=category,
    )


@router.get("/notes/trash", response_model=List[NoteResponse])
def get_trash_notes(current_user: str = Depends(get_current_user)):
    """Returns only soft-deleted notes."""
    return notes.get_all_notes(user_id=current_user, only_deleted=True)


@router.get("/notes/index", response_model=List[NoteIndexItem])
def get_notes_index(current_user: str = Depends(get_current_user)):
    """Content-free listing of ALL the user's notes for the project NotePicker.
    Reuses get_all_notes (so it rides the mtime parse cache and the same
    user/deleted filtering + pinned-first sort); the NoteIndexItem response_model
    drops the HTML body and other heavy fields from the wire. Declared BEFORE
    /notes/{note_id} so the static `index` segment matches first."""
    return notes.get_all_notes(user_id=current_user, include_deleted=False)


@router.get("/notes/{note_id}", response_model=NoteResponse)
def get_single_note(note_id: str, current_user: str = Depends(get_current_user)):
    """Single note read (title + full HTML content). Used by the mindmap
    NoteDrawer to render a linked note over the canvas. Declared AFTER
    /notes/trash so that static segment still matches first."""
    note = notes.get_note(note_id)
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")
    if note.get("user_id") != current_user:
        raise HTTPException(status_code=403, detail="Forbidden")
    return note


@router.post("/notes", response_model=NoteResponse, status_code=status.HTTP_201_CREATED)
def create_note(
    data: NoteCreateUpdate,
    background_tasks: BackgroundTasks,
    current_user: str = Depends(get_current_user),
):
    note_id = str(uuid.uuid4())
    result = notes.create_or_update_note_file(
        note_id=note_id,
        title=data.title,
        category=data.category,
        content=data.content,
        color=data.color,
        pinned=data.pinned,
        position=data.position,
        user_id=current_user,
    )
    background_tasks.add_task(
        vector.upsert_note_vector,
        note_id, data.title, data.content, data.category, current_user,
    )
    return result


@router.put("/notes/{note_id}", response_model=NoteResponse)
def update_note(
    note_id: str,
    data: NoteCreateUpdate,
    background_tasks: BackgroundTasks,
    current_user: str = Depends(get_current_user),
):
    existing = notes.get_note(note_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Note not found")
    if existing.get("user_id") != current_user:
        raise HTTPException(status_code=403, detail="Forbidden")

    result = notes.create_or_update_note_file(
        note_id=note_id,
        title=data.title,
        category=data.category,
        content=data.content,
        base_content=data.base_content if data.base_content is not None else "",
        color=data.color,
        pinned=data.pinned,
        position=data.position,
        user_id=current_user,
    )
    background_tasks.add_task(
        vector.upsert_note_vector,
        note_id, data.title, result["content"], data.category, current_user,
    )
    return result


@router.delete("/notes/{note_id}")
def delete_note(note_id: str, current_user: str = Depends(get_current_user)):
    existing = notes.get_note(note_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Note not found")
    if existing.get("user_id") != current_user:
        raise HTTPException(status_code=403, detail="Forbidden")

    success = notes.soft_delete_note_file(note_id)
    if not success:
        raise HTTPException(status_code=404, detail="Note file could not be deleted")
    vector.delete_note_vector(note_id)
    return {"message": "Success"}


@router.post("/notes/{note_id}/restore", response_model=NoteResponse)
def restore_note(note_id: str, current_user: str = Depends(get_current_user)):
    existing = notes.get_note(note_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Note not found")
    if existing.get("user_id") != current_user:
        raise HTTPException(status_code=403, detail="Forbidden")

    success = notes.restore_note_file(note_id)
    if not success:
        raise HTTPException(status_code=404, detail="Note file could not be restored")

    restored = notes.get_note(note_id)
    vector.upsert_note_vector(
        note_id=note_id,
        title=restored["title"],
        category=restored["category"],
        content=restored["content"],
        user_id=current_user,
    )
    return restored


@router.delete("/notes/{note_id}/permanent")
def delete_note_permanently(note_id: str, current_user: str = Depends(get_current_user)):
    existing = notes.get_note(note_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Note not found")
    if existing.get("user_id") != current_user:
        raise HTTPException(status_code=403, detail="Forbidden")

    success = notes.delete_note_file_permanently(note_id)
    if not success:
        raise HTTPException(status_code=404, detail="Note file could not be permanently deleted")
    vector.delete_note_vector(note_id)
    return {"message": "Success"}


def _note_response(e: dict) -> dict:
    """A NEW dict built from the snapshot entry, with the FULL note HTML: search
    cards write the whole note back on edit, so this must never be a snippet."""
    return {
        "id": str(e["id"]),
        "title": str(e.get("title") or ""),
        "content": e.get("content") or "",
        "category": str(e.get("category") or ""),
        "color": str(e.get("color") or "white"),
        "pinned": bool(e.get("pinned")),
        "position": float(e.get("position") or 0.0),
        "updatedAt": e.get("updatedAt") or "",
        "deletedAt": None,
    }


@router.get("/search", response_model=List[NoteResponse])
def search_notes(q: str, response: Response, current_user: str = Depends(get_current_user)):
    """Hybrid search (services/note_search.py): notes containing the words
    (FTS5 with synonyms + literal substring) come first, newest first; then a few strong meaning-only matches in vector order.

    If Gemini is down, keyword results still come back (X-Search-Degraded).
    503 only when nothing trustworthy can be returned, so the client falls back
    to local search instead of showing a misleading "nothing found"."""
    try:
        outcome = note_search.hybrid_search(q, current_user, newest_first=True)
    except note_search.SearchUnavailable:
        raise HTTPException(status_code=503, detail="search temporarily unavailable")
    response.headers["X-Search-Info"] = outcome.info_header()
    if outcome.degraded:
        response.headers["X-Search-Degraded"] = outcome.degraded
    return [_note_response(h.entry) for h in outcome.hits]
