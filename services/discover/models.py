"""Normalized data model for Divvit Discover.

Every connector — whatever platform it talks to — returns `DiscoveredVideo`.
Downstream (store, ROI, screening bridge, the Discover UI) only ever sees this
shape, so adding a platform never ripples past its connector.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from typing import Any, Optional

# ---------------------------------------------------------------- rights

# Rights state decides one thing: may Divvit render this video's *media* to
# anyone outside the company. Discovery gives us metadata and a link; it does
# not give us a license. Nothing leaves the building until a creator opts in
# through Legal Ownership.
RIGHTS_REFERENCE = "unlicensed_reference"  # link + metrics only, never embed the file
RIGHTS_INTERNAL_EVAL = "internal_eval"     # downloaded for model testing, delete after
RIGHTS_CREATOR_LICENSED = "creator_licensed"  # creator opted in via Divvit
RIGHTS_OWNED = "owned"                     # Divvit or the business owns it

PUBLICLY_DISPLAYABLE = {RIGHTS_CREATOR_LICENSED, RIGHTS_OWNED}

# Why we went looking for the video. Mirrors the three Discover jobs.
INTENT_BUSINESS = "business"    # content about a specific partner business
INTENT_TREND = "trend"          # trending cafe/restaurant UGC formats
INTENT_CATEGORY = "category"    # category + competitor landscape

HASHTAG_RE = re.compile(r"#(\w+)")


def _utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class SourceQuery:
    """One search we intend to run against one platform."""

    text: str
    intent: str = INTENT_TREND
    platform: str = "youtube"
    business_id: Optional[str] = None
    limit: int = 25
    # Free-form: city, cuisine, campaign id — carried onto every result so we
    # can slice the corpus later without re-deriving where a video came from.
    tags: dict[str, str] = field(default_factory=dict)

    def key(self) -> str:
        return f"{self.platform}:{self.intent}:{self.text}"


@dataclass
class Creator:
    handle: str = ""
    display_name: str = ""
    platform_id: str = ""
    url: str = ""
    follower_count: Optional[int] = None
    verified: bool = False


@dataclass
class VideoMetrics:
    view_count: Optional[int] = None
    like_count: Optional[int] = None
    comment_count: Optional[int] = None
    share_count: Optional[int] = None
    # Captured at fetch time — metrics age, and ROI math needs to know how old.
    collected_at: str = field(default_factory=_utcnow)

    def engagement_total(self) -> Optional[int]:
        """None when we have no engagement data at all.

        The distinction matters: flat search returns views but no likes, and
        treating that as *zero* engagement would rank an unmeasured video below
        a genuinely unpopular one.
        """
        parts = [v for v in (self.like_count, self.comment_count, self.share_count)
                 if v is not None]
        return sum(parts) if parts else None


@dataclass
class DiscoveredVideo:
    """A single video found in the wild, normalized across platforms."""

    platform: str
    platform_video_id: str
    url: str

    title: str = ""
    description: str = ""
    hashtags: list[str] = field(default_factory=list)
    duration_seconds: Optional[float] = None
    published_at: Optional[str] = None  # ISO-8601 UTC
    thumbnail_url: Optional[str] = None
    language: Optional[str] = None
    width: Optional[int] = None
    height: Optional[int] = None

    creator: Creator = field(default_factory=Creator)
    metrics: VideoMetrics = field(default_factory=VideoMetrics)

    # provenance
    connector: str = ""
    intent: str = INTENT_TREND
    business_id: Optional[str] = None
    source_query: str = ""
    query_tags: dict[str, str] = field(default_factory=dict)
    discovered_at: str = field(default_factory=_utcnow)

    # pipeline state
    rights_status: str = RIGHTS_REFERENCE
    local_path: Optional[str] = None          # set once media is pulled for eval
    screening: Optional[dict[str, Any]] = None  # verdict + analysis from screening.py
    roi: Optional[dict[str, Any]] = None        # scores from roi.py
    # Craft signals from style.py: on-screen text, audio treatment, cut rhythm,
    # shot order, tone. This is what teaches Create how the format is *made*.
    style: Optional[dict[str, Any]] = None
    # Five-way category from services/classify. Separate from screening's own
    # content_type: that vocabulary predates the taxonomy and a video can be
    # relabelled without paying to re-index it.
    classification: Optional[dict[str, Any]] = None

    # ------------------------------------------------------------- identity
    @property
    def canonical_id(self) -> str:
        """Dedupe key. The same clip found by three queries is one row."""
        return f"{self.platform}:{self.platform_video_id}"

    # --------------------------------------------------------------- rights
    def is_publicly_displayable(self) -> bool:
        """Gate for anything user-facing. Metadata and the link are always fine;
        the media file is not, until a creator says so."""
        return self.rights_status in PUBLICLY_DISPLAYABLE

    # ----------------------------------------------------------- derivation
    def derive_hashtags(self) -> list[str]:
        """Platforms are inconsistent about giving us tags; recover them from text."""
        found = {t.lower() for t in self.hashtags}
        for blob in (self.title, self.description):
            found.update(m.lower() for m in HASHTAG_RE.findall(blob or ""))
        self.hashtags = sorted(found)
        return self.hashtags

    def age_days(self, now: Optional[datetime] = None) -> Optional[float]:
        if not self.published_at:
            return None
        try:
            published = datetime.fromisoformat(self.published_at.replace("Z", "+00:00"))
        except ValueError:
            return None
        if published.tzinfo is None:
            published = published.replace(tzinfo=timezone.utc)
        delta = (now or datetime.now(timezone.utc)) - published
        return max(delta.total_seconds() / 86400.0, 0.0)

    def is_short_form(self) -> bool:
        """Short-form is the format Divvit actually cares about."""
        return self.duration_seconds is not None and self.duration_seconds <= 90

    def meets_screening_resolution(self, minimum: int = 360) -> Optional[bool]:
        """TwelveLabs rejects anything under 360x360. None when we don't know
        yet — only enrichment populates resolution."""
        if self.width is None or self.height is None:
            return None
        return min(self.width, self.height) >= minimum

    # ------------------------------------------------------------- (de)ser
    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["canonical_id"] = self.canonical_id
        return d

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), indent=2, ensure_ascii=False)

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "DiscoveredVideo":
        d = dict(d)
        d.pop("canonical_id", None)
        creator = d.pop("creator", None) or {}
        metrics = d.pop("metrics", None) or {}
        known = {f for f in cls.__dataclass_fields__}
        video = cls(**{k: v for k, v in d.items() if k in known})
        video.creator = Creator(**{k: v for k, v in creator.items()
                                   if k in Creator.__dataclass_fields__})
        video.metrics = VideoMetrics(**{k: v for k, v in metrics.items()
                                        if k in VideoMetrics.__dataclass_fields__})
        return video
