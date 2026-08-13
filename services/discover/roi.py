"""Format performance scoring and projected ROI.

The question a business asks Divvit is: *if I run a campaign, what do I get?*
Answering it honestly needs one idea — raw view counts do not transfer between
creators, but **audience leverage** does.

    audience_leverage = views / creator_followers

A video with 40k views from a 400k-follower account is a weak format riding a
big audience (leverage 0.1). A video with 40k views from a 2k-follower account
is a format that *travels* (leverage 20). Divvit's creators are the small
account. So we measure formats by leverage, then project onto the follower
count of the creators a business would actually get.

Every projection returns its `assumptions` block. These are modeled estimates
from a scraped sample, not measured outcomes, and the UI must say so.
"""

from __future__ import annotations

import statistics
from dataclasses import dataclass, field, asdict
from typing import Any, Optional

from .formats import UNCLASSIFIED, brief as format_brief, classify, label
from .models import DiscoveredVideo

# ---- default assumptions (all overridable) ----------------------------------

# Short-form influencer CPM. Public benchmarks put branded short-form at roughly
# $10-25 per 1k views; we sit at the low end so projections under-promise.
DEFAULT_CPM_USD = 12.0

# Follower count of a typical Divvit creator — an ordinary customer, not an
# influencer. Replace with the real median from `profiles` once we have users.
DEFAULT_CREATOR_FOLLOWERS = 800

# Leverage at or above this counts as a breakout for the format.
BREAKOUT_LEVERAGE = 3.0

# Leverage is views/followers, so a channel with 13 subscribers and 12k views
# scores ~900x — arithmetically true, meaningless as a signal, and enough to
# drag a format's median on its own. Below this follower count we record no
# leverage rather than a fake one.
MIN_FOLLOWERS_FOR_LEVERAGE = 100

# Weights for the composite format score. Leverage dominates because it is the
# only component that isolates format quality from creator reach.
WEIGHTS = {"leverage": 0.45, "engagement": 0.35, "velocity": 0.20}


@dataclass
class VideoScores:
    engagement_rate: Optional[float] = None    # (likes+comments+shares)/views
    view_velocity: Optional[float] = None      # views per day since posting
    audience_leverage: Optional[float] = None  # views / creator followers
    format_score: Optional[float] = None       # 0-100, percentile composite
    archetype: str = UNCLASSIFIED

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def score_video(video: DiscoveredVideo) -> VideoScores:
    """Raw per-video signals. Percentile-based `format_score` is filled in by
    `score_corpus()`, which needs the whole cohort to rank against."""
    scores = VideoScores(archetype=classify(video))
    views = video.metrics.view_count

    if views:
        engagement = video.metrics.engagement_total()
        if engagement is not None:
            scores.engagement_rate = engagement / views
        age = video.age_days()
        if age is not None:
            scores.view_velocity = views / max(age, 1.0)
        followers = video.creator.follower_count
        if followers and followers >= MIN_FOLLOWERS_FOR_LEVERAGE:
            scores.audience_leverage = views / followers

    return scores


def _percentile_ranks(values: list[Optional[float]]) -> list[Optional[float]]:
    """Rank each value in [0,1] against the non-null values. Ties share a rank."""
    present = sorted(v for v in values if v is not None)
    if not present:
        return [None] * len(values)
    n = len(present)
    if n == 1:
        return [None if v is None else 0.5 for v in values]

    def rank(v: float) -> float:
        lo, hi = 0, n
        while lo < hi:  # count of entries strictly below v
            mid = (lo + hi) // 2
            if present[mid] < v:
                lo = mid + 1
            else:
                hi = mid
        below = lo
        while hi < n and present[hi] == v:
            hi += 1
        return (below + (hi - 1)) / 2 / (n - 1)

    return [None if v is None else rank(v) for v in values]


def score_corpus(videos: list[DiscoveredVideo]) -> dict[str, VideoScores]:
    """Score every video against the rest of the corpus.

    Percentile ranking, not absolute thresholds: a 4% engagement rate means
    nothing in isolation but everything relative to the other cafe videos we
    pulled the same week.
    """
    scored = {v.canonical_id: score_video(v) for v in videos}
    order = [v.canonical_id for v in videos]

    ranks = {
        "leverage": _percentile_ranks([scored[k].audience_leverage for k in order]),
        "engagement": _percentile_ranks([scored[k].engagement_rate for k in order]),
        "velocity": _percentile_ranks([scored[k].view_velocity for k in order]),
    }

    for i, key in enumerate(order):
        weighted, total_weight = 0.0, 0.0
        for component, weight in WEIGHTS.items():
            value = ranks[component][i]
            if value is not None:
                weighted += value * weight
                total_weight += weight
        # Renormalize over whatever components we actually had. A video missing
        # follower count is still comparable, just on thinner evidence.
        scored[key].format_score = round(100 * weighted / total_weight, 1) if total_weight else None

    return scored


@dataclass
class FormatStats:
    archetype: str
    label: str
    sample_size: int
    median_views: Optional[float] = None
    p90_views: Optional[float] = None
    median_engagement_rate: Optional[float] = None
    median_leverage: Optional[float] = None
    mean_format_score: Optional[float] = None
    breakout_rate: Optional[float] = None   # share with leverage >= BREAKOUT_LEVERAGE
    confidence: str = "low"
    example_urls: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _median(values: list[Optional[float]]) -> Optional[float]:
    clean = [v for v in values if v is not None]
    return statistics.median(clean) if clean else None


def _p90(values: list[Optional[float]]) -> Optional[float]:
    clean = sorted(v for v in values if v is not None)
    if not clean:
        return None
    return float(clean[min(int(0.9 * (len(clean) - 1) + 0.5), len(clean) - 1)])


def _confidence(n: int) -> str:
    return "high" if n >= 30 else "medium" if n >= 10 else "low"


def format_stats(videos: list[DiscoveredVideo],
                 scores: Optional[dict[str, VideoScores]] = None) -> list[FormatStats]:
    """Per-archetype performance across the corpus, best formats first."""
    scores = scores or score_corpus(videos)

    grouped: dict[str, list[DiscoveredVideo]] = {}
    for video in videos:
        grouped.setdefault(scores[video.canonical_id].archetype, []).append(video)

    out = []
    for archetype, group in grouped.items():
        group_scores = [scores[v.canonical_id] for v in group]
        leverages = [s.audience_leverage for s in group_scores]
        have_leverage = [v for v in leverages if v is not None]

        top = sorted(group, key=lambda v: scores[v.canonical_id].format_score or -1,
                     reverse=True)[:3]

        out.append(FormatStats(
            archetype=archetype,
            label=label(archetype),
            sample_size=len(group),
            median_views=_median([float(v.metrics.view_count) if v.metrics.view_count
                                  else None for v in group]),
            p90_views=_p90([float(v.metrics.view_count) if v.metrics.view_count
                            else None for v in group]),
            median_engagement_rate=_median([s.engagement_rate for s in group_scores]),
            median_leverage=_median(leverages),
            mean_format_score=(round(statistics.mean(
                [s.format_score for s in group_scores if s.format_score is not None]), 1)
                if any(s.format_score is not None for s in group_scores) else None),
            breakout_rate=(round(sum(1 for v in have_leverage if v >= BREAKOUT_LEVERAGE)
                                 / len(have_leverage), 3) if have_leverage else None),
            confidence=_confidence(len(group)),
            example_urls=[v.url for v in top],
        ))

    return sorted(out, key=lambda s: s.mean_format_score or -1, reverse=True)


@dataclass
class RoiProjection:
    archetype: str
    label: str
    videos_planned: int
    projected_views_per_video: Optional[int]
    projected_impressions: Optional[int]
    projected_emv_usd: Optional[float]      # earned media value at the stated CPM
    campaign_cost_usd: float
    roi_multiple: Optional[float]           # EMV / cost
    cost_per_1k_impressions_usd: Optional[float]
    confidence: str
    brief: Optional[str]
    assumptions: dict[str, Any]

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def project_roi(
    stats: FormatStats,
    videos_planned: int = 10,
    reward_cost_usd: float = 15.0,
    creator_followers: int = DEFAULT_CREATOR_FOLLOWERS,
    cpm_usd: float = DEFAULT_CPM_USD,
) -> RoiProjection:
    """Project a campaign in one format onto Divvit-sized creators.

    Views are projected from the format's median *leverage*, not its median
    views — see the module docstring. Where leverage is unavailable (no
    follower data in the sample) we fall back to median views and say so in
    `assumptions.basis`, because that fallback is materially weaker.
    """
    basis = "leverage"
    if stats.median_leverage is not None:
        per_video = stats.median_leverage * creator_followers
    elif stats.median_views is not None:
        basis = "median_views_fallback"
        per_video = stats.median_views
    else:
        basis = "insufficient_data"
        per_video = None

    cost = round(videos_planned * reward_cost_usd, 2)
    impressions = int(per_video * videos_planned) if per_video else None
    emv = round(impressions / 1000 * cpm_usd, 2) if impressions else None

    return RoiProjection(
        archetype=stats.archetype,
        label=stats.label,
        videos_planned=videos_planned,
        projected_views_per_video=int(per_video) if per_video else None,
        projected_impressions=impressions,
        projected_emv_usd=emv,
        campaign_cost_usd=cost,
        roi_multiple=round(emv / cost, 2) if emv and cost else None,
        cost_per_1k_impressions_usd=(round(cost / (impressions / 1000), 2)
                                     if impressions else None),
        confidence=stats.confidence if basis == "leverage" else "low",
        brief=format_brief(stats.archetype),
        assumptions={
            "basis": basis,
            "creator_followers": creator_followers,
            "cpm_usd": cpm_usd,
            "reward_cost_usd": reward_cost_usd,
            "sample_size": stats.sample_size,
            "median_leverage": stats.median_leverage,
            "note": "Modeled from scraped public metrics, not measured campaign "
                    "outcomes. Treat as a planning estimate.",
        },
    )


def rank_formats(videos: list[DiscoveredVideo], **projection_kwargs
                 ) -> list[tuple[FormatStats, RoiProjection]]:
    """Full Discover ROI table: every format, scored and projected."""
    scores = score_corpus(videos)
    return [(s, project_roi(s, **projection_kwargs))
            for s in format_stats(videos, scores)]
