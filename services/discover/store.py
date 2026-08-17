"""SQLite corpus store for Discover.

Deliberately not Supabase yet. Pre-launch we are churning the schema daily and
re-running harvests; a local file we can delete and rebuild is the right tool.
`export_rows()` gives us the migration path when Discover moves server-side —
the column set here is already the shape the Postgres table will take.

Dedupe is on `canonical_id`. Re-harvesting is idempotent: metrics refresh,
pipeline state (rights, local_path, screening, roi) is preserved.
"""

from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterable, Iterator, Optional

from .models import DiscoveredVideo, RIGHTS_REFERENCE

DEFAULT_DB = Path("data/discover.db")

SCHEMA = """
CREATE TABLE IF NOT EXISTS discovered_videos (
    canonical_id      TEXT PRIMARY KEY,
    platform          TEXT NOT NULL,
    platform_video_id TEXT NOT NULL,
    url               TEXT NOT NULL,
    title             TEXT,
    description       TEXT,
    hashtags          TEXT,           -- JSON array
    duration_seconds  REAL,
    published_at      TEXT,
    thumbnail_url     TEXT,
    language          TEXT,
    width             INTEGER,
    height            INTEGER,
    creator           TEXT,           -- JSON object
    metrics           TEXT,           -- JSON object
    connector         TEXT,
    intent            TEXT,
    business_id       TEXT,
    source_query      TEXT,
    query_tags        TEXT,           -- JSON object
    discovered_at     TEXT,
    rights_status     TEXT NOT NULL DEFAULT 'unlicensed_reference',
    local_path        TEXT,
    screening         TEXT,           -- JSON object, null until screened
    roi               TEXT,           -- JSON object, null until scored
    style             TEXT,           -- JSON object, null until style-extracted
    classification    TEXT,           -- JSON object, null until classified
    updated_at        TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_dv_intent      ON discovered_videos(intent);
CREATE INDEX IF NOT EXISTS idx_dv_business    ON discovered_videos(business_id);
CREATE INDEX IF NOT EXISTS idx_dv_platform    ON discovered_videos(platform);
CREATE INDEX IF NOT EXISTS idx_dv_rights      ON discovered_videos(rights_status);

-- Creators we have seen, and how their content actually performed on
-- screening. This is what makes a daily agent worth running twice: repeat
-- keyword searches return the same videos, but each run surfaces new creator
-- handles, and their Shorts tabs are pure short-form supply.
CREATE TABLE IF NOT EXISTS creators (
    key              TEXT PRIMARY KEY,   -- platform:handle
    platform         TEXT NOT NULL,
    handle           TEXT NOT NULL,
    display_name     TEXT,
    url              TEXT,
    follower_count   INTEGER,
    videos_seen      INTEGER DEFAULT 0,
    videos_approved  INTEGER DEFAULT 0,
    videos_rejected  INTEGER DEFAULT 0,
    status           TEXT DEFAULT 'candidate',  -- candidate | seeded | blocked
    first_seen       TEXT DEFAULT CURRENT_TIMESTAMP,
    last_seen        TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_creators_status ON creators(status);

CREATE TABLE IF NOT EXISTS harvest_runs (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at    TEXT,
    finished_at   TEXT,
    connector     TEXT,
    intent        TEXT,
    queries       TEXT,   -- JSON array of query strings
    found         INTEGER DEFAULT 0,
    new_rows      INTEGER DEFAULT 0,
    errors        TEXT    -- JSON array
);
"""

# Columns written from a DiscoveredVideo, in order.
_COLUMNS = [
    "canonical_id", "platform", "platform_video_id", "url", "title", "description",
    "hashtags", "duration_seconds", "published_at", "thumbnail_url", "language",
    "width", "height",
    "creator", "metrics", "connector", "intent", "business_id", "source_query",
    "query_tags", "discovered_at", "rights_status", "local_path", "screening", "roi",
    "style", "classification",
]

_JSON_COLUMNS = {"hashtags", "creator", "metrics", "query_tags", "screening",
                 "roi", "style", "classification"}


class CorpusStore:
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
            # Additive migration for corpora created before a column existed.
            # The agent runs unattended and must never need a manual DB step.
            existing = {r["name"] for r in
                        conn.execute("PRAGMA table_info(discovered_videos)")}
            for column, decl in (("width", "INTEGER"), ("height", "INTEGER"),
                                 ("style", "TEXT"), ("classification", "TEXT")):
                if column not in existing:
                    conn.execute(
                        f"ALTER TABLE discovered_videos ADD COLUMN {column} {decl}")

    # ----------------------------------------------------------- write path
    def upsert(self, video: DiscoveredVideo) -> bool:
        """Insert or refresh. Returns True if this was a new video.

        Refresh updates discovery metadata and metrics but never clobbers
        pipeline state we've since earned (rights, downloaded file, screening
        verdict, ROI scores) with the defaults on a freshly-scraped record.
        """
        row = self._to_row(video)
        with self._conn() as conn:
            existing = conn.execute(
                "SELECT rights_status, local_path, screening, roi, style,"
                " classification FROM discovered_videos WHERE canonical_id = ?",
                (video.canonical_id,)).fetchone()

            if existing is None:
                conn.execute(
                    f"INSERT INTO discovered_videos ({','.join(_COLUMNS)}) "
                    f"VALUES ({','.join('?' * len(_COLUMNS))})",
                    [row[c] for c in _COLUMNS],
                )
                return True

            # preserve earned state unless this record carries something better
            if video.rights_status == RIGHTS_REFERENCE:
                row["rights_status"] = existing["rights_status"]
            row["local_path"] = video.local_path or existing["local_path"]
            row["screening"] = row["screening"] or existing["screening"]
            row["roi"] = row["roi"] or existing["roi"]
            row["style"] = row["style"] or existing["style"]
            row["classification"] = row["classification"] or existing["classification"]

            updatable = [c for c in _COLUMNS if c != "canonical_id"]
            conn.execute(
                f"UPDATE discovered_videos SET {','.join(f'{c}=?' for c in updatable)},"
                " updated_at=CURRENT_TIMESTAMP WHERE canonical_id=?",
                [row[c] for c in updatable] + [video.canonical_id],
            )
            return False

    def upsert_many(self, videos: Iterable[DiscoveredVideo]) -> tuple[int, int]:
        """Returns (total_seen, new_rows)."""
        total = new = 0
        for video in videos:
            total += 1
            if self.upsert(video):
                new += 1
        return total, new

    def set_fields(self, canonical_id: str, **fields: Any) -> None:
        """Targeted update — used by the screening bridge and ROI scorer."""
        if not fields:
            return
        payload = {k: (json.dumps(v) if k in _JSON_COLUMNS and v is not None else v)
                   for k, v in fields.items() if k in _COLUMNS}
        if not payload:
            return
        with self._conn() as conn:
            conn.execute(
                f"UPDATE discovered_videos SET {','.join(f'{k}=?' for k in payload)},"
                " updated_at=CURRENT_TIMESTAMP WHERE canonical_id=?",
                list(payload.values()) + [canonical_id],
            )

    def record_run(self, **fields: Any) -> None:
        cols = [c for c in ("started_at", "finished_at", "connector", "intent",
                            "queries", "found", "new_rows", "errors") if c in fields]
        values = [json.dumps(fields[c]) if c in ("queries", "errors") else fields[c]
                  for c in cols]
        with self._conn() as conn:
            conn.execute(
                f"INSERT INTO harvest_runs ({','.join(cols)}) "
                f"VALUES ({','.join('?' * len(cols))})", values)

    # ------------------------------------------------------------ read path
    def get(self, canonical_id: str) -> Optional[DiscoveredVideo]:
        with self._conn() as conn:
            row = conn.execute("SELECT * FROM discovered_videos WHERE canonical_id=?",
                               (canonical_id,)).fetchone()
        return self._from_row(row) if row else None

    def query(
        self,
        intent: Optional[str] = None,
        business_id: Optional[str] = None,
        platform: Optional[str] = None,
        unscreened_only: bool = False,
        screened_only: bool = False,
        min_views: Optional[int] = None,
        limit: Optional[int] = None,
        order_by_views: bool = False,
    ) -> list[DiscoveredVideo]:
        sql = "SELECT * FROM discovered_videos WHERE 1=1"
        params: list[Any] = []
        if intent:
            sql += " AND intent = ?"; params.append(intent)
        if business_id:
            sql += " AND business_id = ?"; params.append(business_id)
        if platform:
            sql += " AND platform = ?"; params.append(platform)
        if unscreened_only:
            sql += " AND screening IS NULL"
        if screened_only:
            sql += " AND screening IS NOT NULL"
        if min_views is not None:
            # view_count lives inside the metrics JSON blob
            sql += " AND CAST(json_extract(metrics, '$.view_count') AS INTEGER) >= ?"
            params.append(min_views)
        if order_by_views:
            sql += " ORDER BY CAST(json_extract(metrics, '$.view_count') AS INTEGER) DESC"
        else:
            sql += " ORDER BY discovered_at DESC"
        if limit:
            sql += " LIMIT ?"; params.append(limit)

        with self._conn() as conn:
            rows = conn.execute(sql, params).fetchall()
        return [self._from_row(r) for r in rows]

    def counts(self) -> dict[str, Any]:
        with self._conn() as conn:
            total = conn.execute("SELECT COUNT(*) c FROM discovered_videos").fetchone()["c"]
            by_platform = {r["platform"]: r["c"] for r in conn.execute(
                "SELECT platform, COUNT(*) c FROM discovered_videos GROUP BY platform")}
            by_intent = {r["intent"]: r["c"] for r in conn.execute(
                "SELECT intent, COUNT(*) c FROM discovered_videos GROUP BY intent")}
            by_rights = {r["rights_status"]: r["c"] for r in conn.execute(
                "SELECT rights_status, COUNT(*) c FROM discovered_videos GROUP BY rights_status")}
            screened = conn.execute(
                "SELECT COUNT(*) c FROM discovered_videos WHERE screening IS NOT NULL"
            ).fetchone()["c"]
            downloaded = conn.execute(
                "SELECT COUNT(*) c FROM discovered_videos WHERE local_path IS NOT NULL"
            ).fetchone()["c"]
        return {"total": total, "by_platform": by_platform, "by_intent": by_intent,
                "by_rights": by_rights, "screened": screened, "downloaded": downloaded}

    # --------------------------------------------------------------- creators
    def refresh_creators(self, block_after_rejections: int = 2) -> dict[str, int]:
        """Rebuild the creator table from the corpus.

        Auto-blocks creators whose content screening keeps rejecting — a handle
        that mixes food with comedy skits costs a paid indexing minute per
        rejection, so the system has to learn to stop harvesting it rather than
        wait for someone to notice.
        """
        tallies: dict[str, dict[str, Any]] = {}
        for video in self.query():
            handle = (video.creator.handle or "").strip()
            if not handle or not handle.startswith("@"):
                continue
            key = f"{video.platform}:{handle}"
            t = tallies.setdefault(key, {
                "platform": video.platform, "handle": handle,
                "display_name": video.creator.display_name, "url": video.creator.url,
                "follower_count": video.creator.follower_count,
                "seen": 0, "approved": 0, "rejected": 0})
            t["seen"] += 1
            verdict = (video.screening or {}).get("verdict")
            if verdict == "approved_for_collection":
                t["approved"] += 1
            elif verdict == "rejected":
                t["rejected"] += 1

        blocked = 0
        with self._conn() as conn:
            for key, t in tallies.items():
                current = conn.execute(
                    "SELECT status FROM creators WHERE key = ?", (key,)).fetchone()
                status = current["status"] if current else "candidate"
                # A manual block is never undone by a refresh.
                if status != "blocked" and t["rejected"] >= block_after_rejections \
                        and t["approved"] == 0:
                    status = "blocked"
                    blocked += 1
                conn.execute(
                    "INSERT INTO creators (key, platform, handle, display_name, url,"
                    " follower_count, videos_seen, videos_approved, videos_rejected,"
                    " status, last_seen) VALUES (?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)"
                    " ON CONFLICT(key) DO UPDATE SET display_name=excluded.display_name,"
                    " url=excluded.url, follower_count=excluded.follower_count,"
                    " videos_seen=excluded.videos_seen,"
                    " videos_approved=excluded.videos_approved,"
                    " videos_rejected=excluded.videos_rejected,"
                    " status=excluded.status, last_seen=CURRENT_TIMESTAMP",
                    (key, t["platform"], t["handle"], t["display_name"], t["url"],
                     t["follower_count"], t["seen"], t["approved"], t["rejected"],
                     status))
        return {"tracked": len(tallies), "blocked": blocked}

    def top_creators(self, limit: int = 20, min_videos: int = 2,
                     platform: str = "youtube") -> list[str]:
        """Handles worth harvesting, best suppliers first. Never blocked ones."""
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT handle FROM creators WHERE status != 'blocked'"
                " AND platform = ? AND videos_seen >= ?"
                " ORDER BY videos_approved DESC, videos_seen DESC LIMIT ?",
                (platform, min_videos, limit)).fetchall()
        return [r["handle"] for r in rows]

    def creator_rows(self) -> list[dict[str, Any]]:
        with self._conn() as conn:
            return [dict(r) for r in conn.execute(
                "SELECT * FROM creators ORDER BY videos_approved DESC, videos_seen DESC")]

    def set_creator_status(self, handle: str, status: str,
                           platform: str = "youtube") -> None:
        with self._conn() as conn:
            conn.execute("UPDATE creators SET status = ? WHERE key = ?",
                         (status, f"{platform}:{handle}"))

    def delete(self, canonical_ids: list[str]) -> int:
        """Drop videos from the corpus. Used by `prune` when the definition of
        what we collect changes and old rows no longer qualify."""
        if not canonical_ids:
            return 0
        with self._conn() as conn:
            conn.execute(
                f"DELETE FROM discovered_videos WHERE canonical_id IN "
                f"({','.join('?' * len(canonical_ids))})", canonical_ids)
        return len(canonical_ids)

    def export_rows(self) -> list[dict[str, Any]]:
        """Full corpus as plain dicts — JSONL export / Supabase backfill."""
        return [v.to_dict() for v in self.query()]

    # ------------------------------------------------------------ row <-> obj
    @staticmethod
    def _to_row(video: DiscoveredVideo) -> dict[str, Any]:
        d = video.to_dict()
        row = {c: d.get(c) for c in _COLUMNS}
        row["canonical_id"] = video.canonical_id
        for c in _JSON_COLUMNS:
            row[c] = json.dumps(row[c]) if row[c] is not None else None
        return row

    @staticmethod
    def _from_row(row: sqlite3.Row) -> DiscoveredVideo:
        d = dict(row)
        d.pop("updated_at", None)
        for c in _JSON_COLUMNS:
            if d.get(c):
                try:
                    d[c] = json.loads(d[c])
                except (TypeError, ValueError):
                    d[c] = None
        d["hashtags"] = d.get("hashtags") or []
        d["query_tags"] = d.get("query_tags") or {}
        return DiscoveredVideo.from_dict(d)
