"""Label the whole corpus, not just the indexed slice.

Until the direct-analyze path existed, a video could only be labelled if it had
been indexed by screening — 3 of 465 in the live corpus. Everything else was
unreachable at any price. This module closes that gap:

    download (yt-dlp) -> classify from the file -> delete the file

No indexing, no index minutes, and no copy of someone else's video left on disk
or in our TwelveLabs account. The media exists for the seconds it takes to
classify it, which is what `internal_eval` rights are for.

Three disciplines carried over from the screening bridge, because they are what
make an unattended run safe rather than merely automatic:

  * **Budgeted.** `limit` caps videos per run; the batch is trimmed, not refused.
  * **Retires permanent failures.** A file TwelveLabs will never accept (broken,
    under 4s, over the size ceiling) is recorded so tomorrow's run skips it
    instead of re-downloading it forever.
  * **Idempotent.** Labelled videos are never re-labelled without `--relabel`.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Optional

from .classifier import (
    Classification, ClassifierError, MAX_DIRECT_FILE_BYTES,
    MIN_DURATION_SECONDS, PegasusClassifier,
)
from ..discover.connectors.base import ConnectorError
from ..discover.connectors.ytdlp import YtDlpConnector
from ..discover.models import DiscoveredVideo, RIGHTS_INTERNAL_EVAL

DEFAULT_MEDIA_DIR = Path("data/media")

# Failures that will never succeed on retry, so the video is retired rather
# than left in the candidate pool. Mirrors the screening bridge's list; the
# vocabulary is TwelveLabs', not ours.
PERMANENT_FAILURES = (
    "video_file_broken",
    "audio_file_broken",
    "unsupported_file_type",
    "video_duration_too_short",
    "video_duration_too_long",
    "video_resolution_too_low",
    "video_resolution_too_high",
)


def _permanent_reason(message: str) -> Optional[str]:
    lowered = message.lower()
    return next((code for code in PERMANENT_FAILURES if code in lowered), None)


@dataclass
class MediaLabelReport:
    attempted: int = 0
    downloaded: int = 0
    labelled: int = 0
    retired: int = 0
    failed: int = 0
    bytes_fetched: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    by_category: dict[str, int] = field(default_factory=dict)
    errors: list[str] = field(default_factory=list)

    @property
    def tokens_per_video(self) -> float:
        return self.input_tokens / self.labelled if self.labelled else 0.0

    def summary(self) -> str:
        spread = ", ".join(f"{k}: {v}" for k, v in sorted(self.by_category.items()))
        return (f"labelled {self.labelled}/{self.attempted} "
                f"({self.retired} retired, {self.failed} failed) -> "
                f"{spread or 'none'}\n"
                f"           {self.input_tokens:,} input tokens "
                f"(~{self.tokens_per_video:,.0f}/video), "
                f"{self.bytes_fetched / 1e6:.0f}MB fetched, 0 index-minutes")


class MediaLabeller:
    def __init__(self, store: Any, teacher: Optional[PegasusClassifier] = None,
                 connector: Optional[YtDlpConnector] = None,
                 media_dir: Path | str = DEFAULT_MEDIA_DIR,
                 keep_media: bool = False,
                 on_status: Callable[[str], None] = print):
        self.store = store
        self.teacher = teacher or PegasusClassifier()
        self.connector = connector or YtDlpConnector()
        self.media_dir = Path(media_dir)
        # Deleting immediately is the default because these are evaluation
        # copies of other people's video. --keep-media exists for debugging a
        # bad label, not for building a library.
        self.keep_media = keep_media
        self.on_status = on_status
        self.last_fetched = 0

    # ----------------------------------------------------------- selection
    def candidates(self, limit: int = 25, relabel: bool = False,
                   platform: Optional[str] = None) -> list[DiscoveredVideo]:
        """Videos worth spending a call on, longest-shot ones excluded.

        Ordered by view count so that if a run is cut short, what got labelled
        is the part of the corpus that actually matters.
        """
        out = []
        for video in self.store.query(platform=platform, order_by_views=True):
            if video.classification and not relabel:
                continue
            duration = video.duration_seconds
            if duration is not None and duration < MIN_DURATION_SECONDS:
                continue
            out.append(video)
            if len(out) >= limit:
                break
        return out

    # ------------------------------------------------------------ labelling
    def label_one(self, video: DiscoveredVideo) -> tuple[Classification, int]:
        """Download if needed, classify, delete. Returns (label, bytes fetched).

        `last_fetched` is set before the classify call, so bandwidth spent on a
        video whose classification then failed is still reported. A cost report
        that only counts successes understates what a run actually used.
        """
        fetched = 0
        self.last_fetched = 0
        path = Path(video.local_path) if video.local_path else None

        if not path or not path.exists():
            self.on_status(f"  fetching {video.url}")
            path = self.connector.download(video, self.media_dir)
            if not path:
                raise ConnectorError(f"no media retrieved for {video.url}")
            fetched = self.last_fetched = path.stat().st_size
            # Media on disk is an evaluation copy and nothing more.
            self.store.set_fields(video.canonical_id, local_path=str(path),
                                  rights_status=RIGHTS_INTERNAL_EVAL)

        try:
            result = self.teacher.classify_file(path)
        finally:
            if not self.keep_media:
                self._discard(video, path)

        return result, fetched

    def _discard(self, video: DiscoveredVideo, path: Path) -> None:
        """Delete the evaluation copy. Runs even when classification failed —
        a failed label is not a reason to keep someone's video on disk."""
        try:
            if path.exists():
                path.unlink()
        except OSError:
            pass
        self.store.set_fields(video.canonical_id, local_path=None)

    def run(self, limit: int = 25, relabel: bool = False,
            platform: Optional[str] = None) -> MediaLabelReport:
        report = MediaLabelReport()
        batch = self.candidates(limit=limit, relabel=relabel, platform=platform)

        ok, why = self.teacher.available()
        if not ok:
            report.errors.append(f"teacher unavailable: {why}")
            self.on_status(f"[media] cannot run — {why}")
            return report

        for video in batch:
            report.attempted += 1
            self.on_status(f"[media] {(video.title or video.url)[:60]}")
            try:
                result, fetched = self.label_one(video)
            except (ClassifierError, ConnectorError, OSError) as exc:
                if self.last_fetched:
                    report.downloaded += 1
                    report.bytes_fetched += self.last_fetched
                reason = _permanent_reason(str(exc))
                if reason:
                    report.retired += 1
                    self.store.set_fields(video.canonical_id, classification={
                        "category": "unclassifiable", "confidence": "high",
                        "evidence": reason, "source": "retired",
                    })
                    self.on_status(f"  (retired: {reason})")
                else:
                    report.failed += 1
                    report.errors.append(f"{video.url}: {exc}")
                    self.on_status(f"  ! {exc}")
                continue

            if fetched:
                report.downloaded += 1
                report.bytes_fetched += fetched
            usage = self.teacher.last_usage or {}
            report.input_tokens += usage.get("input_tokens", 0)
            report.output_tokens += usage.get("output_tokens", 0)

            self.store.set_fields(video.canonical_id,
                                  classification=result.to_dict())
            report.labelled += 1
            report.by_category[result.category] = \
                report.by_category.get(result.category, 0) + 1
            flag = "  (ambiguous)" if result.is_ambiguous else ""
            self.on_status(f"  = {result.category} ({result.confidence}){flag}")

        return report
