"""`data/roster_export.json` — the seed contract for the dashboard/Supabase.

This file is read by another service. Treat the shape below as an interface:
add fields freely, but renaming or removing one is a breaking change, and
`schema_version` exists to say so.

## Rules the shape obeys

**Absent is null, never zero.** Every consumer of this file will be tempted to
`?? 0` its way through the nulls. Do not, and do not help them: a cafe with no
review signal is not a cafe with zero reviews, and a video whose like count
yt-dlp could not read is not a video with no likes. The distinction is the
whole reason Brand Health can say "confidence: medium" instead of quietly
scoring a blank as a bad result. Nulls here are load-bearing.

**Timestamps are ISO-8601 UTC**, with an offset, always. SQLite's
`CURRENT_TIMESTAMP` writes a naive `YYYY-MM-DD HH:MM:SS`; `_iso()` normalizes
those to `...+00:00` on the way out so no consumer has to guess a zone.

**Nothing is fabricated.** No default ratings, no zero-filled metrics, no
invented coordinates. If we did not measure it, the key is present and null —
present so the schema is stable, null so nobody mistakes it for a measurement.

## Top level

    {
      "schema_version": 2,
      "generated_at":   ISO-8601 UTC,
      "source": {"roster_db": str, "corpus_db": str, "county": str|null},
      "counts": {
        "total":           int,   # every roster record, chains included
        "independent":     int,   # non-chain records, every lifecycle state
        "chains_excluded": int,
        "active":          int,   # == len(cafes); the sellable set
        "retired":         int,   # == len(retired)
        "by_status":       {"active": int, "closed": int, "unverifiable": int},
        "ranked":          int,   # active cafes with a rankable score
        "with_video_signal":  int,
        "with_review_signal": int,
        "videos":          int    # video objects across all cafes
      },
      "cafes":   [Cafe],   # ACTIVE independents only — the prospect set
      "retired": [Cafe]    # closed + unverifiable, same shape, kept as
                           # evidence. Never merge these into `cafes`:
                           # a closed cafe must not reach a ranking.
    }

## Cafe

    {
      "cafe_id":   "osm:<node|way|relation>:<id>",   # stable primary key
      "name":      str,
      "city":      str|null,
      "county":    str|null,
      "address":   str|null,          # formatted from the OSM address parts
      "lat":       float|null,
      "lon":       float|null,
      "website":   str|null,
      "instagram": str|null,          # bare handle, no @ and no URL
      "is_chain":  false,             # always false; chains are not exported

      "status": {
        "state":      "active"|"closed"|"unverifiable",
        "confidence": "high"|"medium"|"low"|null,
        "reason":     str|null,       # one human-readable sentence
        "evidence":   object|null,    # what was actually observed
        "checked_at": ISO-8601 UTC|null
      },

      "brand_health": {               # null when never scored
        "score":       float|null,    # 0-100, null when nothing was measurable
        "confidence":  "high"|"medium"|"low"|"none",
        "rankable":    bool,          # false = real score, too thin to compare
        "captured_at": ISO-8601 UTC|null,
        "components":  {              # one entry per weighted component
          "<component>": {"raw": float|null, "percentile": float|null,
                          "weight": float, "status": "absent"|null}
        },
        "assumptions": object         # weights, cohort size, coverage, sources
      },

      "review_signal": {              # null when no review source answered
        "provider":     "google_places"|"yelp",
        "rating":       float|null,
        "review_count": int|null,
        "place_id":     str|null,
        "matched_name": str|null,
        "collected_at": ISO-8601 UTC|null
      },

      "video_signal": {               # null when the video pass never ran
        "video_count":  int,          # 0 IS a measurement: we looked, found none
        "queries":      [str],
        "collected_at": ISO-8601 UTC|null,
        "total_views":  int|null,     # null when no video reported views
        "newest_published_at": ISO-8601 UTC|null
      },

      "videos": [Video],              # [] when none; joined from discover.db
      "measured_at": ISO-8601 UTC|null
    }

## Video

Sourced from `data/discover.db.discovered_videos` where
`business_id = cafe_id` — the shared spine between the roster and the video
corpus. Falls back to the summary embedded in `cafe_signals.youtube` when the
corpus is unavailable, so the export never silently loses a cafe's videos.

    {
      "canonical_id": "youtube:<id>",
      "platform":     str,
      "url":          str,
      "title":        str|null,
      "views":        int|null,
      "likes":        int|null,
      "comments":     int|null,
      "published_at": ISO-8601 UTC|null,
      "creator":      str|null,       # handle, e.g. "@ktla"
      "rights_status": str|null       # "unlicensed_reference" by default
    }
"""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from .brand_health import score_roster
from .roster import CafeRecord, STATUS_ACTIVE

SCHEMA_VERSION = 2
DEFAULT_EXPORT_PATH = Path("data/roster_export.json")
DEFAULT_CORPUS_DB = Path("data/discover.db")


def _iso(value: Any) -> Optional[str]:
    """Normalize a stored timestamp to ISO-8601 UTC, or None.

    SQLite's CURRENT_TIMESTAMP writes naive "YYYY-MM-DD HH:MM:SS" while our
    own writers use `datetime.now(timezone.utc).isoformat()`. Both land in the
    same columns, so the export normalizes rather than making every consumer
    handle two formats. An unparseable value returns None — a wrong timestamp
    is worse than a missing one.
    """
    if value in (None, ""):
        return None
    text = str(value).strip().replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc).isoformat()


def _blank_to_none(value: Any) -> Any:
    """OSM absences arrive as empty strings; the export emits null.

    Zero and False are values, not absences, and pass through untouched.
    """
    if value is None or (isinstance(value, str) and not value.strip()):
        return None
    return value


def _int_or_none(value: Any) -> Optional[int]:
    if value is None or isinstance(value, bool):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


# ------------------------------------------------------------------ videos

def load_corpus_videos(corpus_db: Path | str = DEFAULT_CORPUS_DB
                       ) -> dict[str, list[dict[str, Any]]]:
    """cafe_id -> its videos, read straight from the Discover corpus.

    Returns {} when the corpus is missing or has not been created yet; the
    export degrades to the summary on `cafe_signals.youtube` rather than
    failing, because a roster export with no videos is still useful and a
    crashed export is not.
    """
    path = Path(corpus_db)
    if not path.exists():
        return {}

    out: dict[str, list[dict[str, Any]]] = {}
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute(
            "SELECT canonical_id, platform, url, title, published_at,"
            " creator, metrics, rights_status, business_id"
            " FROM discovered_videos WHERE business_id IS NOT NULL"
            " AND business_id != ''").fetchall()
    except sqlite3.DatabaseError:
        return {}
    finally:
        conn.close()

    for row in rows:
        metrics = _load_json(row["metrics"]) or {}
        creator = _load_json(row["creator"]) or {}
        out.setdefault(row["business_id"], []).append({
            "canonical_id": row["canonical_id"],
            "platform": _blank_to_none(row["platform"]),
            "url": _blank_to_none(row["url"]),
            "title": _blank_to_none(row["title"]),
            # Absent metrics stay null. yt-dlp's flat search returns views
            # only; likes and comments arrive from the per-video enrich pass,
            # which runs on the top few videos and not the tail.
            "views": _int_or_none(metrics.get("view_count")),
            "likes": _int_or_none(metrics.get("like_count")),
            "comments": _int_or_none(metrics.get("comment_count")),
            "published_at": _iso(row["published_at"]),
            "creator": _blank_to_none(creator.get("handle")
                                      or creator.get("display_name")),
            "rights_status": _blank_to_none(row["rights_status"]),
        })
    for videos in out.values():
        videos.sort(key=lambda v: (v["views"] is None, -(v["views"] or 0)))
    return out


def _load_json(raw: Any) -> Any:
    if not raw:
        return None
    if isinstance(raw, (dict, list)):
        return raw
    try:
        return json.loads(raw)
    except (TypeError, ValueError):
        return None


def _videos_from_signal(youtube: Optional[dict[str, Any]]
                        ) -> list[dict[str, Any]]:
    """Fallback shape from the stored YouTube summary, same keys as the
    corpus rows so a consumer never has to branch on provenance."""
    out = []
    for v in (youtube or {}).get("videos") or []:
        out.append({
            "canonical_id": v.get("canonical_id"),
            "platform": "youtube",
            "url": _blank_to_none(v.get("url")),
            "title": _blank_to_none(v.get("title")),
            "views": _int_or_none(v.get("views")),
            "likes": _int_or_none(v.get("likes")),
            "comments": _int_or_none(v.get("comments")),
            "published_at": _iso(v.get("published_at")),
            "creator": None,
            "rights_status": "unlicensed_reference",
        })
    return out


# ------------------------------------------------------------- components

def _status_block(cafe: CafeRecord) -> dict[str, Any]:
    return {
        "state": cafe.status or STATUS_ACTIVE,
        "confidence": _blank_to_none(cafe.status_confidence),
        "reason": _blank_to_none(cafe.status_reason),
        "evidence": cafe.status_evidence or None,
        "checked_at": _iso(cafe.status_checked_at),
    }


def _review_block(signals: Optional[dict[str, Any]]) -> Optional[dict[str, Any]]:
    """Google first, Yelp as the legacy fallback — the same precedence
    `raw_components` scores on, so the export cannot disagree with the score."""
    signals = signals or {}
    google, yelp = signals.get("google"), signals.get("yelp")
    source, provider = (google, "google_places") if google else (yelp, "yelp")
    if not source:
        return None
    return {
        "provider": source.get("provider") or provider,
        # A place Google lists but nobody has rated stays null here. It is not
        # a zero-star cafe, and the score treats it as unmeasured too.
        "rating": source.get("rating"),
        "review_count": _int_or_none(source.get("review_count")),
        "place_id": _blank_to_none(source.get("place_id")),
        "matched_name": _blank_to_none(source.get("matched_name")),
        "collected_at": _iso(source.get("collected_at")
                             or signals.get("reviews_checked_at")),
    }


def _video_block(signals: Optional[dict[str, Any]],
                 videos: list[dict[str, Any]]) -> Optional[dict[str, Any]]:
    youtube = (signals or {}).get("youtube")
    if youtube is None:
        return None  # the video pass never ran — absent, not "zero videos"
    views = [v["views"] for v in videos if v["views"] is not None]
    published = [v["published_at"] for v in videos if v["published_at"]]
    return {
        # A successful search that found nothing is a real 0.
        "video_count": _int_or_none(youtube.get("video_count")) or 0,
        "queries": youtube.get("queries") or [],
        "collected_at": _iso(youtube.get("collected_at")
                             or (signals or {}).get("video_checked_at")),
        "total_views": sum(views) if views else None,
        "newest_published_at": max(published) if published else None,
    }


def _health_block(health: Any) -> Optional[dict[str, Any]]:
    if health is None:
        return None
    return {
        "score": health.score,
        "confidence": health.confidence,
        "rankable": bool(health.rankable),
        "captured_at": None,
        "components": health.components,
        "assumptions": health.assumptions,
    }


def cafe_row(cafe: CafeRecord, signals: Optional[dict[str, Any]],
             health: Any, videos: list[dict[str, Any]],
             captured_at: Optional[str] = None) -> dict[str, Any]:
    """One cafe in the documented export shape."""
    block = _health_block(health)
    if block is not None:
        block["captured_at"] = _iso(captured_at)
    return {
        "cafe_id": cafe.cafe_id,
        "name": cafe.name,
        "city": _blank_to_none(cafe.city),
        "county": _blank_to_none(cafe.county),
        "address": _blank_to_none(cafe.address()),
        "lat": cafe.lat,
        "lon": cafe.lon,
        "website": _blank_to_none(cafe.website),
        "instagram": _blank_to_none(cafe.instagram),
        "is_chain": bool(cafe.is_chain),
        "status": _status_block(cafe),
        "brand_health": block,
        "review_signal": _review_block(signals),
        "video_signal": _video_block(signals, videos),
        "videos": videos,
        "measured_at": _iso((signals or {}).get("collected_at")),
    }


# ------------------------------------------------------------------ export

def build_export(store: Any, corpus_db: Path | str = DEFAULT_CORPUS_DB,
                 now: Optional[str] = None) -> dict[str, Any]:
    """Assemble the whole payload. Pure — writes nothing."""
    generated_at = now or datetime.now(timezone.utc).isoformat()
    signals = store.all_signals()
    snapshots = store.latest_snapshots()
    corpus_videos = load_corpus_videos(corpus_db)

    active = store.cafes()                       # independents, active only
    retired = [c for c in store.cafes(include_inactive=True)
               if c.status != STATUS_ACTIVE]

    # Score the active set only, so percentiles are computed over exactly the
    # cohort the dashboard shows. Scoring the retired cafes into the cohort
    # would shift every percentile for cafes nobody can sell to.
    health_by_id = {h.cafe_id: h for h in score_roster(active, signals)}

    def rows(cafes: list[CafeRecord]) -> list[dict[str, Any]]:
        out = []
        for cafe in cafes:
            sig = signals.get(cafe.cafe_id)
            videos = corpus_videos.get(cafe.cafe_id)
            if videos is None:
                videos = _videos_from_signal((sig or {}).get("youtube"))
            snap = snapshots.get(cafe.cafe_id) or {}
            out.append(cafe_row(cafe, sig, health_by_id.get(cafe.cafe_id),
                                videos, captured_at=snap.get("captured_at")))
        return out

    active_rows = rows(active)
    retired_rows = rows(retired)

    base = store.counts()
    counts = {
        "total": base["total"],
        "independent": base["independent"],
        "chains_excluded": base["chains"],
        "active": len(active_rows),
        "retired": len(retired_rows),
        "by_status": store.status_counts(),
        "ranked": sum(1 for r in active_rows
                      if (r["brand_health"] or {}).get("rankable")),
        "with_video_signal": sum(1 for r in active_rows
                                 if r["video_signal"] is not None),
        "with_review_signal": sum(1 for r in active_rows
                                  if r["review_signal"] is not None),
        "videos": sum(len(r["videos"]) for r in active_rows + retired_rows),
    }
    county = next((r["county"] for r in active_rows if r["county"]), None)
    return {
        "schema_version": SCHEMA_VERSION,
        "generated_at": _iso(generated_at),
        "source": {"roster_db": str(store.path), "corpus_db": str(corpus_db),
                   "county": county},
        "counts": counts,
        "cafes": active_rows,
        "retired": retired_rows,
    }


def write_export(store: Any, path: Path | str = DEFAULT_EXPORT_PATH,
                 corpus_db: Path | str = DEFAULT_CORPUS_DB
                 ) -> tuple[Path, dict[str, Any]]:
    payload = build_export(store, corpus_db=corpus_db)
    out = Path(path)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, indent=2, ensure_ascii=False))
    return out, payload
