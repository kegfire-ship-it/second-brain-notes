"""Search by meaning: Gemini turns text into vectors, a small SQLite file keeps them."""
import hashlib
import re
import sqlite3
import time
from html.parser import HTMLParser
from typing import Optional

import numpy as np
from google import genai

from core.config import settings

client = genai.Client(api_key=settings.GEMINI_API_KEY or "GEMINI_API_KEY_NOT_SET")
EMBEDDING_MODEL = "gemini-embedding-001"
DIMENSIONS = 768

_TRANSIENT_MARKERS = (
    "429", "RESOURCE_EXHAUSTED", "503", "UNAVAILABLE",
    "500", "INTERNAL", "DEADLINE", "deadline", "timeout", "Timeout",
)
_RETRY_BACKOFF_S = (0.4, 0.9, 1.8)


class EmbeddingError(Exception):
    """An embedding could not be produced after retries."""


class _HTMLStripper(HTMLParser):
    def __init__(self):
        super().__init__()
        self._chunks = []

    def handle_data(self, data):
        self._chunks.append(data)

    def get_text(self):
        return "".join(self._chunks)


def strip_html(html: str) -> str:
    if not html:
        return ""
    parser = _HTMLStripper()
    parser.feed(html)
    return re.sub(r"\s+", " ", parser.get_text()).strip()


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(settings.VECTORS_PATH, timeout=10)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute(
        "CREATE TABLE IF NOT EXISTS note_vectors ("
        "id TEXT PRIMARY KEY, user_id TEXT NOT NULL, category TEXT NOT NULL, "
        "title TEXT NOT NULL, text_hash TEXT NOT NULL, vector BLOB NOT NULL)"
    )
    return conn


def generate_embedding(text: str, task_type: str = "RETRIEVAL_DOCUMENT", raise_on_failure: bool = False):
    if not settings.GEMINI_API_KEY:
        if raise_on_failure:
            raise EmbeddingError("GEMINI_API_KEY is not set")
        return None

    last_err: Optional[Exception] = None
    for attempt in range(len(_RETRY_BACKOFF_S) + 1):
        try:
            result = client.models.embed_content(
                model=EMBEDDING_MODEL,
                contents=text,
                config={"task_type": task_type, "output_dimensionality": DIMENSIONS},
            )
            return result.embeddings[0].values
        except Exception as e:
            last_err = e
            if any(m in str(e) for m in _TRANSIENT_MARKERS) and attempt < len(_RETRY_BACKOFF_S):
                time.sleep(_RETRY_BACKOFF_S[attempt])
                continue
            break

    print(f"Gemini embedding error: {last_err}")
    if raise_on_failure:
        raise EmbeddingError(str(last_err))
    return None


def _unit_bytes(values) -> bytes:
    vector = np.asarray(values, dtype=np.float32)
    norm = np.linalg.norm(vector)
    return (vector / norm if norm else vector).tobytes()


def upsert_note_vector(note_id: str, title: str, content: str, category: str, user_id: str):
    text = f"Title: {title}\nCategory: {category}\nContent: {content}"
    text_hash = hashlib.sha256(text.encode("utf-8")).hexdigest()

    with _connect() as conn:
        row = conn.execute("SELECT text_hash FROM note_vectors WHERE id = ?", (note_id,)).fetchone()
    # Dragging or pinning a note saves it too; don't spend the free quota on that.
    if row and row[0] == text_hash:
        return

    values = generate_embedding(text)
    if values is None:
        return

    with _connect() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO note_vectors VALUES (?, ?, ?, ?, ?, ?)",
            (note_id, user_id, category, title, text_hash, _unit_bytes(values)),
        )


def delete_note_vector(note_id: str):
    with _connect() as conn:
        conn.execute("DELETE FROM note_vectors WHERE id = ?", (note_id,))


def search_similar_notes(
    query: str, user_id: str, top_k: int = 10,
    category: Optional[str] = None, raise_on_failure: bool = False,
):
    values = generate_embedding(query, task_type="RETRIEVAL_QUERY", raise_on_failure=raise_on_failure)
    if values is None:
        return []

    sql = "SELECT id, vector FROM note_vectors WHERE user_id = ?"
    params = [user_id]
    if category:
        sql += " AND category = ?"
        params.append(category)
    with _connect() as conn:
        rows = conn.execute(sql, params).fetchall()
    if not rows:
        return []

    matrix = np.frombuffer(b"".join(r[1] for r in rows), dtype=np.float32).reshape(len(rows), DIMENSIONS)
    scores = matrix @ np.frombuffer(_unit_bytes(values), dtype=np.float32)
    best = np.argsort(-scores)[:top_k]
    return [{"id": rows[i][0], "score": float(scores[i]), "metadata": {}} for i in best]
