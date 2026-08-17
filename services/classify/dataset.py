"""Corpus -> labelled training set.

The point of this module: there is no public dataset for Divvit's five
categories, so we build one. Pegasus labels the harvested corpus, those labels
are written back, and this exports them in a shape a VideoMAE fine-tune can
consume directly.

Two honesty rules, because a training set built from model output can quietly
teach a student the teacher's mistakes:

  1. Only confident labels are exported by default. A `low` confidence label
     with a close runner-up is exactly the sort of example that would poison a
     small model.
  2. `readiness()` reports per-category counts against the minimum a fine-tune
     needs, so nobody trains on 12 examples of one class and 300 of another and
     wonders why it collapsed.
"""

from __future__ import annotations

import json
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Iterable, Optional

from .classifier import (
    Classification, ClassifierError, PegasusClassifier, classify_from_screening,
)
from .taxonomy import CATEGORIES, TAXONOMY

MIN_PER_CATEGORY = 200


@dataclass
class LabelReport:
    attempted: int = 0
    labelled: int = 0
    from_screening: int = 0
    from_api: int = 0
    failed: int = 0
    by_category: dict[str, int] = field(default_factory=dict)
    errors: list[str] = field(default_factory=list)

    def summary(self) -> str:
        spread = ", ".join(f"{k}: {v}" for k, v in sorted(self.by_category.items()))
        return (f"labelled {self.labelled}/{self.attempted} "
                f"({self.from_screening} free, {self.from_api} via API, "
                f"{self.failed} failed) -> {spread or 'none'}")


def label_corpus(store: Any, *, limit: int = 50, teacher: Optional[PegasusClassifier] = None,
                 relabel: bool = False,
                 on_status: Callable[[str], None] = print) -> LabelReport:
    """Classify corpus videos into the five categories and persist the result.

    Free relabelling runs first across everything, then the API is spent only
    on what the free pass could not resolve — so a run costs the minimum number
    of calls that still moves the dataset forward.
    """
    report = LabelReport()
    videos = store.query()
    pending = [v for v in videos if relabel or not (v.classification if hasattr(v, "classification") else None)]

    # Pass 1 — free. Relabel anything already screened.
    needs_api = []
    for video in pending:
        existing = _stored(video)
        if existing and not relabel:
            continue
        free = classify_from_screening(getattr(video, "screening", None))
        if free:
            _persist(store, video, free)
            report.labelled += 1
            report.from_screening += 1
            report.by_category[free.category] = report.by_category.get(free.category, 0) + 1
        else:
            needs_api.append(video)

    if report.from_screening:
        on_status(f"[label] {report.from_screening} relabelled from existing screening (free)")

    # Pass 2 — paid. Only indexed videos can be classified by the teacher.
    indexed = [v for v in needs_api
               if (getattr(v, "screening", None) or {}).get("video_id")][:limit]
    report.attempted = report.from_screening + len(indexed)

    if indexed and teacher:
        ok, why = teacher.available()
        if not ok:
            report.errors.append(f"teacher unavailable: {why}")
            on_status(f"[label] skipping API pass — {why}")
        else:
            for video in indexed:
                title = (getattr(video, "title", "") or "")[:56]
                try:
                    result = teacher.classify(video)
                except ClassifierError as exc:
                    report.failed += 1
                    report.errors.append(f"{title}: {exc}")
                    on_status(f"[label] {title}\n    ! {exc}")
                    continue
                if result is None:
                    continue
                _persist(store, video, result)
                report.labelled += 1
                report.from_api += 1
                report.by_category[result.category] = report.by_category.get(result.category, 0) + 1
                flag = "  (ambiguous)" if result.is_ambiguous else ""
                on_status(f"[label] {title}\n    = {result.category} "
                          f"({result.confidence}){flag}")
    elif indexed:
        report.errors.append("no teacher configured")

    return report


def _stored(video: Any) -> Optional[Classification]:
    raw = getattr(video, "classification", None)
    return Classification.from_dict(raw) if raw else None


def _persist(store: Any, video: Any, result: Classification) -> None:
    store.set_fields(video.canonical_id, classification=result.to_dict())


# ------------------------------------------------------------------ export

def export_training_set(store: Any, out_path: Path | str, *,
                        confident_only: bool = True,
                        include_unindexed: bool = False,
                        verified_only: bool = False) -> dict[str, Any]:
    """Write JSONL ready for a VideoMAE fine-tune.

    One row per video. `media` is the platform URL rather than a local path —
    harvested footage is rights-gated and evaluation copies are deleted after
    screening, so the training pipeline re-fetches under its own terms rather
    than us shipping a folder of other people's video.
    """
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    rows: list[dict[str, Any]] = []
    skipped_low = skipped_unverified = 0
    for video in store.query():
        result = _stored(video)
        if not result or result.category not in CATEGORIES:
            continue
        if confident_only and not result.is_confident:
            skipped_low += 1
            continue
        if verified_only and not result.verified:
            skipped_unverified += 1
            continue
        tl_id = (getattr(video, "screening", None) or {}).get("video_id")
        if not tl_id and not include_unindexed:
            continue
        rows.append({
            "id": video.canonical_id,
            "label": result.category,
            "label_index": CATEGORIES.index(result.category),
            "confidence": result.confidence,
            "runner_up": result.runner_up,
            "teacher": result.source,
            "verified": result.verified,
            "verified_by": result.verified_by,
            "media_url": video.url,
            "platform": video.platform,
            "duration_seconds": video.duration_seconds,
            "width": video.width,
            "height": video.height,
            "twelvelabs_video_id": tl_id,
            "title": video.title,
        })

    with out_path.open("w") as fh:
        for row in rows:
            fh.write(json.dumps(row, ensure_ascii=False) + "\n")

    counts = Counter(r["label"] for r in rows)
    return {
        "path": str(out_path),
        "rows": len(rows),
        "skipped_low_confidence": skipped_low,
        "skipped_unverified": skipped_unverified,
        "by_category": dict(counts),
    }


def readiness(store: Any, minimum: int = MIN_PER_CATEGORY,
              include_unindexed: bool = False) -> dict[str, Any]:
    """Is there enough labelled data to fine-tune yet, and where is the gap?

    Reports per category rather than in total, because a class-imbalanced set
    trains a model that simply predicts the majority class.

    Counts exactly what `export_training_set` would emit under the same flags.
    Counting more than that would let readiness report "ready" for a set the
    export then drops rows from — the one thing this function exists to prevent.
    """
    counts: Counter[str] = Counter()
    for video in store.query():
        result = _stored(video)
        if not (result and result.is_confident and result.category in CATEGORIES):
            continue
        if not include_unindexed and not (
                getattr(video, "screening", None) or {}).get("video_id"):
            continue
        counts[result.category] += 1

    per_category = {
        key: {
            "label": TAXONOMY[key].label,
            "have": counts.get(key, 0),
            "need": max(0, minimum - counts.get(key, 0)),
            "ready": counts.get(key, 0) >= minimum,
        }
        for key in CATEGORIES
    }
    total = sum(counts.values())
    return {
        "total_confident": total,
        "minimum_per_category": minimum,
        "ready_to_train": all(v["ready"] for v in per_category.values()),
        "categories": per_category,
        "bottleneck": min(per_category.items(), key=lambda kv: kv[1]["have"])[0] if per_category else None,
    }
