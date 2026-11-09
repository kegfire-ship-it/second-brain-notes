import os
from pathlib import Path

from pydantic_settings import BaseSettings

BACKEND_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    PROJECT_NAME: str = "Second Brain Notes"

    # Everything secret comes from .env in the project folder, which the installer writes.
    APP_PASSWORD: str = ""
    SECRET_KEY: str = ""
    MCP_TOKEN: str = ""
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 14  # 2 weeks, renewed while in use

    # Public address, used for share links. Empty: taken from the request.
    PUBLIC_URL: str = ""

    # Notes are plain files here. Back up this one folder and you have everything.
    DATA_DIR: str = str(BACKEND_DIR / "data")

    GEMINI_API_KEY: str = ""
    APIFY_API_TOKEN: str = ""  # optional, only for Instagram links
    GROQ_API_KEY: str = ""  # optional, makes titles and text cleanup faster
    SUPADATA_API_KEY: str = ""  # optional, reads YouTube subtitles instead of the video

    @property
    def NOTES_DIR(self) -> str:
        return str(Path(self.DATA_DIR) / "notes")

    @property
    def VECTORS_PATH(self) -> str:
        return str(Path(self.DATA_DIR) / "vectors.sqlite")

    @property
    def REEL_CACHE_DIR(self) -> str:
        return str(Path(self.DATA_DIR) / "cache" / "reels")

    class Config:
        case_sensitive = True
        env_file = str(BACKEND_DIR.parent / ".env")
        extra = "ignore"


settings = Settings()

Path(settings.NOTES_DIR).mkdir(parents=True, exist_ok=True)
