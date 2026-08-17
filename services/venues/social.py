"""Per-cafe public signal collection — the metrics pass behind Brand Health.

For each roster cafe, without any paid API:

  * **YouTube via yt-dlp** — search "<name> <city>" variants (reusing
    Discover's `business_queries`), keep only videos that are plausibly *about*
    this cafe, enrich the top few for likes/comments/publish date, and land
    every kept row in the Discover corpus (`business_id` = the cafe key,
    metadata only — never media).
  * **Yelp, best-effort** — one polite request to the public search page per
    cafe, parsed for rating and review count. Yelp actively resists scraping;
    when it blocks or the parse misses, the signal is recorded as *absent*
    (None), never zero. The Fusion API key is the real fix.

Instagram is skipped entirely: every unauthenticated surface is blocked
(measured 2026-07-25 — instaloader 403s, oEmbed returns a login page). The OSM
`contact:instagram` handle is captured on the roster so the Graph API
integration has seeds waiting.

Resume, not restart: cafes are processed in deterministic `cafe_id` order and
each attempt writes a `cafe_signals` row, so `pending_cafes()` on the next run
starts where this one stopped.
"""

from __future__ import annotations

import re
import time
from datetime import datetime, timezone
from typing import Any, Callable, Optional

import requests

from services.discover.connectors.base import ConnectorError
from services.discover.connectors.ytdlp import YtDlpConnector
from services.discover.harvest import NOISE_KEYWORDS
from services.discover.models import DiscoveredVideo, INTENT_BUSINESS
from services.discover.queries import BusinessTarget, business_queries
from services.discover.store import CorpusStore

from .resolver import content_tokens, normalize
from .roster import CafeRecord
from .store import RosterStore


def _utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


# ------------------------------------------------------------------ relevance

def video_mentions_cafe(cafe_name: str, video: DiscoveredVideo) -> bool:
    """Does this search result plausibly refer to *this* cafe?

    Keyword search is recall-first and returns plenty of videos about other
    venues that share a word. The gate: every distinctive token of the cafe's
    name appears in the title+description, or the whole name fuzzy-matches the
    title. Precision matters more than recall here — a video about someone
    else's cafe on a prospect's dashboard is the expensive failure, same as a
    wrong venue attach.
    """
    haystack = normalize(f"{video.title or ''} {video.description or ''}")
    # Single-character tokens are traps: "Sergio's" normalizes to
    # ["sergio", "s"], and a bare "s" is in every English sentence — measured
    # over-attaching 13 videos to one cafe before this guard existed.
    tokens = [t for t in content_tokens(cafe_name) if len(t) >= 2]
    if len(tokens) >= 2 and all(t in haystack for t in tokens):
        return True
    # Otherwise the full name must appear as a word-bounded phrase. Two
    # variants because titles drop apostrophes both ways: "Sergio's" must
    # match "Sergio's Cafe" (normalized "sergio s") and "Sergios Cafe"
    # (collapsed "sergios") — but never "Sergio Santos". Deliberately NOT
    # name_similarity(): its containment view is built for partial sign
    # reads and happily scores "sergio s" inside "sergio santos vlog".
    base = normalize(cafe_name)
    collapsed = re.sub(r"\b(\w+) s\b", r"\1s", base)
    padded = f" {haystack} "
    return any(f" {variant} " in padded for variant in (base, collapsed))


def _is_noise(video: DiscoveredVideo) -> bool:
    haystack = f"{video.title or ''} {video.description or ''}".lower()
    return any(kw in haystack for kw in NOISE_KEYWORDS)


# ------------------------------------------------------------------- youtube

def cafe_business_target(cafe: CafeRecord) -> BusinessTarget:
    """The wiring point: a roster cafe as a Discover BusinessTarget, so the
    existing business-intent pipeline (queries -> harvest -> corpus) works on
    any cafe unchanged."""
    handles = {}
    if cafe.instagram:
        handles["instagram"] = f"@{cafe.instagram}"
    if cafe.tiktok:
        handles["tiktok"] = f"@{cafe.tiktok}"
    return BusinessTarget(
        name=cafe.name,
        business_id=cafe.cafe_id,
        city=cafe.city or cafe.county,
        cuisine=cafe.cuisine.replace("_", " ") if cafe.cuisine else "",
        handles=handles,
    )


def collect_youtube(
    cafe: CafeRecord,
    connector: YtDlpConnector,
    corpus: Optional[CorpusStore] = None,
    max_queries: int = 2,
    per_query_limit: int = 10,
    enrich_top: int = 3,
    on_status: Callable[[str], None] = print,
) -> tuple[Optional[dict[str, Any]], list[str]]:
    """(youtube signal summary, errors). Summary is None only when *every*
    query failed — "we could not look" — while a successful search that found
    nothing returns `video_count: 0`, which is a real measurement.
    """
    target = cafe_business_target(cafe)
    # business_queries is recall-first (5+ variants); the county-wide metrics
    # pass takes the two highest-precision ones and leaves the full set to the
    # per-cafe `harvest` command.
    queries = business_queries(target, ["youtube"], limit=per_query_limit)[:max_queries]

    errors: list[str] = []
    seen: dict[str, DiscoveredVideo] = {}
    queries_ok = 0
    for query in queries:
        try:
            for video in connector.search(query):
                if video.canonical_id in seen or _is_noise(video):
                    continue
                if not video_mentions_cafe(cafe.name, video):
                    continue
                video.intent = INTENT_BUSINESS
                video.business_id = cafe.cafe_id
                seen[video.canonical_id] = video
            queries_ok += 1
        except ConnectorError as exc:
            errors.append(f"youtube search {query.text!r}: {exc}")

    if queries_ok == 0:
        return None, errors  # could not measure — absent, not zero

    videos = sorted(seen.values(),
                    key=lambda v: v.metrics.view_count or -1, reverse=True)

    # Flat search gives views only; likes/comments/publish date need one
    # request per video. Enrich the top few — engagement and recency come from
    # the videos that carry the reach anyway.
    for video in videos[:enrich_top]:
        try:
            connector.enrich(video)
        except ConnectorError as exc:
            errors.append(f"youtube enrich {video.url}: {exc}")

    if corpus is not None:
        corpus.upsert_many(videos)   # metadata rows; rights default reference

    summary = {
        "video_count": len(videos),
        "queries": [q.text for q in queries],
        "collected_at": _utcnow(),
        "videos": [{
            "canonical_id": v.canonical_id,
            "url": v.url,
            "title": v.title,
            "views": v.metrics.view_count,
            "likes": v.metrics.like_count,
            "comments": v.metrics.comment_count,
            "published_at": v.published_at,
            "creator_followers": v.creator.follower_count,
        } for v in videos],
    }
    return summary, errors


# ---------------------------------------------------------------------- yelp

YELP_UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
           "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36")

_RATING_RE = re.compile(r'"rating"\s*:\s*([0-9.]+)')
_REVIEWS_RE = re.compile(r'"reviewCount"\s*:\s*(\d+)')


def collect_yelp(
    cafe: CafeRecord,
    timeout: float = 12.0,
    _get: Optional[Callable[..., Any]] = None,   # test seam
) -> tuple[Optional[dict[str, Any]], Optional[str]]:
    """(yelp signal, error). One request to the public search page; graceful
    on every failure mode. Absent is None — a blocked scrape must never read
    as a zero-star cafe.

    Location falls back to the county: 218 of the 377 OC independents arrived
    from OSM with no `addr:city`, and skipping Yelp for all of them would
    throw away the review component for most of the roster.
    """
    location = cafe.city or cafe.county
    if not location:
        return None, "yelp: no city or county on the roster record to search in"

    get = _get or requests.get
    url = ("https://www.yelp.com/search?find_desc="
           + requests.utils.quote(cafe.name)
           + "&find_loc=" + requests.utils.quote(f"{location}, CA"))
    try:
        response = get(url, headers={"User-Agent": YELP_UA,
                                     "Accept-Language": "en-US,en;q=0.9"},
                       timeout=timeout)
    except requests.RequestException as exc:
        return None, f"yelp: request failed ({exc})"

    if response.status_code != 200:
        return None, f"yelp: HTTP {response.status_code}"

    html = response.text
    # The search page embeds result objects as JSON. Anchor on the cafe name
    # to avoid reading the rating of whatever business happens to be first.
    anchor = html.lower().find(cafe.name.lower())
    window = html[anchor:anchor + 4000] if anchor >= 0 else ""
    rating_m = _RATING_RE.search(window)
    reviews_m = _REVIEWS_RE.search(window)
    if not (rating_m and reviews_m):
        return None, "yelp: page fetched but rating not found (markup changed or consent wall)"

    try:
        rating = float(rating_m.group(1))
        review_count = int(reviews_m.group(1))
    except ValueError:
        return None, "yelp: unparseable rating values"
    if not (0.0 < rating <= 5.0):
        return None, f"yelp: implausible rating {rating}"

    return {"rating": rating, "review_count": review_count,
            "source_url": url, "collected_at": _utcnow()}, None


# After this many consecutive 403s the Yelp circuit opens for the rest of the
# run: the block is IP-level, not per-cafe (measured 2026-08-16 — 403 on the
# first three cafes straight), so continuing is 350+ pointless requests
# against a host that already said no.
YELP_CIRCUIT_403S = 5


# -------------------------------------------------------------- metrics pass

def run_metrics_pass(
    roster: RosterStore,
    corpus: Optional[CorpusStore] = None,
    connector: Optional[YtDlpConnector] = None,
    limit: Optional[int] = None,
    skip_yelp: bool = False,
    pause_seconds: float = 1.5,
    on_status: Callable[[str], None] = print,
) -> dict[str, int]:
    """Measure pending cafes until `limit` is exhausted. Deterministic order +
    one `cafe_signals` row per attempt = a re-run resumes, never restarts."""
    connector = connector or YtDlpConnector(short_form_only=False)
    ok, why = connector.available()
    if not ok:
        raise ConnectorError(why)

    pending = roster.pending_cafes(limit=limit)
    tally = {"attempted": 0, "youtube_measured": 0, "videos_found": 0,
             "yelp_measured": 0, "yelp_absent": 0}
    yelp_403_streak = 0

    for i, cafe in enumerate(pending, 1):
        tally["attempted"] += 1
        on_status(f"[metrics {i}/{len(pending)}] {cafe.name} ({cafe.city or '?'})")

        youtube, errors = collect_youtube(cafe, connector, corpus,
                                          on_status=on_status)
        if youtube is not None:
            tally["youtube_measured"] += 1
            tally["videos_found"] += youtube["video_count"]
            on_status(f"  youtube: {youtube['video_count']} relevant videos")
        else:
            on_status("  youtube: measurement failed")

        yelp = None
        if not skip_yelp and yelp_403_streak < YELP_CIRCUIT_403S:
            yelp, yelp_error = collect_yelp(cafe)
            if yelp is not None:
                yelp_403_streak = 0
                tally["yelp_measured"] += 1
                on_status(f"  yelp: {yelp['rating']} stars, "
                          f"{yelp['review_count']} reviews")
            else:
                tally["yelp_absent"] += 1
                errors.append(yelp_error or "yelp: absent")
                on_status(f"  {yelp_error}")
                if "403" in (yelp_error or ""):
                    yelp_403_streak += 1
                    if yelp_403_streak >= YELP_CIRCUIT_403S:
                        on_status("  yelp: circuit open — IP-level block, "
                                  "skipping yelp for the rest of this run")
        elif not skip_yelp:
            tally["yelp_absent"] += 1
            errors.append("yelp: skipped (circuit open after repeated 403s)")

        roster.set_signals(cafe.cafe_id, youtube=youtube, yelp=yelp,
                           errors=errors, collected_at=_utcnow())
        if pause_seconds and i < len(pending):
            time.sleep(pause_seconds)

    return tally
