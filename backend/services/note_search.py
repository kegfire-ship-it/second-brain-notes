"""Hybrid notes search: SQLite FTS5 (words) + literal substring + local vectors (meaning),
merged with Reciprocal Rank Fusion.

Safety: this module only READS notes. The FTS index lives in RAM (`:memory:`),
is rebuilt from the read-only parse cache `notes._load_notes_index()` and is
reconciled against it on every query, so it can't go stale and there is no
index file to corrupt or to end up in backups. It never lists notes through
notes.get_all_notes — that one purges 30-day-old trash as a side effect.
"""
import logging
import sqlite3
import threading
import time
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

from core.config import settings
from services import notes, vector
from services.search_text import (
    MAX_QUERY_CHARS, build_match_query, fold, html_to_text, index_tokens, strip_urls,
)

_log = logging.getLogger(__name__)

RRF_K = 60
SEMANTIC_FLOOR = 0.55
LIT_MAX_CHARS = 200_000
FTS_RETRY_S = 60.0

_LOCK = threading.Lock()  # guards _IDX; never held while calling Gemini


class SearchUnavailable(Exception):
    """Neither side produced trustworthy results — caller should answer 503."""


@dataclass
class _Doc:
    lit: str = ""
    title: str = ""
    body: str = ""
    urls: str = ""


@dataclass
class _Index:
    notes_dir: str
    conn: Optional[sqlite3.Connection] = None
    # filename -> (snapshot entry object, prepared doc, fts rowid or 0)
    rows: Dict[str, Tuple[dict, _Doc, int]] = field(default_factory=dict)
    next_rowid: int = 1
    fts_disabled: bool = False
    fts_retry_at: float = 0.0


_IDX: Optional[_Index] = None


@dataclass
class SearchHit:
    entry: dict
    score: float
    vec_score: Optional[float] = None
    in_lexical: bool = False
    in_vector: bool = False

    @property
    def match(self) -> str:
        if self.in_lexical and self.in_vector:
            return "both"
        return "keyword" if self.in_lexical else "semantic"


@dataclass
class SearchOutcome:
    hits: List[SearchHit]
    degraded: Optional[str] = None
    info: Dict[str, object] = field(default_factory=dict)

    def info_header(self) -> str:
        return ";".join(f"{k}={v}" for k, v in self.info.items())


def _clear_search_index() -> None:
    """Drop the in-memory index (tests, manual escape hatch)."""
    global _IDX
    with _LOCK:
        if _IDX and _IDX.conn:
            _IDX.conn.close()
        _IDX = None


def _prepare(entry: dict) -> _Doc:
    title = str(entry.get("title") or "")
    text, hrefs = html_to_text(entry.get("content") or "")
    extra = [h for h in dict.fromkeys(hrefs) if h not in text]
    return _Doc(
        lit=fold(f"{title} {text} {' '.join(extra)}")[:LIT_MAX_CHARS],
        title=index_tokens(fold(strip_urls(title))),
        body=index_tokens(fold(strip_urls(text))),
        urls=index_tokens(fold(strip_urls(" ".join(extra)))),
    )


def _new_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(":memory:", check_same_thread=False, isolation_level=None)
    conn.execute(
        "CREATE VIRTUAL TABLE notes_fts USING fts5("
        "title, body, urls, tokenize='unicode61 remove_diacritics 2', prefix='2 3')"
    )
    return conn


def _drop_fts(idx: _Index, err: Exception) -> None:
    _log.warning("search: FTS disabled for %ss after error: %s", FTS_RETRY_S, err)
    try:
        if idx.conn:
            idx.conn.close()
    except Exception:
        pass
    idx.conn = None
    idx.rows = {f: (e, d, 0) for f, (e, d, _r) in idx.rows.items()}
    if "no such module" in str(err):
        idx.fts_disabled = True
    idx.fts_retry_at = time.monotonic() + FTS_RETRY_S


def _sync(idx: _Index, entries: List[dict]) -> None:
    """Bring docs + FTS in line with the snapshot. The parse cache hands out a
    NEW dict whenever a file's mtime changes, so identity is an exact change test."""
    current = {e["filename"]: e for e in entries if not e["filename"].startswith(".")}
    vanished = [f for f in idx.rows if f not in current]
    changed = [f for f, e in current.items() if f not in idx.rows or idx.rows[f][0] is not e]

    new_rows: Dict[str, Tuple[dict, _Doc]] = {}
    for f in changed:
        try:
            new_rows[f] = (current[f], _prepare(current[f]))
        except Exception as ex:  # one bad note must not break search
            _log.warning("search: could not prepare %s: %s", f, ex)
            new_rows[f] = (current[f], _Doc())

    need_rebuild = idx.conn is None and not idx.fts_disabled and time.monotonic() >= idx.fts_retry_at
    if need_rebuild:
        try:
            conn = _new_conn()
            merged = {f: (e, d) for f, (e, d, _r) in idx.rows.items() if f not in vanished}
            merged.update(new_rows)
            rows, rid = {}, 1
            conn.execute("BEGIN")
            for f, (e, d) in merged.items():
                conn.execute("INSERT INTO notes_fts(rowid, title, body, urls) VALUES (?,?,?,?)",
                             (rid, d.title, d.body, d.urls))
                rows[f] = (e, d, rid)
                rid += 1
            conn.execute("COMMIT")
            idx.conn, idx.rows, idx.next_rowid = conn, rows, rid
            return
        except sqlite3.Error as ex:
            _drop_fts(idx, ex)

    if idx.conn is None:  # literal-only mode
        for f in vanished:
            idx.rows.pop(f, None)
        for f, (e, d) in new_rows.items():
            idx.rows[f] = (e, d, 0)
        return

    if not vanished and not new_rows:
        return
    try:
        rid = idx.next_rowid
        staged: Dict[str, Tuple[dict, _Doc, int]] = {}
        idx.conn.execute("BEGIN")
        for f in vanished + list(new_rows):
            old = idx.rows.get(f)
            if old and old[2]:
                idx.conn.execute("DELETE FROM notes_fts WHERE rowid=?", (old[2],))
        for f, (e, d) in new_rows.items():
            idx.conn.execute("INSERT INTO notes_fts(rowid, title, body, urls) VALUES (?,?,?,?)",
                             (rid, d.title, d.body, d.urls))
            staged[f] = (e, d, rid)
            rid += 1
        idx.conn.execute("COMMIT")
        for f in vanished:
            idx.rows.pop(f, None)
        idx.rows.update(staged)
        idx.next_rowid = rid
    except sqlite3.Error as ex:
        _drop_fts(idx, ex)
        for f in vanished:
            idx.rows.pop(f, None)
        for f, (e, d) in new_rows.items():
            idx.rows[f] = (e, d, 0)


def _visible(entry: dict, user_id: str, category: Optional[str]) -> bool:
    # Same ownership rule as notes.get_all_notes.
    owner = entry.get("user_id")
    if user_id and owner and str(owner) != user_id:
        return False
    if entry.get("deletedAt"):
        return False
    if category is not None and entry.get("category") != category:
        return False
    return True


def _effective_time_ms(e: dict) -> int:
    oi = int(e.get("order_index") or 0)
    return oi if oi > 0 else int(float(e.get("_raw_time") or 0) * 1000)


def _lexical(q_fold: str, user_id: str, category: Optional[str]):
    """Returns (fts_ranked_filenames, literal_ranked_filenames, live_entries_by_filename, fts_ok)."""
    global _IDX
    entries = notes._load_notes_index()
    with _LOCK:
        if _IDX is None or _IDX.notes_dir != settings.NOTES_DIR:
            if _IDX and _IDX.conn:
                _IDX.conn.close()
            _IDX = _Index(notes_dir=settings.NOTES_DIR)
        idx = _IDX
        _sync(idx, entries)

        live = {f: (e, d, rid) for f, (e, d, rid) in idx.rows.items() if _visible(e, user_id, category)}

        fts: List[str] = []
        fts_ok = idx.conn is not None
        match = build_match_query(q_fold)
        if idx.conn is not None and match:
            by_rowid = {rid: f for f, (_e, _d, rid) in live.items() if rid}
            try:
                for (rid,) in idx.conn.execute(
                        "SELECT rowid FROM notes_fts WHERE notes_fts MATCH ? "
                        "ORDER BY bm25(notes_fts, 5.0, 1.0, 1.0)", (match,)):
                    f = by_rowid.get(rid)
                    if f:
                        fts.append(f)
            except sqlite3.Error as ex:
                _drop_fts(idx, ex)
                fts, fts_ok = [], False

        lit: List[Tuple[Tuple, str]] = []
        if len(q_fold) >= 3:
            for f, (e, d, _rid) in live.items():
                n = d.lit.count(q_fold)
                if n:
                    in_title = q_fold in fold(str(e.get("title") or ""))
                    lit.append(((not in_title, -min(n, 5), -_effective_time_ms(e)), f))
        lit.sort()
        return fts, [f for _k, f in lit], {f: e for f, (e, _d, _r) in live.items()}, fts_ok


def fuse(fts: List[str], lit: List[str], vec: List[Tuple[str, float]], entries: Dict[str, dict], *,
         k: int = RRF_K, semantic_floor: Optional[float] = SEMANTIC_FLOOR,
         semantic_only_rank: int = 10, semantic_only_rank_no_lexical: int = 10,
         newest_first: bool = False) -> List[SearchHit]:
    """Tier 0: notes that contain the words (FTS ∪ literal), ordered by RRF over all
    three lists. Tier 1: meaning-only notes, only from the top of the vector list —
    so loosely related noise can never outrank a real word match."""
    score: Dict[str, float] = {}
    for ranked in (fts, lit, [f for f, _s in vec]):
        for r, f in enumerate(ranked, 1):
            score[f] = score.get(f, 0.0) + 1.0 / (k + r)
    vec_scores = dict(vec)
    lexical = set(fts) | set(lit)

    if newest_first:  # web: notes containing the words, newest first (same date as the notes feed)
        tier0 = sorted(lexical, key=lambda f: (-_effective_time_ms(entries[f]), -score[f], str(entries[f]["id"])))
    else:
        tier0 = sorted(lexical, key=lambda f: (-score[f], -_effective_time_ms(entries[f]), str(entries[f]["id"])))
    cap = semantic_only_rank if tier0 else semantic_only_rank_no_lexical
    tier1 = [f for r, (f, s) in enumerate(vec, 1)
             if f not in lexical and r <= cap and (semantic_floor is None or s >= semantic_floor)]

    return [SearchHit(entry=entries[f], score=score[f], vec_score=vec_scores.get(f),
                      in_lexical=f in lexical, in_vector=f in vec_scores)
            for f in tier0 + tier1]


def hybrid_search(query: str, user_id: str, *, limit: int = 200, category: Optional[str] = None,
                  semantic_floor: Optional[float] = SEMANTIC_FLOOR, semantic_only_rank: int = 10,
                  newest_first: bool = False,
                  ) -> SearchOutcome:
    t0 = time.monotonic()
    q_fold = fold((query or "")[:MAX_QUERY_CHARS])
    if len(q_fold) < 2:
        return SearchOutcome(hits=[], info={"q": "short"})

    lexical_ok = True
    try:
        fts, lit, entries, fts_ok = _lexical(q_fold, user_id, category)
    except Exception as ex:
        _log.exception("search: lexical side failed: %s", ex)
        lexical_ok, fts, lit, entries, fts_ok = False, [], [], {}, False

    # Vector side (no lock held). Embeddings of 1–2 char queries are noise.
    vec: List[Tuple[str, float]] = []
    vec_ok, vec_skipped = True, len(q_fold) < 3
    if not vec_skipped:
        try:
            matches = vector.search_similar_notes(
                query[:MAX_QUERY_CHARS], user_id=user_id, top_k=100,
                category=category, raise_on_failure=True)
        except Exception as ex:
            _log.warning("search: vector side failed: %s", ex)
            matches, vec_ok = [], False
        if lexical_ok:
            by_id = {str(e["id"]): f for f, e in entries.items()}
            seen = set()
            for m in matches:
                f = by_id.get(str(m.get("id")))
                if f and f not in seen:
                    seen.add(f)
                    vec.append((f, float(m.get("score") or 0.0)))
        else:
            # Lexical side is down: validate vector ids against disk directly.
            for m in matches:
                e = notes.get_note(str(m.get("id") or ""))
                if e and _visible(e, user_id, category) and e["filename"] not in entries:
                    entries[e["filename"]] = e
                    vec.append((e["filename"], float(m.get("score") or 0.0)))

    if not lexical_ok and not vec:
        raise SearchUnavailable("lexical failed and no vector results")

    hits = fuse(fts, lit, vec, entries, semantic_floor=semantic_floor,
                semantic_only_rank=semantic_only_rank, newest_first=newest_first)
    if not hits and not vec_ok and not vec_skipped:
        # Zero keyword hits AND no semantic side: don't claim "nothing found".
        raise SearchUnavailable("no keyword hits and semantic side unavailable")

    degraded = None
    if not lexical_ok:
        degraded = "lexical"
    elif not vec_ok:
        degraded = "semantic"
    elif not fts_ok:
        degraded = "fts"
    outcome = SearchOutcome(hits=hits[:limit], degraded=degraded, info={
        "fts": len(fts), "lit": len(lit), "vec": len(vec),
        "sem": sum(1 for h in hits if not h.in_lexical),
        "deg": degraded or "-", "ms": int((time.monotonic() - t0) * 1000),
    })
    return outcome
