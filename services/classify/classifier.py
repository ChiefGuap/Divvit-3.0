"""Five-way video classifier.

Two tiers, because they have very different costs:

  **Teacher** (`PegasusClassifier`) — TwelveLabs Pegasus, one focused analyze
  call against an already-indexed video. Accurate, costs nothing extra beyond
  the indexing screening already paid for, but requires the video to be in a
  TwelveLabs index.

  **Student** (`LocalClassifier`) — a fine-tuned VideoMAE running locally. No
  API, no index, runs on any file. Does not exist yet: it needs training data,
  which is exactly what the teacher produces (see `dataset.py`).

There is no public dataset for these five categories — checked HuggingFace and
the literature; the nearest work uses small hand-built sets of a few thousand
clips. So the teacher/student split is not an optimisation, it is the only way
to get a labelled corpus at all.

The schema is deliberately small. Measured during style extraction: a 13-field
Pegasus schema misreported audio for a video that a focused 4-field schema got
right. Asking one question at a time is worth the extra round-trip.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field, asdict
from typing import Any, Optional, Protocol

import requests

from .taxonomy import (
    ARCHETYPE_MAP, CATEGORIES, UNCLASSIFIED, from_legacy, prompt_block,
)

BASE_URL = "https://api.twelvelabs.io/v1.3"

CLASSIFY_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "category": {"type": "string", "enum": list(CATEGORIES)},
        "confidence": {"type": "string", "enum": ["high", "medium", "low"]},
        "runner_up": {
            "type": "string",
            "enum": list(CATEGORIES) + [""],
            "description": "The next most likely category, or empty if none is close.",
        },
        "evidence": {
            "type": "string",
            "description": "One sentence: what in the video decided it.",
        },
    },
    "required": ["category", "confidence", "runner_up", "evidence"],
}

CLASSIFY_PROMPT = f"""Classify this short cafe or restaurant video into exactly one \
of five categories. Judge only what you can actually see and hear.

{prompt_block()}

Pick the category that describes what KIND of video this is, not merely what \
appears in the frame — a latte can appear in all five. If two fit, name the \
second in runner_up and lower your confidence.

Respond in the required JSON format only."""


class ClassifierError(RuntimeError):
    pass


@dataclass
class Classification:
    category: str
    confidence: str = "low"
    runner_up: str = ""
    evidence: str = ""
    source: str = ""          # pegasus | legacy | archetype | local

    @property
    def is_confident(self) -> bool:
        return self.confidence in ("high", "medium")

    @property
    def is_ambiguous(self) -> bool:
        """A confident answer with a close second still deserves a human look
        when the label decides where Create places the clip."""
        return bool(self.runner_up) and self.confidence == "low"

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "Classification":
        known = set(cls.__dataclass_fields__)
        return cls(**{k: v for k, v in (d or {}).items() if k in known})


class Classifier(Protocol):
    name: str

    def available(self) -> tuple[bool, str]:
        ...

    def classify(self, video: Any) -> Optional[Classification]:
        ...


# --------------------------------------------------------------- free tiers

def classify_from_screening(screening: Optional[dict]) -> Optional[Classification]:
    """Relabel an already-screened video from its existing content_type.

    Free — no API call, no indexing. Returns None for `vlog` and `other`,
    which genuinely need a fresh look rather than a lossy mapping.
    """
    analysis = (screening or {}).get("analysis") or {}
    mapped = from_legacy(analysis.get("content_type"))
    if not mapped:
        return None
    return Classification(
        category=mapped,
        confidence=analysis.get("content_type_confidence") or "medium",
        evidence=f"mapped from screening content_type={analysis.get('content_type')!r}",
        source="legacy",
    )


def classify_from_archetype(archetype: Optional[str]) -> Optional[Classification]:
    """Cheapest possible guess, from Discover's keyword archetype.

    Only ever used to prioritise which videos are worth paying to classify
    properly — never trusted as a final label, hence confidence is always low.
    """
    mapped = ARCHETYPE_MAP.get(archetype or "")
    if not mapped:
        return None
    return Classification(
        category=mapped, confidence="low",
        evidence=f"keyword archetype {archetype!r}", source="archetype",
    )


# ------------------------------------------------------------------ teacher

class PegasusClassifier:
    """TwelveLabs Pegasus as the labelling teacher."""

    name = "pegasus"

    def __init__(self, api_key: Optional[str] = None, timeout: int = 180,
                 model_name: str = "pegasus1.2"):
        self.api_key = api_key or os.environ.get("TWELVELABS_API_KEY", "")
        self.timeout = timeout
        self.model_name = model_name
        self._session: Optional[requests.Session] = None

    def available(self) -> tuple[bool, str]:
        if not self.api_key:
            return False, "TWELVELABS_API_KEY not set"
        return True, f"twelvelabs {self.model_name}"

    def _sess(self) -> requests.Session:
        if self._session is None:
            self._session = requests.Session()
            self._session.headers.update({"x-api-key": self.api_key})
        return self._session

    def classify_video_id(self, twelvelabs_video_id: str) -> Classification:
        ok, why = self.available()
        if not ok:
            raise ClassifierError(why)

        resp = self._sess().post(f"{BASE_URL}/analyze", timeout=self.timeout, json={
            "model_name": self.model_name,
            "video_id": twelvelabs_video_id,
            "prompt": CLASSIFY_PROMPT,
            "temperature": 0,
            "stream": False,
            "max_tokens": 400,
            "response_format": {"type": "json_schema", "json_schema": CLASSIFY_SCHEMA},
        })
        if resp.status_code >= 400:
            raise ClassifierError(f"analyze -> {resp.status_code}: {resp.text[:300]}")

        data = (resp.json() or {}).get("data")
        if data is None:
            raise ClassifierError("analyze returned no data")
        if not isinstance(data, dict):
            text = str(data).strip()
            if text.startswith("```"):
                text = text.strip("`")
                if text.startswith("json"):
                    text = text[4:]
            try:
                data = json.loads(text)
            except ValueError as exc:
                raise ClassifierError(f"unparseable classification: {text[:200]}") from exc

        category = data.get("category")
        if category not in CATEGORIES:
            raise ClassifierError(f"model returned unknown category {category!r}")

        return Classification(
            category=category,
            confidence=data.get("confidence") or "low",
            runner_up=data.get("runner_up") or "",
            evidence=data.get("evidence") or "",
            source=self.name,
        )

    def classify(self, video: Any) -> Optional[Classification]:
        """Classify a DiscoveredVideo, if it has been indexed."""
        vid = ((getattr(video, "screening", None) or {}).get("video_id"))
        if not vid:
            return None
        return self.classify_video_id(vid)


# ------------------------------------------------------------------ student

@dataclass
class LocalClassifier:
    """Fine-tuned VideoMAE, run locally. Not trained yet.

    Kept as a real object rather than a TODO so the call sites that will use it
    can be written and tested now, and so `available()` states plainly why it
    cannot run instead of failing somewhere deeper.

    Training path once `dataset.py` has produced enough labels:
      base   MCG-NJU/videomae-base-finetuned-kinetics  (80.9% top-1 on K400)
      needs  ~200+ examples per category, class-balanced
      output a 5-way head replacing the Kinetics-400 head
    """

    name: str = "local-videomae"
    model_dir: Optional[str] = None
    base_model: str = "MCG-NJU/videomae-base-finetuned-kinetics"
    min_examples_per_category: int = 200

    def available(self) -> tuple[bool, str]:
        if not self.model_dir:
            return False, (
                "no fine-tuned model yet — run `classify label` to build a "
                "training set, then fine-tune from " + self.base_model
            )
        if not os.path.isdir(self.model_dir):
            return False, f"model_dir does not exist: {self.model_dir}"
        return True, f"local videomae at {self.model_dir}"

    def classify(self, video: Any) -> Optional[Classification]:
        ok, why = self.available()
        if not ok:
            raise ClassifierError(why)
        raise ClassifierError("local inference not implemented yet")


# ---------------------------------------------------------------- cascade

@dataclass
class CascadeResult:
    classification: Optional[Classification] = None
    spent_api_call: bool = False
    notes: list[str] = field(default_factory=list)


def classify_cascade(video: Any, teacher: Optional[PegasusClassifier] = None,
                     allow_api: bool = True) -> CascadeResult:
    """Cheapest sufficient answer.

    Order matters and is about money: an existing screening verdict is free, a
    keyword archetype is free, and only then do we spend an API call. The
    archetype guess is never returned as final — it exists to say "this is
    probably a review" so callers can prioritise, so it is only used when the
    API is unavailable.
    """
    result = CascadeResult()

    from_screening = classify_from_screening(getattr(video, "screening", None))
    if from_screening:
        result.classification = from_screening
        result.notes.append("relabelled from existing screening, no API call")
        return result

    if teacher and allow_api:
        ok, why = teacher.available()
        if ok:
            try:
                result.classification = teacher.classify(video)
                result.spent_api_call = result.classification is not None
                if result.classification is None:
                    result.notes.append("not indexed — cannot use the teacher")
            except ClassifierError as exc:
                result.notes.append(f"teacher failed: {exc}")
        else:
            result.notes.append(f"teacher unavailable: {why}")

    if result.classification is None:
        style = getattr(video, "style", None) or {}
        guess = classify_from_archetype(
            (getattr(video, "roi", None) or {}).get("archetype")
            or style.get("archetype"))
        if guess:
            result.classification = guess
            result.notes.append("keyword guess only — not a trustworthy label")

    return result
