"""Harvest orchestration — run queries through a connector into the corpus.

Rules this layer enforces, because no connector should have to:
  * one failing query never kills a run
  * filter on cheap metadata before spending an expensive enrich call
  * dedupe within the run as well as against the store
  * every record lands with an explicit rights status
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Callable, Optional

from .connectors.base import Connector, ConnectorError
from .models import DiscoveredVideo, SourceQuery, RIGHTS_REFERENCE
from .store import CorpusStore


# Keyword search cannot tell a customer's cafe vlog from a coffee brand's
# commercial, a stock-footage reel, or a sitcom scene set in a cafe. All three
# showed up near the top of the first real harvest. They are worthless to
# Divvit — we model *customer* UGC — and they are worse than worthless if they
# reach screening, where each one burns an indexed minute.
NOISE_KEYWORDS = (
    # production / stock
    "b roll", "b-roll", "stock footage", "royalty free", "no copyright",
    "green screen", "template", "after effects", "commercial", "advert",
    "tvc", "promo video", "corporate video",
    # music / ambience playlists dressed as cafe content
    "playlist", "lofi", "lo-fi", "jazz music", "bossa nova", "relaxing music",
    "study music", "sleep music", "1 hour", "2 hours", "3 hours", "10 hours",
    # broadcast / entertainment clips
    "movie clip", "trailer", "full episode", "official video", "music video",
    "sitcom", "snl", "tonight show",
    # tutorials about making videos rather than visiting cafes
    "how to start a", "business plan", "franchise",
    # recipe/technique tutorials — cafe-adjacent but not a customer visit
    "how to make", "how to brew", "the making of", "recipe tutorial",
    "unboxing", "espresso machine review",
    # local TV news segments about restaurants
    "yelp's top", "eyewitness news", "news at 5", "news at 6", "news at 10",
    "abc 10", "nbc 7", "fox 5 san diego", "cbs 8",
)


@dataclass
class HarvestFilters:
    """Metadata-only gate. Runs before enrichment, so rejects are free."""

    # Shorts / Reels / TikTok territory. 180s let 2-3 minute mini-vlogs in,
    # which is a different medium from what Divvit's creators make.
    max_duration_seconds: Optional[float] = 90.0
    min_duration_seconds: Optional[float] = 5.0     # drop stubs and stills
    # Vertical framing is the defining trait of Shorts/Reels/TikTok and the
    # cheapest reliable way to tell them from a landscape YouTube video.
    # Only known after enrichment, so this bites on the post-enrich re-check.
    require_vertical: bool = True
    min_views: Optional[int] = None
    # A daily agent wants what is happening now, not a 2011 latte art contest.
    # Only applied once we know the publish date (i.e. after enrichment).
    max_age_days: Optional[float] = None
    exclude_live: bool = True
    require_title: bool = True
    exclude_noise: bool = True
    # A 5M-subscriber channel is a media company, not a Divvit creator. Its
    # numbers would poison the leverage model the ROI projection rests on.
    max_creator_followers: Optional[int] = 2_000_000

    def passes(self, video: DiscoveredVideo,
               post_enrich: bool = False) -> tuple[bool, str]:
        """`post_enrich=True` applies the checks that need enriched fields.

        Before enrichment, unknown orientation has to pass — we simply don't
        know yet. After it, unknown means we tried and failed to find out, and
        for a Shorts-only corpus the safe answer is to drop it.
        """
        d = video.duration_seconds
        if self.require_title and not (video.title or "").strip():
            return False, "no title"
        if self.exclude_noise:
            haystack = f"{video.title or ''} {video.description or ''}".lower()
            hit = next((kw for kw in NOISE_KEYWORDS if kw in haystack), None)
            if hit:
                return False, f"noise keyword ({hit})"
        followers = video.creator.follower_count
        if (self.max_creator_followers is not None and followers is not None
                and followers > self.max_creator_followers):
            return False, f"creator too large ({followers})"
        if d is not None:
            if self.max_duration_seconds and d > self.max_duration_seconds:
                return False, f"too long ({d:.0f}s)"
            if self.min_duration_seconds and d < self.min_duration_seconds:
                return False, f"too short ({d:.0f}s)"
        if self.exclude_live and d == 0:
            return False, "live or zero-duration"
        views = video.metrics.view_count
        if self.min_views is not None and views is not None and views < self.min_views:
            return False, f"under view floor ({views})"
        if self.max_age_days is not None:
            age = video.age_days()
            if age is not None and age > self.max_age_days:
                return False, f"too old ({age:.0f}d)"
        if self.require_vertical:
            if video.width and video.height:
                if video.height <= video.width:
                    return False, f"landscape ({video.width}x{video.height})"
            elif post_enrich:
                return False, "orientation unknown after enrichment"
        return True, ""


@dataclass
class HarvestReport:
    queries_run: int = 0
    queries_failed: int = 0
    found: int = 0
    filtered_out: int = 0
    enriched: int = 0
    new_rows: int = 0
    errors: list[str] = field(default_factory=list)
    duration_seconds: float = 0.0

    def summary(self) -> str:
        return (f"{self.new_rows} new / {self.found} kept "
                f"({self.filtered_out} filtered, {self.enriched} enriched) "
                f"from {self.queries_run} queries"
                f"{f', {self.queries_failed} failed' if self.queries_failed else ''} "
                f"in {self.duration_seconds:.1f}s")


class Harvester:
    def __init__(
        self,
        connector: Connector,
        store: CorpusStore,
        filters: Optional[HarvestFilters] = None,
        enrich: bool = True,
        enrich_limit: Optional[int] = None,
        pause_seconds: float = 0.0,
        on_status: Callable[[str], None] = print,
    ):
        self.connector = connector
        self.store = store
        self.filters = filters or HarvestFilters()
        self.enrich = enrich
        # Enrichment is one request per video on yt-dlp and the main source of
        # both runtime and rate-limit pressure. Cap it per run.
        self.enrich_limit = enrich_limit
        self.pause_seconds = pause_seconds
        self.on_status = on_status

    def run(self, queries: list[SourceQuery],
            rights_status: str = RIGHTS_REFERENCE) -> HarvestReport:
        ok, why = self.connector.available()
        if not ok:
            raise ConnectorError(f"connector {self.connector.name} unavailable: {why}")

        started = datetime.now(timezone.utc)
        clock = time.time()
        report = HarvestReport()
        seen_this_run: set[str] = set()
        enrich_budget = self.enrich_limit if self.enrich_limit is not None else 10**9

        for query in queries:
            report.queries_run += 1
            self.on_status(f"[harvest] {query.platform}/{query.intent}: {query.text!r}")
            try:
                results = list(self.connector.search(query))
            except ConnectorError as exc:
                report.queries_failed += 1
                report.errors.append(f"{query.text}: {exc}")
                self.on_status(f"  ! {exc}")
                continue

            kept: list[DiscoveredVideo] = []
            for video in results:
                if video.canonical_id in seen_this_run:
                    continue
                seen_this_run.add(video.canonical_id)

                passes, reason = self.filters.passes(video)
                if not passes:
                    report.filtered_out += 1
                    continue

                if self.enrich and enrich_budget > 0 and self._needs_enrich(video):
                    try:
                        video = self.connector.enrich(video)
                        report.enriched += 1
                        enrich_budget -= 1
                    except ConnectorError as exc:
                        # Keep the record; partial metrics beat losing the video.
                        report.errors.append(f"enrich {video.url}: {exc}")
                    else:
                        # Follower count and full description only exist after
                        # enrichment, so the filters that depend on them get
                        # their real chance here.
                        passes, reason = self.filters.passes(video, post_enrich=True)
                        if not passes:
                            report.filtered_out += 1
                            continue

                video.rights_status = rights_status
                kept.append(video)

            total, new = self.store.upsert_many(kept)
            report.found += total
            report.new_rows += new
            self.on_status(f"  -> {new} new / {total} kept")

            if self.pause_seconds:
                time.sleep(self.pause_seconds)

        report.duration_seconds = time.time() - clock
        self.store.record_run(
            started_at=started.isoformat(),
            finished_at=datetime.now(timezone.utc).isoformat(),
            connector=self.connector.name,
            intent=queries[0].intent if queries else "",
            queries=[q.text for q in queries],
            found=report.found,
            new_rows=report.new_rows,
            errors=report.errors[:50],
        )
        return report

    def _needs_enrich(self, video: DiscoveredVideo) -> bool:
        """Skip the call only if search already gave us everything downstream
        needs — metrics for ROI, and resolution for the vertical gate.

        Leaving resolution out of this check is subtle and costly: the video
        skips enrichment, width/height stay None, and `require_vertical` then
        has nothing to test, so landscape videos sail through a filter that
        looks like it is on.
        """
        m = video.metrics
        if m.like_count is None or m.view_count is None or not video.published_at:
            return True
        return self.filters.require_vertical and (video.width is None or video.height is None)
