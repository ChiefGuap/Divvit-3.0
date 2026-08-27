#!/usr/bin/env python3
"""Seed the dashboard's Postgres from the measured Orange County roster.

Source of truth, in order of preference:

  1. ``data/roster_export.json`` — the documented, versioned export produced by
     ``services.venues.cli export``. Carries cafes + lifecycle status + brand
     health (score, confidence, rankable, per-component breakdown, assumptions)
     + review signal + video signal + the videos themselves.
  2. ``data/venues.db`` — read **read-only**, for the two things the export
     does not carry: the full ``brand_health_snapshots`` history (the export
     only holds the latest) and the OSM detail columns (street, postcode,
     phone, cuisine, opening hours, raw tags).
  3. ``data/discover.db`` — read **read-only**, for creator identity
     (display name, follower count) and per-video metadata (thumbnail,
     description, hashtags, duration) keyed by ``canonical_id``.

Nothing is invented. Every column that has no measurement behind it is written
as NULL, never 0 — the same missing-vs-zero contract
``services/venues/brand_health.py`` enforces. A cafe we never searched has
``youtube_video_count IS NULL``; a cafe we searched and found nothing about has
``youtube_video_count = 0``.

Idempotent: every row carries a deterministic UUIDv5 derived from its natural
key (``osm:node:123``, ``youtube:abc``, ``youtube:@handle``), so re-running
upserts in place instead of duplicating. Safe to run as often as you like.

Usage
-----

    # write idempotent SQL you can pipe into psql / supabase db execute
    python3 scripts/seed_dashboard.py --out-sql data/seed/dashboard_seed.sql

    # push straight at a project through the token-guarded ingest RPC
    SUPABASE_URL=https://<ref>.supabase.co \\
    SUPABASE_PUBLISHABLE_KEY=sb_publishable_... \\
    SEED_TOKEN=... \\
    python3 scripts/seed_dashboard.py --rpc

The RPC path expects ``public.seed_ingest(p_token, p_table, p_rows, p_conflict)``
to exist — a ``SECURITY DEFINER`` function gated on a shared secret, created
for the duration of a seed and dropped afterwards. It exists so seeding never
requires opening a write policy on a table whose key ships to the browser.
See docs/overnight/supabase-backend.md.
"""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Optional

REPO = Path(__file__).resolve().parent.parent
ROSTER_EXPORT = REPO / "data" / "roster_export.json"
VENUES_DB = REPO / "data" / "venues.db"
DISCOVER_DB = REPO / "data" / "discover.db"

# One namespace for the whole product so an id is reproducible from its natural
# key alone, on any machine, without a round trip to the database.
NS = uuid.uuid5(uuid.NAMESPACE_URL, "https://divvit.app/ids")


def det_id(kind: str, key: str) -> str:
    return str(uuid.uuid5(NS, f"{kind}:{key}"))


def blank_to_none(v: Any) -> Any:
    """OSM leaves unknown fields as empty strings. Empty string is not a value."""
    if isinstance(v, str) and not v.strip():
        return None
    return v


def as_utc(raw: Optional[str]) -> Optional[str]:
    """SQLite stores naive UTC ('2026-08-19 04:54:36'); Postgres wants a zone."""
    if not raw:
        return None
    text = str(raw).strip()
    if not text:
        return None
    if "T" not in text and " " in text:
        text = text.replace(" ", "T", 1)
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc).isoformat()


def load_json(raw: Optional[str]) -> Any:
    if not raw:
        return None
    try:
        return json.loads(raw)
    except (TypeError, ValueError):
        return None


def ro_connect(path: Path) -> Optional[sqlite3.Connection]:
    """Read-only, always. These databases belong to the pipeline, not to us."""
    if not path.exists():
        return None
    conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    return conn


# --------------------------------------------------------------------- extract


def read_roster() -> dict[str, Any]:
    if not ROSTER_EXPORT.exists():
        raise SystemExit(
            f"{ROSTER_EXPORT} not found. Produce it with:\n"
            "  .venv/bin/python -m services.venues.cli export --json data/roster_export.json"
        )
    return json.loads(ROSTER_EXPORT.read_text())


def read_osm_detail(conn: Optional[sqlite3.Connection]) -> dict[str, dict[str, Any]]:
    """The OSM columns the export does not carry, keyed by cafe_id."""
    if conn is None:
        return {}
    out: dict[str, dict[str, Any]] = {}
    for row in conn.execute("SELECT * FROM cafes"):
        d = dict(row)
        out[d["cafe_id"]] = {
            "street": blank_to_none(d.get("street")),
            "housenumber": blank_to_none(d.get("housenumber")),
            "postcode": blank_to_none(d.get("postcode")),
            "phone": blank_to_none(d.get("phone")),
            "facebook": blank_to_none(d.get("facebook")),
            "tiktok": blank_to_none(d.get("tiktok")),
            "cuisine": blank_to_none(d.get("cuisine")),
            "opening_hours": blank_to_none(d.get("opening_hours")),
            "osm_tags": load_json(d.get("tags")),
            "source": blank_to_none(d.get("source")) or "overpass",
            "exclusion_reason": blank_to_none(d.get("exclusion_reason")),
            "first_seen": as_utc(d.get("first_seen")),
            "updated_at": as_utc(d.get("updated_at")),
        }
    return out


def read_signal_detail(conn: Optional[sqlite3.Connection]) -> dict[str, dict[str, Any]]:
    """Review-match provenance and collection errors, keyed by cafe_id.

    The address, business status and drift distance are what make a rating
    defensible — they say *which* business Google matched. Errors are kept
    because a blocked scrape and a zero-star cafe must never look alike.
    """
    if conn is None:
        return {}
    out: dict[str, dict[str, Any]] = {}
    for row in conn.execute("SELECT * FROM cafe_signals"):
        d = dict(row)
        reviews = load_json(d.get("google")) or load_json(d.get("yelp")) or {}
        out[d["cafe_id"]] = {
            "collected_at": as_utc(d.get("collected_at")),
            "review_address": reviews.get("address"),
            "review_business_status": reviews.get("business_status"),
            "review_distance_m": reviews.get("distance_m"),
            "reviews_checked_at": as_utc(d.get("reviews_checked_at")),
            "youtube_checked_at": as_utc(d.get("video_checked_at")),
            "errors": load_json(d.get("errors")) or None,
        }
    return out


def read_snapshot_history(conn: Optional[sqlite3.Connection]) -> list[dict[str, Any]]:
    """Every appended brand-health snapshot. The export only holds the latest,
    and "are we improving" is the question a single value cannot answer."""
    if conn is None:
        return []
    out = []
    for row in conn.execute(
        "SELECT cafe_id, captured_at, score, confidence, components, assumptions "
        "FROM brand_health_snapshots"
    ):
        d = dict(row)
        out.append(
            {
                "cafe_id": d["cafe_id"],
                "captured_at": as_utc(d.get("captured_at")),
                "score": d.get("score"),
                "confidence": d.get("confidence") or "none",
                "components": load_json(d.get("components")) or {},
                "assumptions": load_json(d.get("assumptions")) or {},
            }
        )
    return out


def read_video_detail(conn: Optional[sqlite3.Connection]) -> dict[str, dict[str, Any]]:
    """Per-video metadata keyed by canonical_id: thumbnail, description,
    hashtags, duration, and the creator's display name and follower count."""
    if conn is None:
        return {}
    out: dict[str, dict[str, Any]] = {}
    for row in conn.execute("SELECT * FROM discovered_videos"):
        d = dict(row)
        creator = load_json(d.get("creator")) or {}
        metrics = load_json(d.get("metrics")) or {}
        out[d["canonical_id"]] = {
            "description": blank_to_none(d.get("description")),
            "hashtags": load_json(d.get("hashtags")) or None,
            "duration_seconds": d.get("duration_seconds"),
            "thumbnail_url": blank_to_none(d.get("thumbnail_url")),
            "language": blank_to_none(d.get("language")),
            "width": d.get("width"),
            "height": d.get("height"),
            "creator_display_name": creator.get("display_name"),
            "creator_follower_count": creator.get("follower_count"),
            "metrics_collected_at": as_utc(metrics.get("collected_at")),
            "connector": blank_to_none(d.get("connector")),
            "intent": blank_to_none(d.get("intent")),
            "source_query": blank_to_none(d.get("source_query")),
            "discovered_at": as_utc(d.get("discovered_at")),
            "platform_video_id": d.get("platform_video_id"),
            "style": load_json(d.get("style")),
            "classification": load_json(d.get("classification")),
            "screening": load_json(d.get("screening")),
            "roi": load_json(d.get("roi")),
        }
    return out


def read_corpus_creators(conn: Optional[sqlite3.Connection]) -> list[dict[str, Any]]:
    if conn is None:
        return []
    return [dict(r) for r in conn.execute("SELECT * FROM creators")]


# --------------------------------------------------------------------- transform


def build_rows() -> dict[str, list[dict[str, Any]]]:
    roster = read_roster()
    venues = ro_connect(VENUES_DB)
    discover = ro_connect(DISCOVER_DB)
    try:
        osm = read_osm_detail(venues)
        signal_detail = read_signal_detail(venues)
        history = read_snapshot_history(venues)
        video_detail = read_video_detail(discover)
        corpus_creators = read_corpus_creators(discover)
    finally:
        for c in (venues, discover):
            if c is not None:
                c.close()

    cafes = list(roster.get("cafes") or []) + list(roster.get("retired") or [])

    businesses: list[dict[str, Any]] = []
    signals: list[dict[str, Any]] = []
    snapshots: list[dict[str, Any]] = []
    videos: list[dict[str, Any]] = []
    creators: dict[str, dict[str, Any]] = {}

    known: set[str] = set()

    for cafe in cafes:
        cafe_id = cafe["cafe_id"]
        known.add(cafe_id)
        bid = det_id("business", cafe_id)
        extra = osm.get(cafe_id, {})
        status = cafe.get("status") or {}
        health = cafe.get("brand_health") or {}

        businesses.append(
            {
                "id": bid,
                "external_id": cafe_id,
                "name": cafe["name"],
                "city": blank_to_none(cafe.get("city")),
                "county": blank_to_none(cafe.get("county")),
                "address": blank_to_none(cafe.get("address")),
                "latitude": cafe.get("lat"),
                "longitude": cafe.get("lon"),
                "website": blank_to_none(cafe.get("website")),
                "instagram": blank_to_none(cafe.get("instagram")),
                "is_chain": bool(cafe.get("is_chain")),
                # active | closed | unverifiable — a retired cafe keeps its row
                # and its reason rather than disappearing.
                "lifecycle_status": status.get("state") or "active",
                "is_partner": False,
                # Only a *rankable* score is comparable to another venue's, so
                # only a rankable score gets denormalised here.
                "organic_brand_health_score": (
                    round(health["score"])
                    if health.get("rankable") and health.get("score") is not None
                    else None
                ),
                "street": extra.get("street"),
                "housenumber": extra.get("housenumber"),
                "postcode": extra.get("postcode"),
                "phone": extra.get("phone"),
                "facebook": extra.get("facebook"),
                "tiktok": extra.get("tiktok"),
                "cuisine": extra.get("cuisine"),
                "opening_hours": extra.get("opening_hours"),
                "osm_tags": extra.get("osm_tags"),
                "source": extra.get("source") or "overpass",
                "exclusion_reason": extra.get("exclusion_reason"),
                "first_seen": extra.get("first_seen"),
                "updated_at": as_utc(status.get("checked_at")) or extra.get("updated_at"),
            }
        )

        review = cafe.get("review_signal") or {}
        video_sig = cafe.get("video_signal") or {}
        detail = signal_detail.get(cafe_id, {})
        if review or video_sig or detail:
            signals.append(
                {
                    "id": det_id("signals", cafe_id),
                    "business_id": bid,
                    "collected_at": detail.get("collected_at")
                    or as_utc(video_sig.get("collected_at"))
                    or as_utc(review.get("collected_at")),
                    # NULL = never searched. 0 = searched, found nothing.
                    "youtube_video_count": video_sig.get("video_count"),
                    "youtube_queries": video_sig.get("queries") or None,
                    "youtube_checked_at": detail.get("youtube_checked_at")
                    or as_utc(video_sig.get("collected_at")),
                    "review_provider": review.get("provider"),
                    "review_rating": review.get("rating"),
                    "review_count": review.get("review_count"),
                    "review_place_id": review.get("place_id"),
                    "review_matched_name": review.get("matched_name"),
                    "review_address": detail.get("review_address"),
                    "review_business_status": detail.get("review_business_status"),
                    "review_distance_m": detail.get("review_distance_m"),
                    "reviews_checked_at": detail.get("reviews_checked_at")
                    or as_utc(review.get("collected_at")),
                    "errors": detail.get("errors"),
                }
            )

        # The export's freshest score, as a snapshot in its own right. The
        # history below fills in everything before it.
        if health.get("computed_at"):
            snapshots.append(
                snapshot_row(
                    bid,
                    cafe_id,
                    as_utc(health["computed_at"]),
                    health.get("score"),
                    health.get("confidence") or "none",
                    health.get("components") or {},
                    health.get("assumptions") or {},
                    health.get("rankable"),
                )
            )

        for v in cafe.get("videos") or []:
            canonical = v["canonical_id"]
            vd = video_detail.get(canonical, {})
            handle = v.get("creator")
            platform = v.get("platform") or "youtube"
            creator_key = f"{platform}:{handle}" if handle else None
            if creator_key and creator_key not in creators:
                creators[creator_key] = {
                    "id": det_id("creator", creator_key),
                    "key": creator_key,
                    "platform": platform,
                    "handle": handle,
                    "display_name": vd.get("creator_display_name"),
                    "url": None,
                    "follower_count": vd.get("creator_follower_count"),
                    # Corpus-wide counts are only known for creators the
                    # harvester tracked; leave unknown as NULL.
                    "videos_seen": None,
                    "videos_approved": None,
                    "videos_rejected": None,
                    "status": None,
                    "first_seen": None,
                    "last_seen": None,
                }
            videos.append(
                {
                    "id": det_id("video", canonical),
                    "canonical_id": canonical,
                    "business_id": bid,
                    "creator_id": det_id("creator", creator_key) if creator_key else None,
                    "platform": platform,
                    "platform_video_id": vd.get("platform_video_id")
                    or canonical.split(":", 1)[-1],
                    "url": v["url"],
                    "title": v.get("title"),
                    "description": vd.get("description"),
                    "hashtags": vd.get("hashtags"),
                    "duration_seconds": vd.get("duration_seconds"),
                    "published_at": as_utc(v.get("published_at")),
                    "thumbnail_url": vd.get("thumbnail_url"),
                    "language": vd.get("language"),
                    "width": vd.get("width"),
                    "height": vd.get("height"),
                    "creator_handle": handle,
                    "creator_display_name": vd.get("creator_display_name"),
                    "creator_follower_count": vd.get("creator_follower_count"),
                    # None stays None: an uncollected metric is not a zero.
                    "view_count": v.get("views"),
                    "like_count": v.get("likes"),
                    "comment_count": v.get("comments"),
                    "share_count": None,
                    "metrics_collected_at": vd.get("metrics_collected_at"),
                    "connector": vd.get("connector"),
                    "intent": vd.get("intent") or "business",
                    "source_query": vd.get("source_query"),
                    "discovered_at": vd.get("discovered_at"),
                    "rights_status": v.get("rights_status") or "unlicensed_reference",
                    "style": vd.get("style"),
                    "classification": vd.get("classification"),
                    "screening": vd.get("screening"),
                    "roi": vd.get("roi"),
                }
            )

    for snap in history:
        if snap["cafe_id"] not in known:
            continue
        snapshots.append(
            snapshot_row(
                det_id("business", snap["cafe_id"]),
                snap["cafe_id"],
                snap["captured_at"],
                snap["score"],
                snap["confidence"],
                snap["components"],
                snap["assumptions"],
                None,
            )
        )

    # Creator rows the harvester tracked directly win over ones inferred from a
    # video, because they carry real corpus-wide counts and a status.
    for c in corpus_creators:
        key = c["key"]
        creators[key] = {
            "id": det_id("creator", key),
            "key": key,
            "platform": c["platform"],
            "handle": c["handle"],
            "display_name": c.get("display_name")
            or (creators.get(key) or {}).get("display_name"),
            "url": c.get("url"),
            "follower_count": c.get("follower_count")
            if c.get("follower_count") is not None
            else (creators.get(key) or {}).get("follower_count"),
            "videos_seen": c.get("videos_seen"),
            "videos_approved": c.get("videos_approved"),
            "videos_rejected": c.get("videos_rejected"),
            "status": c.get("status"),
            "first_seen": as_utc(c.get("first_seen")),
            "last_seen": as_utc(c.get("last_seen")),
        }

    return {
        "businesses": dedupe(businesses, "id"),
        "creators": list(creators.values()),
        "venue_signals": dedupe(signals, "id"),
        "brand_health_snapshots": collapse_snapshots(dedupe(snapshots, "id")),
        "discovered_videos": dedupe(videos, "id"),
    }


def snapshot_row(
    business_id: str,
    cafe_id: str,
    captured_at: Optional[str],
    score: Any,
    confidence: str,
    components: dict,
    assumptions: dict,
    rankable: Optional[bool],
) -> dict[str, Any]:
    coverage = assumptions.get("coverage")
    floor = assumptions.get("min_coverage_to_rank")
    if rankable is None:
        # Recompute the way brand_health.py defines it: a thin score is real,
        # it just is not a league-table entry.
        rankable = (
            score is not None
            and coverage is not None
            and floor is not None
            and coverage >= floor
        )
    return {
        "id": det_id("bh", f"{cafe_id}|{captured_at}"),
        "business_id": business_id,
        "captured_at": captured_at,
        "score": score,
        "confidence": confidence if confidence in ("none", "low", "medium", "high") else "none",
        "rankable": bool(rankable),
        "coverage": coverage,
        "cohort_size": assumptions.get("cohort_size"),
        "components": components,
        "assumptions": assumptions,
    }


def apply_detail_tier(payload: dict[str, list[dict[str, Any]]], top: int) -> dict[str, list[dict[str, Any]]]:
    """Keep the whole roster, narrow the *detail* to the top-ranked venues.

    Every business row is kept — the roster and its brand-health scores are the
    asset, and the cohort has to be complete for a rank to mean anything. What
    this drops is the per-venue measurement detail (signals, snapshot history,
    videos, creators) for venues outside the top `top` by score.

    This exists purely because a seed run may have to go through a channel with
    a payload budget. It is a fidelity knob, never a truthfulness one: nothing
    is invented for the venues that keep their detail, and nothing is
    approximated for the ones that lose it — they simply have no signal rows,
    which reads correctly as "not loaded" rather than "measured as zero".
    Run without it (the default) to write everything.
    """
    ranked = sorted(
        (b for b in payload["businesses"] if b.get("organic_brand_health_score") is not None),
        key=lambda b: b["organic_brand_health_score"],
        reverse=True,
    )
    keep = {b["id"] for b in ranked[:top]}

    signals = [r for r in payload["venue_signals"] if r["business_id"] in keep]
    snapshots = [r for r in payload["brand_health_snapshots"] if r["business_id"] in keep]
    videos = [r for r in payload["discovered_videos"] if r["business_id"] in keep]
    creator_ids = {v["creator_id"] for v in videos if v.get("creator_id")}
    creators = [c for c in payload["creators"] if c["id"] in creator_ids]

    return {
        "businesses": payload["businesses"],
        "creators": creators,
        "venue_signals": signals,
        "brand_health_snapshots": snapshots,
        "discovered_videos": videos,
    }


def dedupe(rows: Iterable[dict[str, Any]], key: str) -> list[dict[str, Any]]:
    seen: dict[str, dict[str, Any]] = {}
    for r in rows:
        seen[r[key]] = r
    return list(seen.values())


# ------------------------------------------------------------------------ load

CONFLICT = {
    "businesses": "id",
    "creators": "id",
    "venue_signals": "id",
    "brand_health_snapshots": "id",
    "discovered_videos": "id",
}

# Parents before children.
ORDER = [
    "businesses",
    "creators",
    "venue_signals",
    "brand_health_snapshots",
    "discovered_videos",
]


# Columns carrying bulk the nine dashboard routes never render. Dropping them
# is a size choice, not a truth choice: they stay in the schema and a full run
# without --lean writes them.
LEAN_DROP = {
    "businesses": {"osm_tags"},
    "venue_signals": {"youtube_queries"},
    "discovered_videos": {
        "description",
        "style",
        "classification",
        "screening",
        "roi",
        "source_query",
        "connector",
        "language",
        "width",
        "height",
        "discovered_at",
    },
}


def round_floats(o: Any, dp: int = 6) -> Any:
    if isinstance(o, float):
        return round(o, dp)
    if isinstance(o, dict):
        return {k: round_floats(v, dp) for k, v in o.items()}
    if isinstance(o, list):
        return [round_floats(v, dp) for v in o]
    return o


def compact_json(o: Any) -> str:
    return json.dumps(round_floats(o), ensure_ascii=False, separators=(",", ":"))


def collapse_snapshots(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Drop snapshots that recorded no change.

    Brand health is appended, never overwritten, and that is right: "are we
    improving" needs the timeline. But a re-run that produced the identical
    score and the identical component breakdown is a record of the *job*
    running, not of the venue changing. Keeping the first row at which each
    distinct measurement appeared preserves every real movement and every
    real date, and drops only the repeats.
    """
    by_business: dict[str, list[dict[str, Any]]] = {}
    for r in rows:
        by_business.setdefault(r["business_id"], []).append(r)

    kept: list[dict[str, Any]] = []
    for series in by_business.values():
        series.sort(key=lambda r: r["captured_at"] or "")
        previous = None
        for r in series:
            signature = (r["score"], compact_json(r["components"]), r["confidence"])
            if signature != previous:
                kept.append(r)
            previous = signature
    return kept


def sql_literal(v: Any) -> str:
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, float):
        # Six significant digits is far finer than any of these measurements
        # actually resolve; the extra float noise is only bytes.
        return repr(round(v, 6))
    if isinstance(v, int):
        return repr(v)
    if isinstance(v, (dict,)):
        return quote(compact_json(v)) + "::jsonb"
    if isinstance(v, (list, tuple)):
        if all(isinstance(x, str) for x in v):
            inner = ",".join(quote(x) for x in v)
            return f"ARRAY[{inner}]::text[]" if v else "'{}'::text[]"
        return quote(compact_json(list(v))) + "::jsonb"
    return quote(str(v))


def quote(s: str) -> str:
    return "'" + s.replace("'", "''") + "'"


def table_columns(rows: list[dict[str, Any]], table: str, lean: bool) -> list[str]:
    """Only columns that actually carry a value somewhere.

    A column that is NULL in every row is nothing but bytes: leaving it out of
    the INSERT lets the column default (which is NULL) apply, and says the same
    thing in a fraction of the space.
    """
    present = {k for r in rows for k, v in r.items() if v is not None}
    present.add("id")
    if lean:
        present -= LEAN_DROP.get(table, set())
    return sorted(present)


# Everything in a snapshot's assumptions block that is a property of the model
# rather than of the venue. It is byte-identical on every row of a run, so it
# is written once per statement and re-attached in SQL.
SHARED_ASSUMPTION_KEYS = (
    "weights",
    "min_coverage_to_rank",
    "cohort",
    "recency_half_life_days",
    "sources",
    "note",
)
SNAPSHOT_COLS = [
    "id",
    "business_id",
    "captured_at",
    "score",
    "confidence",
    "rankable",
    "coverage",
    "cohort_size",
    "components",
]
# The first VALUES row is cast explicitly; Postgres resolves the rest of the
# column's rows to those types.
SNAPSHOT_CASTS = [
    "::uuid",
    "::uuid",
    "::timestamptz",
    "::numeric",
    "::text",
    "",
    "::numeric",
    "::int",
    "",
]


def snapshot_statements(rows: list[dict[str, Any]], chunk_size: int) -> Iterable[tuple[str, str]]:
    """Snapshots, with the model-level assumptions hoisted out of every row.

    `coverage` and `cohort_size` are per-venue and per-run, so they are written
    per row and merged back into the stored assumptions object — the JSON that
    lands in Postgres is identical to what brand_health.py produced.
    """
    groups: dict[str, list[dict[str, Any]]] = {}
    for r in rows:
        shared = {k: r["assumptions"][k] for k in SHARED_ASSUMPTION_KEYS if k in r["assumptions"]}
        groups.setdefault(compact_json(shared), []).append(r)

    for shared_json, group in groups.items():
        for chunk in batched(group, chunk_size):
            values = []
            for i, r in enumerate(chunk):
                casts = SNAPSHOT_CASTS if i == 0 else [""] * len(SNAPSHOT_COLS)
                values.append(
                    "("
                    + ",".join(
                        sql_literal(r.get(c)) + cast for c, cast in zip(SNAPSHOT_COLS, casts)
                    )
                    + ")"
                )
            collist = ", ".join(f'"{c}"' for c in SNAPSHOT_COLS)
            upd = ", ".join(f'"{c}" = EXCLUDED."{c}"' for c in SNAPSHOT_COLS if c != "id")
            yield "brand_health_snapshots", (
                f"WITH shared(j) AS (SELECT {quote(shared_json)}::jsonb)\n"
                f"INSERT INTO brand_health_snapshots ({collist}, \"assumptions\")\n"
                f"SELECT r.*, shared.j || jsonb_build_object("
                f"'coverage', r.coverage, 'cohort_size', r.cohort_size)\n"
                f"FROM (VALUES\n" + ",\n".join(values) + f"\n) AS r({collist}), shared\n"
                f"ON CONFLICT (id) DO UPDATE SET {upd}, "
                f'"assumptions" = EXCLUDED."assumptions";'
            )


def statements(
    payload: dict[str, list[dict[str, Any]]], chunk_size: int, lean: bool
) -> Iterable[tuple[str, str]]:
    """(table, sql) pairs, each a self-contained idempotent upsert."""
    for table in ORDER:
        rows = payload[table]
        if not rows:
            continue
        if table == "brand_health_snapshots":
            yield from snapshot_statements(rows, chunk_size)
            continue
        cols = table_columns(rows, table, lean)
        for chunk in batched(rows, chunk_size):
            collist = ", ".join(f'"{c}"' for c in cols)
            values = ",\n".join(
                "(" + ",".join(sql_literal(r.get(c)) for c in cols) + ")" for r in chunk
            )
            upd = ", ".join(f'"{c}" = EXCLUDED."{c}"' for c in cols if c != "id")
            yield table, (
                f"INSERT INTO {table} ({collist}) VALUES\n{values}\n"
                f"ON CONFLICT ({CONFLICT[table]}) DO UPDATE SET {upd};"
            )


def emit_sql(
    payload: dict[str, list[dict[str, Any]]], out: Path, chunk_size: int, lean: bool
) -> None:
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w") as fh:
        fh.write("-- Generated by scripts/seed_dashboard.py. Idempotent: re-run freely.\n")
        fh.write("BEGIN;\n")
        for _, sql in statements(payload, chunk_size, lean):
            fh.write(sql + "\n")
        fh.write("COMMIT;\n")


def emit_parts(
    payload: dict[str, list[dict[str, Any]]], outdir: Path, chunk_size: int, lean: bool
) -> None:
    """One file per statement, so a seed can be applied a piece at a time by a
    caller that has no long-lived Postgres connection."""
    outdir.mkdir(parents=True, exist_ok=True)
    for old in outdir.glob("*.sql"):
        old.unlink()
    for i, (table, sql) in enumerate(statements(payload, chunk_size, lean)):
        path = outdir / f"{i:03d}_{table}.sql"
        path.write_text(sql + "\n")
        print(f"  {path.name}  {len(sql):>8,} bytes", file=sys.stderr)


def batched(rows: list[dict[str, Any]], n: int):
    for i in range(0, len(rows), n):
        yield rows[i : i + n]


def push_rpc(payload: dict[str, list[dict[str, Any]]], batch: int) -> dict[str, int]:
    url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_PUBLISHABLE_KEY") or os.environ.get("SUPABASE_ANON_KEY")
    token = os.environ.get("SEED_TOKEN")
    if not (url and key and token):
        raise SystemExit("--rpc needs SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY and SEED_TOKEN")

    endpoint = f"{url}/rest/v1/rpc/seed_ingest"
    written: dict[str, int] = {}
    for table in ORDER:
        rows = payload[table]
        total = 0
        for chunk in batched(rows, batch):
            body = json.dumps(
                {
                    "p_token": token,
                    "p_table": table,
                    "p_rows": chunk,
                    "p_conflict": CONFLICT[table],
                }
            ).encode()
            req = urllib.request.Request(
                endpoint,
                data=body,
                headers={
                    "Content-Type": "application/json",
                    "apikey": key,
                    "Authorization": f"Bearer {key}",
                },
                method="POST",
            )
            try:
                with urllib.request.urlopen(req, timeout=120) as resp:
                    total += int(json.loads(resp.read().decode() or "0") or 0)
            except urllib.error.HTTPError as exc:
                detail = exc.read().decode()[:600]
                raise SystemExit(f"{table}: HTTP {exc.code} {detail}") from None
        written[table] = total
        print(f"  {table}: {total} rows upserted", file=sys.stderr)
    return written


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out-sql", type=Path, help="write idempotent SQL to this path")
    ap.add_argument("--out-parts", type=Path, help="write one SQL file per upsert batch")
    ap.add_argument("--rpc", action="store_true", help="push through the seed_ingest RPC")
    ap.add_argument("--batch", type=int, default=100, help="rows per RPC call")
    ap.add_argument("--chunk", type=int, default=200, help="rows per SQL statement")
    ap.add_argument(
        "--lean",
        action="store_true",
        help="omit bulk columns no dashboard route renders (raw OSM tags, video "
        "descriptions and the screening/style/ROI blobs)",
    )
    ap.add_argument("--counts", action="store_true", help="print row counts and exit")
    args = ap.parse_args()

    payload = build_rows()

    print("Rows built from the measured roster:", file=sys.stderr)
    for table in ORDER:
        print(f"  {table}: {len(payload[table])}", file=sys.stderr)

    if args.counts:
        return 0
    if args.out_sql:
        emit_sql(payload, args.out_sql, args.chunk, args.lean)
        print(f"Wrote {args.out_sql}", file=sys.stderr)
    if args.out_parts:
        emit_parts(payload, args.out_parts, args.chunk, args.lean)
    if args.rpc:
        print("Pushing through seed_ingest…", file=sys.stderr)
        push_rpc(payload, args.batch)
    if not (args.out_sql or args.out_parts or args.rpc):
        ap.error("pick --out-sql PATH, --out-parts DIR, --rpc, or --counts")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
