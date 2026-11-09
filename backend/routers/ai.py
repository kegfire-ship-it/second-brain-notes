import asyncio
import json
import logging
import threading
import uuid
import re
import time as _time

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel, Field
from fastapi.responses import StreamingResponse

from core.security import get_current_user
from services import app_usage, notes, ai_video, ai_title, ai_polish, ai_link_description, vector, video_metadata

router = APIRouter(prefix="/api/notes", tags=["ai"])


YOUTUBE_REGEX = re.compile(
    r'https?://(?:www\.|m\.)?(?:youtube\.com/(?:watch\?v=|shorts/|live/)|youtu\.be/)[^\s"<)]+'
)
INSTAGRAM_REGEX = re.compile(
    r'https?://(?:www\.)?instagram\.com/(?:reel|reels|p)/[^\s"<)]+'
)

# In-memory extraction status, keyed by note_id
_extraction_status: dict[str, dict] = {}
_STATUS_TTL = 86400  # terminal snapshots survive reopen/reconnect for a day
_status_lock = threading.RLock()
_log = logging.getLogger(__name__)


class GenerateTitleRequest(BaseModel):
    content: str


class DescribeLinkRequest(BaseModel):
    url: str = Field(min_length=1, max_length=2048)


class PolishSelectionRequest(BaseModel):
    text: str


class AIExtractRequest(BaseModel):
    url: str
    mode: str  # "steps" or "ideas"


@router.get('/video/metadata')
def get_video_metadata(url: str, current_user: str = Depends(get_current_user)):
    if INSTAGRAM_REGEX.fullmatch(url):
        with app_usage.usage_scope(current_user):
            return ai_video.instagram_metadata(url)
    try:
        return video_metadata.get_metadata(url)
    except ValueError:
        raise HTTPException(status_code=400, detail='Invalid YouTube URL')


@router.post("/generate-title")
def generate_note_title(
    data: GenerateTitleRequest, current_user: str = Depends(get_current_user)
):
    """Generate a short (5-8-word) title for a note from its HTML content."""
    try:
        with app_usage.usage_scope(current_user):
            title = ai_title.generate_title(data.content)
    except ValueError as e:
        msg = str(e).lower()
        if "short" in msg or "long" in msg:
            raise HTTPException(status_code=400, detail=str(e))
        raise HTTPException(status_code=502, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Title generation failed: {e}")
    return {"title": title}


@router.post("/describe-link")
def describe_note_link(
    data: DescribeLinkRequest, current_user: str = Depends(get_current_user)
):
    """Return only editable description text; never write a note or its title."""
    try:
        with app_usage.usage_scope(current_user):
            description = ai_link_description.describe_link(data.url)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None
    except ai_link_description.PageUnavailable as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from None
    except Exception:
        raise HTTPException(status_code=502, detail="Couldn't read the site. Please try again.") from None
    return {"description": description}


@router.post("/polish-selection")
def polish_note_selection(
    data: PolishSelectionRequest, current_user: str = Depends(get_current_user)
):
    """Run selected plain-text through the editor prompt; return the cleaned text."""
    try:
        with app_usage.usage_scope(current_user):
            result = ai_polish.polish_text(data.text)
    except ValueError as e:
        msg = str(e).lower()
        if "short" in msg or "long" in msg:
            raise HTTPException(status_code=400, detail=str(e))
        raise HTTPException(status_code=502, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Text polish failed: {e}")
    return {"text": result}


@router.post("/{note_id}/ai-extract", status_code=202)
def ai_extract_from_video(
    note_id: str,
    data: AIExtractRequest,
    background_tasks: BackgroundTasks,
    current_user: str = Depends(get_current_user),
):
    """Extract insights from a video using Gemini AI. Returns 202 immediately."""
    existing = notes.get_note(note_id)
    if not existing or existing.get('deletedAt'):
        raise HTTPException(status_code=404, detail="Note not found")
    if existing.get("user_id") != current_user:
        raise HTTPException(status_code=403, detail="Forbidden")

    if data.mode not in ("steps", "ideas"):
        raise HTTPException(status_code=400, detail="Mode must be 'steps' or 'ideas'")

    if not video_metadata.youtube_url(data.url) and not INSTAGRAM_REGEX.fullmatch(data.url):
        raise HTTPException(status_code=400, detail="Only YouTube and Instagram URLs are supported")

    with _status_lock:
        _prune_status()
        entry = _extraction_status.get(note_id)
        if entry and entry["stage"] not in ("done", "error"):
            return {"status": "already_processing", "id": entry["id"]}
        entry = {"id": str(uuid.uuid4()), "stage": "preparing", "mode": data.mode, "url": data.url,
                 "started_at": _time.time(), "items": [], "error": None}
        _extraction_status[note_id] = entry
    background_tasks.add_task(_run_ai_extraction, note_id, data.url, data.mode, current_user, entry["id"])
    return {"status": "processing", "id": entry["id"]}


def _owned_note(note_id, current_user):
    note = notes.get_note(note_id)
    if not note or note.get("deletedAt"):
        raise HTTPException(status_code=404, detail="Note not found")
    if note.get("user_id") != current_user:
        raise HTTPException(status_code=403, detail="Forbidden")
    return note


def _prune_status():
    now = _time.time()
    for key, value in list(_extraction_status.items()):
        if value.get("finished_at") and now - value["finished_at"] > _STATUS_TTL:
            del _extraction_status[key]


def _snapshot(note_id):
    with _status_lock:
        _prune_status()
        entry = _extraction_status.get(note_id)
        return dict(entry, items=list(entry["items"])) if entry else {"stage": "idle"}


@router.get("/{note_id}/extract-status")
def get_extraction_status(note_id: str, current_user: str = Depends(get_current_user)):
    _owned_note(note_id, current_user)
    snapshot = _snapshot(note_id)
    note = _owned_note(note_id, current_user)
    blocks = notes.extraction_blocks(note["content"])
    if snapshot["stage"] == "done":
        snapshot["block"] = next((b for b in blocks if b["id"] == snapshot["id"]), None)
    return dict(snapshot, saved_blocks=blocks)


@router.get("/{note_id}/extract-stream")
def stream_extraction(note_id: str, current_user: str = Depends(get_current_user)):
    _owned_note(note_id, current_user)

    async def events():
        previous = None
        heartbeat = _time.monotonic()
        while True:
            snapshot = _snapshot(note_id)
            if previous is None:
                saved_blocks = notes.extraction_blocks(_owned_note(note_id, current_user)["content"])
                snapshot["saved_blocks"] = saved_blocks
                if snapshot["stage"] == "done":
                    snapshot["block"] = next((b for b in saved_blocks if b["id"] == snapshot["id"]), None)
            payload = json.dumps(snapshot, ensure_ascii=False)
            if payload != previous:
                yield f"data: {payload}\n\n"
                previous = payload
            if snapshot["stage"] in ("idle", "done", "error"):
                return
            if _time.monotonic() - heartbeat >= 15:
                yield ": keepalive\n\n"
                heartbeat = _time.monotonic()
            await asyncio.sleep(0.15)

    return StreamingResponse(events(), media_type="text/event-stream", headers={
        "Cache-Control": "no-cache", "X-Accel-Buffering": "no",
    })


def _run_ai_extraction(note_id: str, url: str, mode: str, user_id: str, extraction_id: str):
    def update(**fields):
        with _status_lock:
            entry = _extraction_status.get(note_id)
            if entry and entry["id"] == extraction_id:
                entry.update(fields)

    try:
        with app_usage.usage_scope(user_id):
            generated_html = ai_video.extract_from_url(
                url, mode, on_status=lambda stage: update(stage=stage),
                on_items=lambda items: update(items=items),
                on_step=lambda step: update(step=step),
            )
        update(stage="saving")
        result = notes.append_extraction(note_id, user_id, extraction_id, generated_html, source_url=url)
        block = next(b for b in notes.extraction_blocks(result["content"]) if b["id"] == extraction_id)
        # The durable write is the completion boundary, not vector indexing.
        update(stage="done", block=block, finished_at=_time.time())
    except Exception as exc:
        _log.warning("video extraction failed id=%s type=%s", extraction_id, type(exc).__name__)
        message = ("Instagram needs an Apify token. Add it to the settings."
                   if "APIFY_API_TOKEN" in str(exc) else "Couldn't extract anything. Please try again.")
        update(stage="error", error=message, finished_at=_time.time())
        return
    try:
        vector.upsert_note_vector(note_id=note_id, title=result["title"], category=result["category"],
                                  content=result["content"], user_id=user_id)
    except Exception as exc:
        _log.warning("video indexing failed id=%s type=%s", extraction_id, type(exc).__name__)
