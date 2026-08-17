"""Is a label actually right?

A model's own confidence does not answer this. A model that is confidently
wrong reports `"high"` exactly as loudly as one that is right, and a training
set built from unverified teacher output teaches the student the teacher's
mistakes with total conviction. So verification has to come from outside the
model. Two sources, in descending order of how much they are worth:

  **gold** — a human looked at the video and said what it is. This is the only
  thing that measures *accuracy*. Everything else measures consistency.

  **agreement** — a second, different model reached the same answer from the
  same video by a different route (Pegasus 1.2 vs 1.5). Cheap and automatic,
  but weaker: two models trained on overlapping data fail together on the same
  hard cases, so agreement can be high while accuracy is not. It is evidence a
  label is *stable*, not proof it is correct.

The honest use is both: gold on a sample to measure the error rate, agreement
on the bulk to catch the unstable ones. `score_against_gold` reports the first,
and it is the number that decides whether the corpus is safe to train on.
"""

from __future__ import annotations

import json
import random
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Optional

from .classifier import (
    Classification, ClassifierError, PegasusClassifier,
)
from .taxonomy import CATEGORIES, TAXONOMY

DEFAULT_GOLD_PATH = Path("data/classify_gold.json")

# A second opinion from a genuinely different model. Same-model re-runs at
# temperature 0 agree with themselves by construction and verify nothing.
SECOND_OPINION_MODEL = "pegasus1.2"


# -------------------------------------------------------------------- gold

def load_gold(path: Path | str = DEFAULT_GOLD_PATH) -> dict[str, str]:
    """Human-confirmed labels, keyed by canonical_id."""
    path = Path(path)
    if not path.exists():
        return {}
    raw = json.loads(path.read_text())
    labels = raw.get("labels", raw)
    return {k: v for k, v in labels.items() if v in CATEGORIES}


def save_gold(labels: dict[str, str], path: Path | str = DEFAULT_GOLD_PATH,
              note: str = "") -> Path:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(
        {"note": note or "human-confirmed labels; the only measure of accuracy",
         "categories": list(CATEGORIES),
         "labels": labels}, indent=2, sort_keys=True))
    return path


def sample_for_review(store: Any, size: int = 40,
                     seed: Optional[int] = 0) -> list[dict[str, Any]]:
    """Pick videos for a human to label, spread across the categories.

    Stratified rather than random: a corpus that is 60% one category would
    otherwise produce a gold set that says almost nothing about the other four,
    and the rare categories are exactly where the teacher is weakest.
    """
    by_category: dict[str, list[Any]] = defaultdict(list)
    for video in store.query():
        result = _stored(video)
        if result and result.category in CATEGORIES:
            by_category[result.category].append(video)

    rng = random.Random(seed)
    for videos in by_category.values():
        rng.shuffle(videos)

    per = max(1, size // max(1, len(by_category)))
    picked: list[Any] = []
    for category in CATEGORIES:
        picked.extend(by_category.get(category, [])[:per])

    # Backfill from whatever is left so a thin category doesn't shrink the set.
    if len(picked) < size:
        chosen = {v.canonical_id for v in picked}
        rest = [v for vs in by_category.values() for v in vs
                if v.canonical_id not in chosen]
        rng.shuffle(rest)
        picked.extend(rest[:size - len(picked)])

    rows = []
    for video in picked[:size]:
        result = _stored(video)
        rows.append({
            "canonical_id": video.canonical_id,
            "url": video.url,
            "title": video.title,
            "predicted": result.category if result else None,
            "confidence": result.confidence if result else None,
            "evidence": result.evidence if result else "",
            "gold": None,          # <- a human fills this in
        })
    return rows


# --------------------------------------------------------------- accuracy

@dataclass
class GoldReport:
    checked: int = 0
    correct: int = 0
    unlabelled: int = 0          # in gold, but the corpus has no prediction
    confusion: dict[str, dict[str, int]] = field(default_factory=dict)
    per_category: dict[str, dict[str, Any]] = field(default_factory=dict)
    mistakes: list[dict[str, str]] = field(default_factory=list)

    @property
    def accuracy(self) -> Optional[float]:
        return self.correct / self.checked if self.checked else None

    def summary(self) -> str:
        if not self.checked:
            return "no gold labels to check against"
        return (f"{self.correct}/{self.checked} correct "
                f"({self.accuracy:.0%}) on human-labelled examples")


def score_against_gold(store: Any, gold: dict[str, str]) -> GoldReport:
    """Measure the teacher against human labels.

    This is the number that decides whether the corpus can be trained on.
    Reported per category as well as overall, because a teacher that is 90%
    accurate overall and 40% on `montage` produces a student that cannot
    recognise montages at all.
    """
    report = GoldReport()
    confusion: dict[str, Counter[str]] = {c: Counter() for c in CATEGORIES}
    hits: Counter[str] = Counter()
    totals: Counter[str] = Counter()
    predicted_totals: Counter[str] = Counter()

    by_id = {v.canonical_id: v for v in store.query()}

    for canonical_id, truth in gold.items():
        video = by_id.get(canonical_id)
        result = _stored(video) if video else None
        if not result:
            report.unlabelled += 1
            continue
        report.checked += 1
        totals[truth] += 1
        predicted_totals[result.category] += 1
        confusion[truth][result.category] += 1
        if result.category == truth:
            report.correct += 1
            hits[truth] += 1
        else:
            report.mistakes.append({
                "canonical_id": canonical_id,
                "gold": truth,
                "predicted": result.category,
                "confidence": result.confidence,
                "evidence": result.evidence,
                "url": getattr(video, "url", ""),
            })

    report.confusion = {k: dict(v) for k, v in confusion.items()}
    for category in CATEGORIES:
        seen = totals[category]
        predicted = predicted_totals[category]
        report.per_category[category] = {
            "label": TAXONOMY[category].label,
            "gold_examples": seen,
            "recall": hits[category] / seen if seen else None,
            "precision": hits[category] / predicted if predicted else None,
        }
    return report


def apply_gold(store: Any, gold: dict[str, str]) -> dict[str, int]:
    """Write human truth into the corpus.

    A gold label overwrites the model's, verified. This both corrects the
    record and means the examples a human bothered to check are the ones the
    student is most certain to learn from.
    """
    stats = Counter()
    by_id = {v.canonical_id: v for v in store.query()}
    for canonical_id, truth in gold.items():
        video = by_id.get(canonical_id)
        if not video:
            stats["missing"] += 1
            continue
        existing = _stored(video)
        corrected = existing is not None and existing.category != truth
        store.set_fields(canonical_id, classification=Classification(
            category=truth,
            confidence="high",
            evidence=(f"human-confirmed (model said {existing.category})"
                      if corrected else "human-confirmed"),
            source="human",
            verified=True,
            verified_by="gold",
        ).to_dict())
        stats["corrected" if corrected else "confirmed"] += 1
    return dict(stats)


# -------------------------------------------------------------- agreement

@dataclass
class AgreementReport:
    checked: int = 0
    agreed: int = 0
    disagreed: int = 0
    failed: int = 0
    input_tokens: int = 0
    conflicts: list[dict[str, str]] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)

    @property
    def rate(self) -> Optional[float]:
        return self.agreed / self.checked if self.checked else None

    def summary(self) -> str:
        if not self.checked:
            return "nothing to verify"
        return (f"{self.agreed}/{self.checked} labels confirmed by a second "
                f"model ({self.rate:.0%}), {self.disagreed} disputed, "
                f"{self.failed} failed")


def verify_by_agreement(store: Any, limit: int = 25,
                        second: Optional[PegasusClassifier] = None,
                        media_dir: Path | str = "data/media",
                        connector: Any = None,
                        on_status: Callable[[str], None] = print) -> AgreementReport:
    """Re-classify with a different model and see whether it concurs.

    Only already-labelled, not-yet-verified videos are candidates — verifying
    an unlabelled video would just be labelling it, at the same price and with
    none of the independence.
    """
    from .pipeline import MediaLabeller       # local: avoids a circular import

    report = AgreementReport()
    second = second or PegasusClassifier(direct_model_name=SECOND_OPINION_MODEL)
    ok, why = second.available()
    if not ok:
        report.errors.append(f"second opinion unavailable: {why}")
        on_status(f"[verify] cannot run — {why}")
        return report

    labeller = MediaLabeller(store, teacher=second, connector=connector,
                             media_dir=media_dir, on_status=lambda _: None)

    candidates = []
    for video in store.query(order_by_views=True):
        result = _stored(video)
        if result and not result.verified and result.category in CATEGORIES:
            candidates.append((video, result))
        if len(candidates) >= limit:
            break

    for video, first in candidates:
        report.checked += 1
        on_status(f"[verify] {(video.title or video.url)[:60]}")
        try:
            challenger, _ = labeller.label_one(video)
        except Exception as exc:                     # noqa: BLE001 - reported
            report.failed += 1
            report.checked -= 1
            report.errors.append(f"{video.url}: {exc}")
            on_status(f"  ! {exc}")
            continue

        report.input_tokens += (second.last_usage or {}).get("input_tokens", 0)

        if challenger.category == first.category:
            report.agreed += 1
            first.verified = True
            first.verified_by = "agreement"
            store.set_fields(video.canonical_id, classification=first.to_dict())
            on_status(f"  = confirmed {first.category}")
        else:
            report.disagreed += 1
            report.conflicts.append({
                "canonical_id": video.canonical_id,
                "url": video.url,
                "title": video.title,
                "first": first.category,
                "second": challenger.category,
                "first_evidence": first.evidence,
                "second_evidence": challenger.evidence,
            })
            # A disputed label stays unverified and keeps its original value.
            # Overwriting it with the challenger would just be trusting the
            # newer model for no reason.
            on_status(f"  ? disputed: {first.category} vs {challenger.category}")

    return report


# ------------------------------------------------------------ review queue

def review_queue(store: Any, limit: int = 50) -> list[dict[str, Any]]:
    """What a human should look at first, worst offenders first.

    Ranked by how much damage a wrong label does: a disputed or ambiguous
    label on a video Create would actually reach for costs more than a
    low-confidence label on something nothing will ever select.
    """
    rows = []
    for video in store.query(order_by_views=True):
        result = _stored(video)
        if not result or result.verified:
            continue
        reasons = []
        if result.is_ambiguous:
            reasons.append(f"close call with {result.runner_up}")
        if not result.is_confident:
            reasons.append(f"{result.confidence} confidence")
        if result.source == "archetype":
            reasons.append("keyword guess, never a real look at the video")
        if not reasons:
            continue
        rows.append({
            "canonical_id": video.canonical_id,
            "url": video.url,
            "title": video.title,
            "predicted": result.category,
            "confidence": result.confidence,
            "why": "; ".join(reasons),
            "evidence": result.evidence,
        })
        if len(rows) >= limit:
            break
    return rows


def coverage(store: Any) -> dict[str, Any]:
    """How much of the corpus is labelled, and how much of that is trustworthy."""
    total = labelled = verified = pushable = 0
    by_verification: Counter[str] = Counter()
    for video in store.query():
        total += 1
        result = _stored(video)
        if not result or result.category not in CATEGORIES:
            continue
        labelled += 1
        if result.verified:
            verified += 1
            by_verification[result.verified_by or "unknown"] += 1
        if result.is_pushable:
            pushable += 1
    return {
        "total": total,
        "labelled": labelled,
        "verified": verified,
        "pushable": pushable,
        "unlabelled": total - labelled,
        "by_verification": dict(by_verification),
    }


def _stored(video: Any) -> Optional[Classification]:
    raw = getattr(video, "classification", None)
    return Classification.from_dict(raw) if raw else None
