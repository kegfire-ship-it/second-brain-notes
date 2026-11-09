"""Generate a short title for a note. Primary: Groq gpt-oss-120b. Fallback: Gemini 3.1 Flash Lite."""
from services import app_usage
import concurrent.futures
from contextvars import copy_context
import re

from google import genai
from google.genai import types
from openai import OpenAI

from core.config import settings

gemini_client = genai.Client(api_key=settings.GEMINI_API_KEY or "GEMINI_API_KEY_NOT_SET")

# OpenAI SDK rejects an empty api_key at construction. Use a sentinel so the
# module imports cleanly without GROQ_API_KEY set; actual calls are gated below.
groq_client = OpenAI(
    api_key=settings.GROQ_API_KEY or "GROQ_API_KEY_NOT_SET",
    base_url="https://api.groq.com/openai/v1",
    timeout=5.0,
)

_PRIMARY_MODEL = "openai/gpt-oss-120b"
_FALLBACK_MODEL = "gemini-3.1-flash-lite"
_GEMINI_TIMEOUT_SECONDS = 6.0

_PROMPT = """Read the note and come up with a short title: 5-8 words,
in the same language as the note, no quotes, no period at the end,
no emoji. Only the title, nothing else.

Note:
{content_text}"""

_TAG_RE = re.compile(r"<[^>]*>")
_WS_RE = re.compile(r"\s+")
_QUOTE_CHARS = "\"'“”‘’«»"

_MAX_CONTENT_CHARS = 4000      # truncation before sending to the model
_MAX_TITLE_CHARS = 80          # post-clip on the returned title
_MIN_PLAINTEXT = 20            # below this we 400 (FAB also gates on this)
_MAX_PLAINTEXT = 50000         # defensive upper bound


def _strip_html(html: str) -> str:
    """Remove HTML tags, collapse whitespace, trim. Used for length checks and prompt input."""
    if not html:
        return ""
    text = _TAG_RE.sub(" ", html)
    return _WS_RE.sub(" ", text).strip()


def _clean_title(raw: str) -> str:
    """Normalize model output into a clean one-line title, max 80 chars."""
    if not raw:
        return ""
    text = raw.replace("\n", " ")
    text = _WS_RE.sub(" ", text).strip()
    text = text.strip(_QUOTE_CHARS).strip()
    if text.endswith("."):
        text = text[:-1].rstrip()
    return text[:_MAX_TITLE_CHARS]


def _call_groq(prompt: str) -> str:
    """Primary path. OpenAI SDK enforces the 5s timeout set at client construction."""
    response = app_usage.call("groq", "title", _PRIMARY_MODEL, lambda: groq_client.chat.completions.create(
        model=_PRIMARY_MODEL,
        messages=[{"role": "user", "content": prompt}],
        temperature=0.4,
        max_tokens=128,
        reasoning_effort="low",
    ))
    return response.choices[0].message.content or ""


def _call_gemini(prompt: str) -> str:
    """Fallback path. Hard wall-clock timeout via thread pool — abandons the
    SDK call after _GEMINI_TIMEOUT_SECONDS even if its own HTTP timeout is
    longer or absent."""
    def _do_call():
        return app_usage.call("gemini", "title", _FALLBACK_MODEL, lambda: gemini_client.models.generate_content(
            model=_FALLBACK_MODEL,
            contents=prompt,
            config=types.GenerateContentConfig(
                temperature=0.4,
                max_output_tokens=128,
            ),
        ))

    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(copy_context().run, _do_call)
        response = future.result(timeout=_GEMINI_TIMEOUT_SECONDS)
    return response.text or ""


def generate_title(content_html: str) -> str:
    """Generate a 5-8-word title for a note from its HTML content.

    Tries Groq first (5s budget; sub-second in practice). On timeout or any
    exception, falls back to Gemini 3.1 Flash Lite (6s wall-clock budget).
    Without GROQ_API_KEY, skips Groq entirely and uses Gemini directly.

    Raises ValueError on validation failures or empty output from both.
    """
    plain = _strip_html(content_html)

    if len(plain) < _MIN_PLAINTEXT:
        raise ValueError(f"content too short: {len(plain)} < {_MIN_PLAINTEXT} chars")
    if len(plain) > _MAX_PLAINTEXT:
        raise ValueError(f"content too long: {len(plain)} > {_MAX_PLAINTEXT} chars")

    truncated = plain[:_MAX_CONTENT_CHARS]
    prompt = _PROMPT.format(content_text=truncated)

    if settings.GROQ_API_KEY:
        try:
            raw = _call_groq(prompt)
        except Exception as e:
            print(f"ai_title: Groq primary failed ({type(e).__name__}: {e}), falling back to Gemini")
            raw = _call_gemini(prompt)
    else:
        raw = _call_gemini(prompt)

    title = _clean_title(raw)
    if not title:
        raise ValueError("Both Groq and Gemini returned empty title")
    return title
