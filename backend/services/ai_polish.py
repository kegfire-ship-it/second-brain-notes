"""Polish (make-readable) selected note text without rewriting it.
Primary: Groq gpt-oss-120b. Fallback: Gemini 3.1 Flash Lite."""
from services import app_usage
import concurrent.futures
from contextvars import copy_context

from google import genai
from google.genai import types
from openai import OpenAI

from core.config import settings

gemini_client = genai.Client(api_key=settings.GEMINI_API_KEY or "GEMINI_API_KEY_NOT_SET")

# OpenAI SDK rejects an empty api_key at construction. Use a sentinel so the
# module imports cleanly without GROQ_API_KEY set; actual calls are gated below.
# Longer timeout than ai_title — the output is roughly as long as the input.
groq_client = OpenAI(
    api_key=settings.GROQ_API_KEY or "GROQ_API_KEY_NOT_SET",
    base_url="https://api.groq.com/openai/v1",
    timeout=15.0,
)

_PRIMARY_MODEL = "openai/gpt-oss-120b"
_FALLBACK_MODEL = "gemini-3.1-flash-lite"
_GEMINI_TIMEOUT_SECONDS = 18.0
_MAX_OUTPUT_TOKENS = 8192   # hard ceiling accepted by both models


def _output_token_budget(text: str) -> int:
    """Size the output budget to the input (output length ≈ input length).
    ~2 tokens/char is generous headroom for Cyrillic BPE; floored so short
    inputs still have room, capped at the model ceiling."""
    return min(_MAX_OUTPUT_TOKENS, max(1024, len(text) * 2))


_MIN_CHARS = 10        # below this we 400 (FAB also gates on this)
_MAX_CHARS = 6000      # above this we 400 — never silently truncate (would drop facts)

# Matching open->close quote pairs. _clean_output strips only a matched
# wrapping pair, never a mismatched one (e.g. a leading apostrophe + trailing ").
_QUOTE_PAIRS = {
    '"': '"',
    "'": "'",
    "\u2018": "\u2019",
    "\u201c": "\u201d",
    "\u00ab": "\u00bb",
}

_PROMPT = """You are an editor. You are given a messy note, often dictated. Your job is to make it readable and logically connected without turning it into someone else's text. Keep the language of the note.

WHAT TO DO:
- Add punctuation, fix typos and grammar.
- Split it into paragraphs by meaning if the original is a wall of text.
- Restore the word order where a thought is broken off.
- Fix obvious logical contradictions and restore correct cause and effect and who did what for whom.
- Remove filler words, repetition and fragments of unfinished thoughts while keeping the original meaning.
- Check the text for typos and absurd phrases and fix them from context.

WHAT NOT TO DO:
- Don't add facts, details, examples or conclusions that are not in the original.
- Don't remove facts, details, names, numbers or meaningful caveats. (Removing filler and repetition is fine and expected; losing meaning or facts is not.)
- Don't swap the author's words for "nicer" ones: if it says "thing", keep "thing", don't write "element".
- Don't change the tone or make it more formal or emotional.
- Don't add headings, lists, emphasis or emoji: NO formatting beyond plain paragraphs.
- Don't add an introduction or a conclusion.

LENGTH: the result may be a little shorter than the original because filler is gone, and that's fine. But every fact and thought must stay.

PRIORITY IN A CONFLICT: logical flow, removing repetition and correct grammar matter more than keeping every word literally, but NEVER at the cost of losing facts or meaning.

Return ONLY the edited text, with no comments and no explanation of what you changed.

Text:
{text}"""


def _clean_output(raw: str) -> str:
    """Trim output and strip exactly ONE matched pair of wrapping quotes.
    Internal newlines are PRESERVED (paragraph breaks matter here)."""
    if not raw:
        return ""
    text = raw.strip()
    if len(text) >= 2:
        expected_close = _QUOTE_PAIRS.get(text[0])
        if expected_close and text[-1] == expected_close:
            text = text[1:-1].strip()
    return text


def _call_groq(prompt: str, max_tokens: int) -> str:
    """Primary path. OpenAI SDK enforces the 15s timeout set at client construction."""
    response = app_usage.call("groq", "polish", _PRIMARY_MODEL, lambda: groq_client.chat.completions.create(
        model=_PRIMARY_MODEL,
        messages=[{"role": "user", "content": prompt}],
        temperature=0.2,
        max_tokens=max_tokens,
        reasoning_effort="low",
    ))
    choice = response.choices[0]
    if getattr(choice, "finish_reason", None) == "length":
        raise ValueError("output truncated: model hit the token limit")
    return choice.message.content or ""


def _call_gemini(prompt: str, max_tokens: int) -> str:
    """Fallback path with a hard wall-clock timeout via thread pool."""
    def _do_call():
        return app_usage.call("gemini", "polish", _FALLBACK_MODEL, lambda: gemini_client.models.generate_content(
            model=_FALLBACK_MODEL,
            contents=prompt,
            config=types.GenerateContentConfig(
                temperature=0.2,
                max_output_tokens=max_tokens,
            ),
        ))

    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(copy_context().run, _do_call)
        response = future.result(timeout=_GEMINI_TIMEOUT_SECONDS)
    try:
        finish = response.candidates[0].finish_reason
    except (AttributeError, IndexError, TypeError):
        finish = None
    if finish is not None and getattr(finish, "name", str(finish)) == "MAX_TOKENS":
        raise ValueError("output truncated: model hit the token limit")
    return response.text or ""


def polish_text(text: str) -> str:
    """Run plain-text selection through the editor prompt.

    Tries Groq first (15s budget). On timeout or any exception, falls back to
    Gemini 3.1 Flash Lite (18s wall-clock budget). Without GROQ_API_KEY, skips
    Groq entirely and uses Gemini directly.

    Raises ValueError on validation failures or empty output from both.
    """
    plain = (text or "").strip()

    if len(plain) < _MIN_CHARS:
        raise ValueError(f"text too short: {len(plain)} < {_MIN_CHARS} chars")
    if len(plain) > _MAX_CHARS:
        raise ValueError(f"text too long: {len(plain)} > {_MAX_CHARS} chars")

    prompt = _PROMPT.format(text=plain)
    budget = _output_token_budget(plain)

    if settings.GROQ_API_KEY:
        try:
            raw = _call_groq(prompt, budget)
        except Exception as e:
            print(f"ai_polish: Groq primary failed ({type(e).__name__}: {e}), falling back to Gemini")
            raw = _call_gemini(prompt, budget)
    else:
        raw = _call_gemini(prompt, budget)

    result = _clean_output(raw)
    if not result:
        raise ValueError("Both Groq and Gemini returned empty text")
    return result
