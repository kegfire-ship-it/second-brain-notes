from fastapi import APIRouter, Depends, HTTPException, Request

from core.config import settings
from core.security import get_current_user
from services import notes

router = APIRouter(prefix="/api", tags=["share"])


@router.post("/notes/{note_id}/share")
def share_note(note_id: str, request: Request, current_user: str = Depends(get_current_user)):
    """Generate a share token for a note. Returns existing token if already shared."""
    existing = notes.get_note(note_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Note not found")
    if existing.get("user_id") != current_user:
        raise HTTPException(status_code=403, detail="Forbidden")

    token = notes.generate_share_token(note_id)
    if not token:
        raise HTTPException(status_code=500, detail="Could not generate share token")

    return {
        "share_token": token,
        "url": f"{(settings.PUBLIC_URL or str(request.base_url)).rstrip('/')}/shared/{token}",
    }


@router.get("/shared/{share_token}")
def get_shared_note(share_token: str):
    """Public endpoint. Returns note content by share token. No auth required."""
    note_data = notes.get_note_by_share_token(share_token)
    if not note_data:
        raise HTTPException(status_code=404, detail="Shared note not found")
    return note_data


@router.delete("/notes/{note_id}/share")
def unshare_note(note_id: str, current_user: str = Depends(get_current_user)):
    """Remove the share token from a note, disabling public access."""
    existing = notes.get_note(note_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Note not found")
    if existing.get("user_id") != current_user:
        raise HTTPException(status_code=403, detail="Forbidden")

    success = notes.remove_share_token(note_id)
    if not success:
        raise HTTPException(status_code=404, detail="Note file not found")
    return {"message": "Share link removed"}
