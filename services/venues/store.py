"""SQLite roster store — cafes, their measured signals, brand health snapshots.

Same conventions as Discover's CorpusStore, deliberately: local SQLite while
the schema churns, additive self-migration on open (never a manual DB step),
dedupe on a stable key, and `export_rows()` as the Postgres migration path.

Three tables:

  cafes                   the roster. Keyed `osm:<type>:<id>`. Chains are kept
                          with `is_chain=1` and a reason — evidence, not noise.
                          Each row also carries a **lifecycle status**
                          (active | closed | unverifiable) with the evidence
                          that produced it; see `lifecycle.py`. Non-active
                          cafes stay on the roster and are filtered out of
                          `cafes()` by default rather than deleted.
  cafe_signals            one row per cafe once a metrics pass has *attempted*
                          it. A column that is NULL means "not measured";
                          a JSON payload with zeros means "measured, zero".
                          The existence of the row is what makes re-runs
                          resume instead of restart.
  brand_health_snapshots  append-only score history. Brand health is a time
                          series — "are we improving" is the renewal question,
                          and an overwritten score cannot answer it.
"""

from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator, Optional

from .roster import (CafeRecord, STATUS_ACTIVE, STATUS_CLOSED,
                     STATUS_UNVERIFIABLE, STATUSES)

DEFAULT_DB = Path("data/venues.db")

SCHEMA = """
CREATE TABLE IF NOT EXISTS cafes (
    cafe_id          TEXT PRIMARY KEY,      -- osm:<type>:<id>
    name             TEXT NOT NULL,
    lat              REAL,
    lon              REAL,
    city             TEXT,
    street           TEXT,
    housenumber      TEXT,
    postcode         TEXT,
    website          TEXT,
    phone            TEXT,
    instagram        TEXT,
    facebook         TEXT,
    tiktok           TEXT,
    cuisine          TEXT,
    opening_hours    TEXT,
    county           TEXT,
    source           TEXT DEFAULT 'overpass',
    is_chain         INTEGER NOT NULL DEFAULT 0,
    exclusion_reason TEXT,
    tags             TEXT,                  -- raw OSM tags, JSON
    -- Lifecycle. Written by `lifecycle.py`, never by the Overpass refresh:
    -- OSM is where the roster comes from, not where closures are recorded.
    status            TEXT NOT NULL DEFAULT 'active',  -- active|closed|unverifiable
    status_confidence TEXT,                 -- high|medium|low
    status_reason     TEXT,                 -- one human-readable sentence
    status_evidence   TEXT,                 -- JSON: what we actually observed
    status_checked_at TEXT,                 -- ISO-8601 UTC of the assessment
    first_seen       TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at       TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_cafes_chain  ON cafes(is_chain);
CREATE INDEX IF NOT EXISTS idx_cafes_city   ON cafes(city);
-- idx_cafes_status is created in _init_schema, after the additive migration:
-- on an existing DB this script runs before `status` has been added, and
-- indexing a column that does not exist yet fails the whole executescript.

CREATE TABLE IF NOT EXISTS cafe_signals (
    cafe_id      TEXT PRIMARY KEY,
    collected_at TEXT,
    youtube      TEXT,   -- JSON summary; NULL = never measured
    yelp         TEXT,   -- JSON {rating, review_count, ...}; NULL = absent
    google       TEXT,   -- JSON {rating, review_count, place_id, ...}
    reviews_checked_at TEXT,  -- set even when the lookup found nothing
    video_checked_at   TEXT,  -- ditto for the video pass
    errors       TEXT    -- JSON array of what degraded during collection
);

CREATE TABLE IF NOT EXISTS brand_health_snapshots (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    cafe_id      TEXT NOT NULL,
    captured_at  TEXT DEFAULT CURRENT_TIMESTAMP,
    score        REAL,
    confidence   TEXT,
    components   TEXT,   -- JSON breakdown: raw value + percentile + weight
    assumptions  TEXT    -- JSON: weights, cohort size, coverage, caveats
);

CREATE INDEX IF NOT EXISTS idx_bh_cafe ON brand_health_snapshots(cafe_id);
"""

# OSM-derived columns only — the ones an Overpass refresh is allowed to
# overwrite. The lifecycle columns are deliberately absent: a `roster` re-run
# must not resurrect a cafe we have evidence is closed, because OSM is exactly
# the source whose staleness the lifecycle exists to correct. `set_status()`
# is the only writer.
_CAFE_COLUMNS = [
    "cafe_id", "name", "lat", "lon", "city", "street", "housenumber",
    "postcode", "website", "phone", "instagram", "facebook", "tiktok",
    "cuisine", "opening_hours", "county", "source", "is_chain",
    "exclusion_reason", "tags",
]

_STATUS_COLUMNS = ["status", "status_confidence", "status_reason",
                   "status_evidence", "status_checked_at"]


class RosterStore:
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
            # Additive migration, mirroring CorpusStore: rosters created before
            # a column existed must upgrade themselves on open.
            existing = {r["name"] for r in conn.execute("PRAGMA table_info(cafes)")}
            for column, decl in (("county", "TEXT"), ("tiktok", "TEXT"),
                                 ("opening_hours", "TEXT"),
                                 # Lifecycle. `status` carries a NOT NULL
                                 # default so existing rows land on 'active'
                                 # in one statement — a roster built before
                                 # this column existed is a roster of cafes we
                                 # had no contrary evidence about.
                                 ("status", "TEXT NOT NULL DEFAULT 'active'"),
                                 ("status_confidence", "TEXT"),
                                 ("status_reason", "TEXT"),
                                 ("status_evidence", "TEXT"),
                                 ("status_checked_at", "TEXT")):
                if column not in existing:
                    conn.execute(f"ALTER TABLE cafes ADD COLUMN {column} {decl}")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_cafes_status"
                         " ON cafes(status)")

            signal_columns = {r["name"] for r in
                              conn.execute("PRAGMA table_info(cafe_signals)")}
            for column, decl in (("google", "TEXT"),
                                 ("reviews_checked_at", "TEXT"),
                                 ("video_checked_at", "TEXT")):
                if column not in signal_columns:
                    conn.execute(
                        f"ALTER TABLE cafe_signals ADD COLUMN {column} {decl}")

    # ------------------------------------------------------------- roster
    def upsert_cafe(self, cafe: CafeRecord) -> bool:
        """Insert or refresh; returns True for a new row. Refresh updates the
        OSM-derived fields but preserves `first_seen`."""
        row = cafe.to_dict()
        row["tags"] = json.dumps(row.get("tags") or {})
        row["is_chain"] = 1 if cafe.is_chain else 0
        with self._conn() as conn:
            existing = conn.execute(
                "SELECT cafe_id FROM cafes WHERE cafe_id = ?",
                (cafe.cafe_id,)).fetchone()
            if existing is None:
                conn.execute(
                    f"INSERT INTO cafes ({','.join(_CAFE_COLUMNS)}) "
                    f"VALUES ({','.join('?' * len(_CAFE_COLUMNS))})",
                    [row[c] for c in _CAFE_COLUMNS])
                return True
            updatable = [c for c in _CAFE_COLUMNS if c != "cafe_id"]
            conn.execute(
                f"UPDATE cafes SET {','.join(f'{c}=?' for c in updatable)},"
                " updated_at=CURRENT_TIMESTAMP WHERE cafe_id=?",
                [row[c] for c in updatable] + [cafe.cafe_id])
            return False

    def upsert_many(self, cafes: list[CafeRecord]) -> tuple[int, int]:
        total = new = 0
        for cafe in cafes:
            total += 1
            if self.upsert_cafe(cafe):
                new += 1
        return total, new

    def cafes(self, include_chains: bool = False, city: str = "",
              limit: Optional[int] = None,
              include_inactive: bool = False) -> list[CafeRecord]:
        """Independents by default, in deterministic cafe_id order — the order
        the metrics pass walks, which is what makes resume meaningful.

        Also **active** by default. A cafe Google reports as permanently
        closed, or that Google has never heard of at that location, is still
        on the roster with its evidence — but it is not a prospect, and the
        default read of the roster is "who can we sell to". Pass
        `include_inactive=True` for the audit view.
        """
        sql = "SELECT * FROM cafes WHERE 1=1"
        params: list[Any] = []
        if not include_chains:
            sql += " AND is_chain = 0"
        if not include_inactive:
            sql += " AND status = 'active'"
        if city:
            sql += " AND lower(city) = ?"
            params.append(city.strip().lower())
        sql += " ORDER BY cafe_id"
        if limit:
            sql += " LIMIT ?"
            params.append(limit)
        with self._conn() as conn:
            rows = conn.execute(sql, params).fetchall()
        return [self._cafe_from_row(r) for r in rows]

    def get_cafe(self, cafe_id: str) -> Optional[CafeRecord]:
        with self._conn() as conn:
            row = conn.execute("SELECT * FROM cafes WHERE cafe_id = ?",
                               (cafe_id,)).fetchone()
        return self._cafe_from_row(row) if row else None

    def find_cafe(self, name: str) -> Optional[CafeRecord]:
        """Loose name lookup for the CLI — exact id wins, else first name hit."""
        by_id = self.get_cafe(name)
        if by_id:
            return by_id
        with self._conn() as conn:
            row = conn.execute(
                "SELECT * FROM cafes WHERE lower(name) LIKE ? "
                "ORDER BY is_chain, cafe_id LIMIT 1",
                (f"%{name.strip().lower()}%",)).fetchone()
        return self._cafe_from_row(row) if row else None

    # ----------------------------------------------------------- lifecycle
    def set_status(self, cafe_id: str, status: str, confidence: str = "",
                   reason: str = "", evidence: Optional[dict[str, Any]] = None,
                   checked_at: str = "") -> None:
        """Record a lifecycle assessment. The only writer of the status
        columns — deliberately separate from `upsert_cafe`, so re-running the
        Overpass roster refresh never resurrects a closed cafe.

        The evidence and the date are stored alongside the state because the
        state alone is an assertion; with the evidence it is a finding that
        can be re-checked or overturned.
        """
        if status not in STATUSES:
            raise ValueError(f"unknown lifecycle status {status!r}; "
                             f"expected one of {sorted(STATUSES)}")
        with self._conn() as conn:
            conn.execute(
                "UPDATE cafes SET status=?, status_confidence=?,"
                " status_reason=?, status_evidence=?,"
                " status_checked_at=COALESCE(NULLIF(?,''), CURRENT_TIMESTAMP),"
                " updated_at=CURRENT_TIMESTAMP WHERE cafe_id=?",
                (status, confidence or None, reason or None,
                 json.dumps(evidence) if evidence is not None else None,
                 checked_at, cafe_id))

    def status_counts(self, include_chains: bool = False) -> dict[str, int]:
        sql = "SELECT status, COUNT(*) c FROM cafes"
        if not include_chains:
            sql += " WHERE is_chain = 0"
        sql += " GROUP BY status"
        with self._conn() as conn:
            found = {r["status"]: r["c"] for r in conn.execute(sql)}
        return {s: found.get(s, 0) for s in sorted(STATUSES)} | {
            k: v for k, v in found.items() if k not in STATUSES}

    def counts(self) -> dict[str, Any]:
        with self._conn() as conn:
            total = conn.execute("SELECT COUNT(*) c FROM cafes").fetchone()["c"]
            chains = conn.execute(
                "SELECT COUNT(*) c FROM cafes WHERE is_chain = 1").fetchone()["c"]
            with_site = conn.execute(
                "SELECT COUNT(*) c FROM cafes WHERE is_chain = 0"
                " AND website != ''").fetchone()["c"]
            with_ig = conn.execute(
                "SELECT COUNT(*) c FROM cafes WHERE is_chain = 0"
                " AND instagram != ''").fetchone()["c"]
            measured = conn.execute(
                "SELECT COUNT(*) c FROM cafe_signals").fetchone()["c"]
            top_cities = {r["city"]: r["c"] for r in conn.execute(
                "SELECT city, COUNT(*) c FROM cafes WHERE is_chain = 0"
                " AND status = 'active' AND city != ''"
                " GROUP BY city ORDER BY c DESC LIMIT 12")}
        by_status = self.status_counts()
        return {"total": total, "independent": total - chains, "chains": chains,
                # `independent` stays every non-chain record ever seen so the
                # roster's history is not silently rewritten; `active` is the
                # sellable set.
                "active": by_status.get(STATUS_ACTIVE, 0),
                "by_status": by_status,
                "with_website": with_site, "with_instagram": with_ig,
                "measured": measured, "top_cities": top_cities}

    # ------------------------------------------------------------ signals
    def set_signals(self, cafe_id: str, youtube: Optional[dict] = None,
                    yelp: Optional[dict] = None,
                    google: Optional[dict] = None,
                    reviews_checked_at: str = "",
                    video_checked_at: str = "",
                    errors: Optional[list[str]] = None,
                    collected_at: str = "") -> None:
        """Record a metrics attempt. None stays NULL — absent, not zero.

        COALESCE on every source means a later pass that measures only one of
        them (say, backfilling Google over a roster already measured for
        YouTube) adds to the row instead of blanking the rest.
        """
        with self._conn() as conn:
            conn.execute(
                "INSERT INTO cafe_signals (cafe_id, collected_at, youtube,"
                " yelp, google, reviews_checked_at, video_checked_at,"
                " errors) VALUES (?,?,?,?,?,?,?,?)"
                " ON CONFLICT(cafe_id) DO UPDATE SET"
                " collected_at=excluded.collected_at,"
                " youtube=COALESCE(excluded.youtube, cafe_signals.youtube),"
                " yelp=COALESCE(excluded.yelp, cafe_signals.yelp),"
                " google=COALESCE(excluded.google, cafe_signals.google),"
                " reviews_checked_at=COALESCE(excluded.reviews_checked_at,"
                " cafe_signals.reviews_checked_at),"
                " video_checked_at=COALESCE(excluded.video_checked_at,"
                " cafe_signals.video_checked_at),"
                " errors=excluded.errors",
                (cafe_id, collected_at,
                 json.dumps(youtube) if youtube is not None else None,
                 json.dumps(yelp) if yelp is not None else None,
                 json.dumps(google) if google is not None else None,
                 reviews_checked_at or None,
                 video_checked_at or None,
                 json.dumps(errors) if errors else None))

    def get_signals(self, cafe_id: str) -> Optional[dict[str, Any]]:
        with self._conn() as conn:
            row = conn.execute("SELECT * FROM cafe_signals WHERE cafe_id = ?",
                               (cafe_id,)).fetchone()
        return self._signals_from_row(row) if row else None

    def all_signals(self) -> dict[str, dict[str, Any]]:
        with self._conn() as conn:
            rows = conn.execute("SELECT * FROM cafe_signals").fetchall()
        return {r["cafe_id"]: self._signals_from_row(r) for r in rows}

    def pending_reviews(self, limit: Optional[int] = None,
                        include_inactive: bool = False) -> list[CafeRecord]:
        """Independents whose review signal is still dark.

        Separate from `pending_cafes` because the two backfill different
        things: that one finds cafes never measured at all, this one finds
        cafes measured before a review source existed. Yelp being blocked left
        120 rows in exactly that state, and re-running the whole metrics pass
        to fill one column would re-scrape YouTube for no reason.
        """
        # LEFT JOIN, so this covers both "measured before a review source
        # existed" and "never measured at all". Review signal is one fast
        # request; the video pass is ~15s of yt-dlp per cafe. Decoupling them
        # means the whole roster can carry a review score long before the
        # slower pass finishes.
        sql = ("SELECT c.* FROM cafes c LEFT JOIN cafe_signals s"
               " ON s.cafe_id = c.cafe_id"
               " WHERE c.is_chain = 0 AND s.google IS NULL"
               " AND s.reviews_checked_at IS NULL")
        if not include_inactive:
            sql += " AND c.status = 'active'"
        sql += " ORDER BY c.cafe_id"
        params: list[Any] = []
        if limit:
            sql += " LIMIT ?"
            params.append(limit)
        with self._conn() as conn:
            rows = conn.execute(sql, params).fetchall()
        return [self._cafe_from_row(r) for r in rows]

    def pending_cafes(self, limit: Optional[int] = None,
                      include_inactive: bool = False,
                      with_review_signal: bool = False) -> list[CafeRecord]:
        """Independents with no *video* signal yet, in cafe_id order.

        This is the resume contract: the metrics pass takes `pending_cafes()`,
        so a re-run continues where the last one stopped instead of
        re-measuring cafe #1 forever.

        Keyed on an explicit `video_checked_at` rather than on the row's
        existence, because the review pass now writes a row for every cafe it
        checks — "has a signals row" stopped meaning "has been measured" the
        moment the two passes were decoupled. Keying on `youtube IS NULL`
        instead would be worse: a cafe whose video measurement *failed* would
        be retried on every run, forever.

        `with_review_signal=True` narrows to the cafes that flip to *rankable*
        most cheaply. Brand Health needs ≥ 0.50 of its weight observed to rank
        a cafe; the video pass supplies 0.75 of that weight (volume 0.30,
        engagement 0.25, recency 0.20) and reviews the other 0.25. So a cafe
        that already has a review signal becomes rankable the moment the video
        pass touches it, while a cafe with neither needs the video pass to
        find something. Same ~15s of yt-dlp per cafe, strictly better odds —
        which matters when the run is budget-capped rather than exhaustive.
        """
        sql = ("SELECT c.* FROM cafes c LEFT JOIN cafe_signals s"
               " ON s.cafe_id = c.cafe_id"
               " WHERE c.is_chain = 0 AND s.video_checked_at IS NULL")
        if not include_inactive:
            sql += " AND c.status = 'active'"
        if with_review_signal:
            sql += " AND s.google IS NOT NULL"
        sql += " ORDER BY c.cafe_id"
        params: list[Any] = []
        if limit:
            sql += " LIMIT ?"
            params.append(limit)
        with self._conn() as conn:
            rows = conn.execute(sql, params).fetchall()
        return [self._cafe_from_row(r) for r in rows]

    # ---------------------------------------------------------- snapshots
    def record_snapshot(self, cafe_id: str, score: Optional[float],
                        confidence: str, components: dict[str, Any],
                        assumptions: dict[str, Any],
                        captured_at: str = "") -> None:
        with self._conn() as conn:
            conn.execute(
                "INSERT INTO brand_health_snapshots"
                " (cafe_id, captured_at, score, confidence, components,"
                " assumptions) VALUES (?,COALESCE(NULLIF(?,''),"
                " CURRENT_TIMESTAMP),?,?,?,?)",
                (cafe_id, captured_at, score, confidence,
                 json.dumps(components), json.dumps(assumptions)))

    def latest_snapshots(self) -> dict[str, dict[str, Any]]:
        """Most recent snapshot per cafe."""
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT s.* FROM brand_health_snapshots s"
                " JOIN (SELECT cafe_id, MAX(id) mid FROM brand_health_snapshots"
                "       GROUP BY cafe_id) latest"
                " ON latest.mid = s.id").fetchall()
        out = {}
        for r in rows:
            d = dict(r)
            for c in ("components", "assumptions"):
                if d.get(c):
                    try:
                        d[c] = json.loads(d[c])
                    except (TypeError, ValueError):
                        d[c] = None
            out[r["cafe_id"]] = d
        return out

    # ------------------------------------------------------------- export
    def export_rows(self) -> list[dict[str, Any]]:
        """Roster + signals + latest score as plain dicts — JSON export and
        the eventual Supabase backfill shape."""
        signals = self.all_signals()
        snapshots = self.latest_snapshots()
        out = []
        # Everything, including chains and retired records: this is the raw
        # dump, and each row carries `is_chain` / `status` so the consumer can
        # filter. `export.py` is the curated, documented contract.
        for cafe in self.cafes(include_chains=True, include_inactive=True):
            d = cafe.to_dict()
            d["signals"] = signals.get(cafe.cafe_id)
            snap = snapshots.get(cafe.cafe_id)
            d["brand_health"] = ({"score": snap["score"],
                                  "confidence": snap["confidence"],
                                  "components": snap["components"],
                                  "captured_at": snap["captured_at"]}
                                 if snap else None)
            out.append(d)
        return out

    # ---------------------------------------------------------- row -> obj
    @staticmethod
    def _cafe_from_row(row: sqlite3.Row) -> CafeRecord:
        d = dict(row)
        d.pop("first_seen", None)
        d.pop("updated_at", None)
        d["is_chain"] = bool(d.get("is_chain"))
        for key in ("tags", "status_evidence"):
            try:
                d[key] = json.loads(d.get(key) or "{}")
            except (TypeError, ValueError):
                d[key] = {}
        d["status"] = d.get("status") or STATUS_ACTIVE
        for key in ("status_confidence", "status_reason", "status_checked_at"):
            d[key] = d.get(key) or ""
        return CafeRecord.from_dict(d)

    @staticmethod
    def _signals_from_row(row: sqlite3.Row) -> dict[str, Any]:
        d = dict(row)
        for c in ("youtube", "yelp", "google", "errors"):
            if d.get(c):
                try:
                    d[c] = json.loads(d[c])
                except (TypeError, ValueError):
                    d[c] = None
        return d
