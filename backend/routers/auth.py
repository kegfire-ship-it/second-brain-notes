import hmac
import time
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from core.auth_user import OWNER_ID
from core.config import settings
from core.security import create_access_token, get_current_user

router = APIRouter(prefix="/api/auth", tags=["auth"])

_MAX_FAILURES = 10
_WINDOW_S = 15 * 60
_failures: list[float] = []


class PasswordLogin(BaseModel):
    password: str


def _session_token() -> str:
    return create_access_token(
        data={"sub": OWNER_ID},
        expires_delta=timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES),
    )


@router.post("/login")
def login(data: PasswordLogin):
    now = time.monotonic()
    _failures[:] = [t for t in _failures if now - t < _WINDOW_S]
    if len(_failures) >= _MAX_FAILURES:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Too many attempts")
    if not hmac.compare_digest(data.password.encode(), settings.APP_PASSWORD.encode()):
        _failures.append(now)
        time.sleep(1)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Wrong password")
    return {"access_token": _session_token(), "token_type": "bearer"}


@router.post("/refresh")
def refresh_session(_: str = Depends(get_current_user)):
    return {"access_token": _session_token(), "token_type": "bearer"}
