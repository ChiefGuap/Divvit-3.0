"""Brand Health — a 0-100 word-of-mouth score per roster cafe.

The design doc (docs/brand-health-design.md) defines the full five-pillar
model; this is its scrape-only P0/P1 slice, built from what we can measure
today with zero paid APIs:

  component            raw metric                                    weight
  social_volume        relevant YouTube videos found about the cafe   0.30
  engagement_quality   median (likes+comments)/views over its videos  0.25
  recency              decay-weighted age of the freshest video       0.20
  review_signal        yelp rating x log10(1 + review count)          0.25

Every raw value is converted to a **percentile within the roster cohort**
(reusing Discover's `percentile_ranks`, and its discipline): an absolute
number means nothing, "better than 80% of independent OC cafes" means
something a prospect will act on.

Missing-vs-zero, exactly as roi.py does it:

  * A cafe whose metrics pass never ran, or whose every source failed, gets
    **no score** — None, absent from the ranking.
  * A cafe we successfully searched and found nothing about gets
    `social_volume = 0` — a real, bad, measured number.
  * A cafe with videos but no Yelp gets scored on the components present,
    with the weights **renormalized** and the confidence lowered.

Every score ships with a components breakdown and an assumptions block so the
dashboard can show *why* — a bare number gets ignored or disputed.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from typing import Any, Optional

from services.discover.roi import percentile_ranks

from .roster import CafeRecord

# Weights sum to 1. Social volume leads because breadth of unprompted mention
# is the product thesis; reviews are next because they are the signal
# customers actually check (design doc §4).
WEIGHTS = {
    "social_volume": 0.30,
    "engagement_quality": 0.25,
    "recency": 0.20,
    "review_signal": 0.25,
}

# Short-form dies fast (design doc §5.3 uses 30d for video content); the
# roster measures a cafe's whole public YouTube trail, most of which is
# longer-lived vlogs and reviews, so the half-life sits between the doc's
# video (30d) and review (180d) figures.
RECENCY_HALF_LIFE_DAYS = 90.0

# High confidence means essentially every component was measurable. Losing
# the review signal (0.25) alone drops a cafe to medium — deliberately, since
# reviews are the signal customers check and a score without them is thinner
# than the number makes it look.
CONFIDENCE_HIGH_COVERAGE = 0.90
CONFIDENCE_MEDIUM_COVERAGE = 0.50


@dataclass
class BrandHealth:
    cafe_id: str
    name: str
    city: str
    score: Optional[float]          # 0-100, None when nothing was measurable
    confidence: str                 # low | medium | high | none
    components: dict[str, dict[str, Any]] = field(default_factory=dict)
    assumptions: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _median(values: list[float]) -> Optional[float]:
    if not values:
        return None
    ordered = sorted(values)
    mid = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[mid]
    return (ordered[mid - 1] + ordered[mid]) / 2


def _age_days(iso: str, now: datetime) -> Optional[float]:
    try:
        published = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    if published.tzinfo is None:
        published = published.replace(tzinfo=timezone.utc)
    return max((now - published).total_seconds() / 86400.0, 0.0)


# ------------------------------------------------------------ raw components

def raw_components(signals: Optional[dict[str, Any]],
                   now: Optional[datetime] = None) -> Optional[dict[str, Optional[float]]]:
    """Signals row -> raw component values. None per component = unmeasured.
    Returns None outright when there was no measurement attempt at all."""
    if not signals:
        return None
    youtube = signals.get("youtube")
    # Google Places is preferred over Yelp: first-party ratings, a stable
    # place_id, and an address to confirm we matched the right business.
    # Yelp remains a fallback for rows measured before Places was wired in.
    reviews = signals.get("google") or signals.get("yelp")
    if youtube is None and reviews is None:
        return None  # attempted but every source failed — no evidence, no score
    now = now or _now()

    social_volume: Optional[float] = None
    engagement: Optional[float] = None
    recency: Optional[float] = None
    if youtube is not None:
        videos = youtube.get("videos") or []
        # A successful search that found nothing is a measured zero.
        social_volume = float(youtube.get("video_count") or len(videos))

        rates = []
        for v in videos:
            views = v.get("views")
            parts = [x for x in (v.get("likes"), v.get("comments"))
                     if x is not None]
            if views and parts:  # engagement absent != engagement zero
                rates.append(sum(parts) / views)
        engagement = _median(rates)

        ages = [a for a in (_age_days(v.get("published_at") or "", now)
                            for v in videos) if a is not None]
        if ages:
            # Freshest video sets recency: one post last week is livelier
            # word of mouth than ten from 2019.
            recency = 0.5 ** (min(ages) / RECENCY_HALF_LIFE_DAYS)

    review_signal: Optional[float] = None
    if reviews is not None and reviews.get("rating") is not None:
        count = reviews.get("review_count") or 0
        # Rating alone is weak — a 4.9 from 11 reviews is not a 4.9 from
        # 1,100 (design doc §4.4). log10 keeps volume from swamping quality.
        review_signal = reviews["rating"] * math.log10(1 + count)

    return {"social_volume": social_volume, "engagement_quality": engagement,
            "recency": recency, "review_signal": review_signal}


# ------------------------------------------------------------------- scoring

def _confidence(coverage: float) -> str:
    if coverage >= CONFIDENCE_HIGH_COVERAGE:
        return "high"
    if coverage >= CONFIDENCE_MEDIUM_COVERAGE:
        return "medium"
    return "low"


def score_roster(cafes: list[CafeRecord],
                 signals_by_cafe: dict[str, dict[str, Any]],
                 now: Optional[datetime] = None) -> list[BrandHealth]:
    """Score every measurable cafe against the cohort. Returns one BrandHealth
    per *measured* cafe — unmeasured cafes are simply not in the list, which
    is the honest version of "no score"."""
    now = now or _now()

    measured: list[tuple[CafeRecord, dict[str, Optional[float]]]] = []
    for cafe in cafes:
        raw = raw_components(signals_by_cafe.get(cafe.cafe_id), now=now)
        if raw is not None:
            measured.append((cafe, raw))
    if not measured:
        return []

    cohort_size = len(measured)
    ranks = {
        component: percentile_ranks([raw[component] for _, raw in measured])
        for component in WEIGHTS
    }

    out: list[BrandHealth] = []
    for i, (cafe, raw) in enumerate(measured):
        weighted = total_weight = 0.0
        components: dict[str, dict[str, Any]] = {}
        for component, weight in WEIGHTS.items():
            rank = ranks[component][i]
            entry: dict[str, Any] = {"raw": raw[component], "weight": weight}
            if rank is not None:
                entry["percentile"] = round(100 * rank, 1)
                weighted += rank * weight
                total_weight += weight
            else:
                entry["status"] = "absent"
            components[component] = entry

        # Renormalize over the components actually present — thinner evidence,
        # same scale, lower stated confidence. roi.py's pattern exactly.
        score = round(100 * weighted / total_weight, 1) if total_weight else None
        coverage = round(total_weight / sum(WEIGHTS.values()), 3)
        out.append(BrandHealth(
            cafe_id=cafe.cafe_id,
            name=cafe.name,
            city=cafe.city,
            score=score,
            confidence=_confidence(coverage) if score is not None else "none",
            components=components,
            assumptions={
                "weights": WEIGHTS,
                "coverage": coverage,
                "cohort_size": cohort_size,
                "cohort": "independent cafes measured in this county roster",
                "recency_half_life_days": RECENCY_HALF_LIFE_DAYS,
                "sources": {
                    "youtube": "yt-dlp public search, metadata only",
                    "reviews": "Google Places (New) v1 — rating and review "
                               "count, identity-checked against the OSM "
                               "record; Yelp fallback for older rows",
                    "instagram": "skipped — no unauthenticated access",
                    "tiktok": "skipped — keyword search broken without a key",
                },
                "note": "Percentile-normalized within the measured cohort, "
                        "from scraped public metrics. A relative ranking, "
                        "not an absolute grade.",
            },
        ))

    return sorted(out, key=lambda h: (h.score is not None, h.score),
                  reverse=True)
