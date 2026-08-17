"""Corpus -> TwelveLabs screening.

Connects Discover to the existing screening pipeline (`screening.py`). Two uses:

  1. **Model validation.** Run harvested real-world cafe videos through
     screening and see whether the verdicts hold up. Harvested videos are
     messier than anything we would upload by hand, which is the point.
  2. **Launch corpus curation.** Screening tells us which harvested videos are
     genuinely good cafe content, so the launch catalog is curated rather than
     whatever the scraper happened to return.

Cost discipline matters here. TwelveLabs bills indexed minutes (600 free), so
this module never screens the whole corpus: it takes the top N by format score,
and `estimate_minutes()` prices a batch before it runs.

Rights: downloading media flips a record to `internal_eval`. Those files exist
for model testing and are deleted by `purge_media()` when a batch is done.
Screening never grants us the right to show anyone's video — that only comes
from a creator opting in.
"""

from __future__ import annotations

import sys
from pathlib import Path
from dataclasses import dataclass, field
from typing import Any, Callable, Optional

from .connectors.base import ConnectorError
from .connectors.ytdlp import YtDlpConnector
from .models import DiscoveredVideo, RIGHTS_INTERNAL_EVAL
from .roi import score_corpus
from .store import CorpusStore

# screening.py lives at the repo root (it predates this package).
_REPO_ROOT = Path(__file__).resolve().parents[2]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

try:
    from screening import BusinessProfile, ScreeningClient, TwelveLabsError
except ImportError as exc:  # pragma: no cover
    BusinessProfile = ScreeningClient = None  # type: ignore
    TwelveLabsError = RuntimeError  # type: ignore
    _IMPORT_ERROR: Optional[str] = str(exc)
else:
    _IMPORT_ERROR = None

DEFAULT_MEDIA_DIR = Path("data/media")

# TwelveLabs rejections that will never succeed on retry. A daily agent that
# does not record these will re-download and re-submit the same broken video
# every morning forever. Recording them as `unscreenable` takes them out of the
# candidate pool permanently.
PERMANENT_FAILURES = (
    "video_resolution_too_low",
    "video_resolution_too_high",
    "video_duration_too_short",
    "video_duration_too_long",
    "video_file_broken",
    "audio_file_broken",
    "unsupported_file_type",
)


def _permanent_reason(message: str) -> Optional[str]:
    lowered = message.lower()
    return next((code for code in PERMANENT_FAILURES if code in lowered), None)


@dataclass
class ScreenBatchReport:
    attempted: int = 0
    downloaded: int = 0
    screened: int = 0
    failed: int = 0
    verdicts: dict[str, int] = field(default_factory=dict)
    errors: list[str] = field(default_factory=list)
    minutes_indexed: float = 0.0

    def summary(self) -> str:
        breakdown = ", ".join(f"{k}: {v}" for k, v in sorted(self.verdicts.items())) or "none"
        return (f"screened {self.screened}/{self.attempted} "
                f"({self.failed} failed, ~{self.minutes_indexed:.1f} index-min) -> {breakdown}")


def estimate_minutes(videos: list[DiscoveredVideo]) -> float:
    """Indexed minutes a batch will cost. Unknown durations assumed 60s."""
    return sum((v.duration_seconds or 60.0) for v in videos) / 60.0


class ScreeningBridge:
    def __init__(
        self,
        store: CorpusStore,
        media_dir: Path | str = DEFAULT_MEDIA_DIR,
        index_name: str = "divvit-discover",
        connector: Optional[YtDlpConnector] = None,
        client: Optional[Any] = None,
        on_status: Callable[[str], None] = print,
    ):
        if _IMPORT_ERROR:
            raise RuntimeError(f"cannot import screening.py: {_IMPORT_ERROR}")
        self.store = store
        self.media_dir = Path(media_dir)
        # Separate index from `divvit-collection`: harvested third-party videos
        # must not be mixed into the index that serves real user submissions.
        self.index_name = index_name
        self.connector = connector or YtDlpConnector()
        # Built lazily: selecting and pricing a batch is useful without a
        # TwelveLabs key, and `--dry-run` should never demand one.
        self._client = client
        self.on_status = on_status

    @property
    def client(self):
        if self._client is None:
            self._client = ScreeningClient()
        return self._client

    # ----------------------------------------------------------- selection
    def select_batch(self, limit: int = 10, intent: Optional[str] = None,
                     business_id: Optional[str] = None,
                     platform: Optional[str] = None,
                     max_duration_seconds: float = 180.0) -> list[DiscoveredVideo]:
        """Pick the most promising unscreened videos.

        Ranked by format score so the indexing budget goes to videos that are
        actually representative of what performs, not the first N scraped.
        """
        candidates = self.store.query(intent=intent, business_id=business_id,
                                      platform=platform, unscreened_only=True)
        candidates = [
            v for v in candidates
            if (v.duration_seconds or 0) <= max_duration_seconds
            # Skip what TwelveLabs is known to reject, when we know it up front.
            # `None` means resolution is unknown — try it and find out.
            and v.meets_screening_resolution() is not False
        ]
        if not candidates:
            return []
        scores = score_corpus(candidates)
        candidates.sort(key=lambda v: scores[v.canonical_id].format_score or -1, reverse=True)
        return candidates[:limit]

    # ------------------------------------------------------------ screening
    def screen_one(self, video: DiscoveredVideo,
                   business: Optional[Any] = None) -> Optional[dict[str, Any]]:
        """Download, index, screen, persist. Returns the screening payload."""
        path = Path(video.local_path) if video.local_path else None
        if not path or not path.exists():
            self.on_status(f"  downloading {video.url}")
            path = self.connector.download(video, self.media_dir)
            if not path:
                raise ConnectorError(f"no media retrieved for {video.url}")
            # Media on disk = internal evaluation copy, nothing more.
            self.store.set_fields(video.canonical_id, local_path=str(path),
                                  rights_status=RIGHTS_INTERNAL_EVAL)

        self.on_status(f"  screening {path.name}")
        result = self.client.screen_submission(
            business=business, file_path=str(path),
            index_name=self.index_name,
            on_status=lambda m: self.on_status(f"    {m}"),
        )

        payload = {
            "verdict": result.verdict,
            "reasons": result.reasons,
            "analysis": result.analysis,
            "video_id": result.video_id,
            "index_id": result.index_id,
            "mode": "business" if business else "catalog",
        }
        self.store.set_fields(video.canonical_id, screening=payload)
        return payload

    def screen_batch(self, videos: list[DiscoveredVideo],
                     business: Optional[Any] = None,
                     minute_budget: Optional[float] = None) -> ScreenBatchReport:
        report = ScreenBatchReport()
        estimate = estimate_minutes(videos)
        if minute_budget is not None and estimate > minute_budget:
            raise ValueError(
                f"batch needs ~{estimate:.1f} indexed minutes, budget is {minute_budget}. "
                "Lower --limit or raise --minute-budget.")

        for video in videos:
            report.attempted += 1
            self.on_status(f"[screen] {video.title[:60] or video.url}")
            try:
                payload = self.screen_one(video, business=business)
            except (ConnectorError, TwelveLabsError, OSError) as exc:
                report.failed += 1
                report.errors.append(f"{video.url}: {exc}")
                self.on_status(f"  ! {exc}")
                reason = _permanent_reason(str(exc))
                if reason:
                    # Retiring it, not screening it — no analysis, no cost.
                    self.store.set_fields(video.canonical_id, screening={
                        "verdict": "unscreenable",
                        "reasons": [reason],
                        "analysis": {},
                        "mode": "business" if business else "catalog",
                    })
                    report.verdicts["unscreenable"] = report.verdicts.get("unscreenable", 0) + 1
                    self.on_status(f"  (retired: {reason})")
                continue

            report.screened += 1
            report.minutes_indexed += (video.duration_seconds or 60.0) / 60.0
            verdict = payload["verdict"]
            report.verdicts[verdict] = report.verdicts.get(verdict, 0) + 1
            self.on_status(f"  = {verdict}")

        return report

    # --------------------------------------------------------------- rights
    def purge_media(self, keep_licensed: bool = True) -> int:
        """Delete downloaded evaluation copies once screening is done.

        Internal eval copies are not ours to keep sitting around; this is the
        cleanup half of that commitment.
        """
        removed = 0
        for video in self.store.query():
            if not video.local_path:
                continue
            if keep_licensed and video.is_publicly_displayable():
                continue
            path = Path(video.local_path)
            if path.exists():
                path.unlink()
                removed += 1
            self.store.set_fields(video.canonical_id, local_path=None)
        return removed


def business_profile_from(name: str, city: str = "", cuisine: str = "",
                          menu_items: Optional[list[str]] = None) -> Any:
    """Build a screening.BusinessProfile without importing screening.py directly
    in callers (keeps the root-module dependency contained here)."""
    if _IMPORT_ERROR:
        raise RuntimeError(f"cannot import screening.py: {_IMPORT_ERROR}")
    return BusinessProfile(name=name, location=city, cuisine=cuisine,
                           menu_items=menu_items or [])
