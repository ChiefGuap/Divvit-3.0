"""SQLite store for intake — submissions and the known-public-video index.

Same posture as Discover's CorpusStore: local SQLite, additive self-migrating
schema, deliberately not Supabase yet. The `submissions` column set mirrors
the direction of the Supabase `submissions` migration so the eventual move is
a loader swap.

Two tables:

  submissions          — every submission ever made, with its fingerprint,
                         every gate's result, and the final verdict. Rejected
                         submissions are kept: a thief probing the gate with
                         variants of the same video should be visible as a
                         pattern, not erased on each rejection.
  corpus_fingerprints  — perceptual fingerprints of videos we know exist in
                         public (Discover's harvested corpus). This is the
                         set the theft gate checks against. Rows carry the
                         platform URL and creator handle so a match hands ops
                         something actionable: "this is @handle's TikTok".
"""

from __future__ import annotations

import json
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator, Optional

from .fingerprint import VideoFingerprint

DEFAULT_DB = Path("data/intake.db")

SCHEMA = """
CREATE TABLE IF NOT EXISTS submissions (
    submission_id    TEXT PRIMARY KEY,
    submitter_id     TEXT NOT NULL,
    claimed_business TEXT,
    claimed_location TEXT,
    file_name        TEXT,
    file_sha256      TEXT,
    fingerprint      TEXT,      -- JSON (VideoFingerprint.to_json)
    gates            TEXT,      -- JSON array of gate results
    verdict          TEXT,
    reasons          TEXT,      -- JSON array
    screening        TEXT,      -- JSON, null unless the paid call ran
    created_at       TEXT
);

CREATE INDEX IF NOT EXISTS idx_sub_sha       ON submissions(file_sha256);
CREATE INDEX IF NOT EXISTS idx_sub_submitter ON submissions(submitter_id);
CREATE INDEX IF NOT EXISTS idx_sub_verdict   ON submissions(verdict);

CREATE TABLE IF NOT EXISTS corpus_fingerprints (
    canonical_id     TEXT PRIMARY KEY,   -- Discover's platform:video_id
    platform         TEXT,
    url              TEXT,
    creator_handle   TEXT,
    title            TEXT,
    business_id      TEXT,
    fingerprint      TEXT NOT NULL,      -- JSON (VideoFingerprint.to_json)
    indexed_at       TEXT
);
"""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class IntakeStore:
    def __init__(self, path: Path | str = DEFAULT_DB):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._init_schema()

    @contextmanager
    def _conn(self) -> Iterator[sqlite3.Connection]:
        conn = sqlite3.connect(self.path)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
            conn.commit()
        finally:
            conn.close()

    def _init_schema(self) -> None:
        with self._conn() as conn:
            conn.executescript(SCHEMA)
            # Additive migration for databases created before a column
            # existed — intake runs unattended and must never need a manual
            # DB step. (No legacy columns yet; the hook is here for the
            # first one, same as CorpusStore.)
            existing = {r["name"] for r in
                        conn.execute("PRAGMA table_info(submissions)")}
            for column, decl in ():
                if column not in existing:
                    conn.execute(
                        f"ALTER TABLE submissions ADD COLUMN {column} {decl}")

    # ---------------------------------------------------------- submissions
    def record_submission(
        self, *, submitter_id: str, claimed_business: str,
        claimed_location: str, file_name: str,
        fingerprint: Optional[VideoFingerprint],
        gates: list[dict[str, Any]], verdict: str, reasons: list[str],
        screening: Optional[dict[str, Any]] = None,
        submission_id: Optional[str] = None,
    ) -> str:
        submission_id = submission_id or f"sub_{uuid.uuid4().hex[:12]}"
        with self._conn() as conn:
            conn.execute(
                "INSERT INTO submissions (submission_id, submitter_id,"
                " claimed_business, claimed_location, file_name, file_sha256,"
                " fingerprint, gates, verdict, reasons, screening, created_at)"
                " VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                (submission_id, submitter_id, claimed_business,
                 claimed_location, file_name,
                 fingerprint.sha256 if fingerprint else None,
                 fingerprint.to_json() if fingerprint else None,
                 json.dumps(gates), verdict, json.dumps(reasons),
                 json.dumps(screening) if screening else None, _now()))
        return submission_id

    def submissions(self, submitter_id: Optional[str] = None,
                    limit: Optional[int] = None) -> list[dict[str, Any]]:
        sql = "SELECT * FROM submissions"
        params: list[Any] = []
        if submitter_id:
            sql += " WHERE submitter_id = ?"
            params.append(submitter_id)
        sql += " ORDER BY created_at DESC"
        if limit:
            sql += " LIMIT ?"
            params.append(limit)
        with self._conn() as conn:
            rows = conn.execute(sql, params).fetchall()
        return [self._sub_from_row(r) for r in rows]

    def fingerprinted_submissions(self) -> list[dict[str, Any]]:
        """Prior submissions the dedupe gate compares against — every one
        that produced a fingerprint, whatever its verdict, oldest first so
        the earliest upload is the one a duplicate is attributed to."""
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT * FROM submissions WHERE fingerprint IS NOT NULL"
                " ORDER BY created_at ASC").fetchall()
        return [self._sub_from_row(r) for r in rows]

    @staticmethod
    def _sub_from_row(row: sqlite3.Row) -> dict[str, Any]:
        d = dict(row)
        for c in ("gates", "reasons", "screening"):
            if d.get(c):
                try:
                    d[c] = json.loads(d[c])
                except (TypeError, ValueError):
                    d[c] = None
        if d.get("fingerprint"):
            d["fingerprint"] = VideoFingerprint.from_json(d["fingerprint"])
        return d

    # ------------------------------------------------------ corpus fingerprints
    def upsert_corpus_fingerprint(
        self, *, canonical_id: str, fingerprint: VideoFingerprint,
        platform: str = "", url: str = "", creator_handle: str = "",
        title: str = "", business_id: str = "",
    ) -> None:
        with self._conn() as conn:
            conn.execute(
                "INSERT INTO corpus_fingerprints (canonical_id, platform, url,"
                " creator_handle, title, business_id, fingerprint, indexed_at)"
                " VALUES (?,?,?,?,?,?,?,?)"
                " ON CONFLICT(canonical_id) DO UPDATE SET"
                " fingerprint=excluded.fingerprint, url=excluded.url,"
                " creator_handle=excluded.creator_handle,"
                " title=excluded.title, business_id=excluded.business_id,"
                " indexed_at=excluded.indexed_at",
                (canonical_id, platform, url, creator_handle, title,
                 business_id, fingerprint.to_json(), _now()))

    def corpus_fingerprints(self) -> list[dict[str, Any]]:
        with self._conn() as conn:
            rows = conn.execute("SELECT * FROM corpus_fingerprints").fetchall()
        out = []
        for row in rows:
            d = dict(row)
            d["fingerprint"] = VideoFingerprint.from_json(d["fingerprint"])
            out.append(d)
        return out

    def counts(self) -> dict[str, Any]:
        with self._conn() as conn:
            total = conn.execute(
                "SELECT COUNT(*) c FROM submissions").fetchone()["c"]
            by_verdict = {r["verdict"]: r["c"] for r in conn.execute(
                "SELECT verdict, COUNT(*) c FROM submissions GROUP BY verdict")}
            corpus = conn.execute(
                "SELECT COUNT(*) c FROM corpus_fingerprints").fetchone()["c"]
        return {"submissions": total, "by_verdict": by_verdict,
                "corpus_fingerprints": corpus}
