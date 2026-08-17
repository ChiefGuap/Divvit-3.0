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

import base64
import json
import os
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Any, Optional, Protocol

import requests

from .taxonomy import (
    ARCHETYPE_MAP, CATEGORIES, NOT_CAFE, UNCLASSIFIED, from_legacy, prompt_block,
)

BASE_URL = "https://api.twelvelabs.io/v1.3"

# The direct path: `/analyze` accepts a video source inline, so a file can be
# classified without ever entering an index. Measured 2026-08-16 on a 2.8MB /
# 30s TikTok clip: 200 OK in 8.4s, 6.4k input tokens, zero indexed minutes.
#
# This is what makes labelling the whole corpus possible. Indexing costs
# minutes off a 600-minute allowance; this costs tokens. A video only needs to
# be indexed if something downstream will *search* it.
DIRECT_MODEL = "pegasus1.5"

# The API documents a 30MB ceiling on base64 sources. Base64 inflates by ~4/3,
# so the gate is on the file, not the payload — measured against the encoded
# size after the fact is too late to avoid the wasted read.
MAX_DIRECT_FILE_BYTES = 22 * 1024 * 1024

# TwelveLabs input constraints. A video outside these will never succeed, so
# the labeller retires it instead of retrying it every run.
MIN_DURATION_SECONDS = 4.0
MAX_DURATION_SECONDS = 3600.0

# Measured 2026-08-16: the direct path rejects anything below 512
# ("max_tokens must be between 512 and 98304 for this model and mode"). The
# classification itself is four short fields, so this is a ceiling we never
# approach — it exists to satisfy the API, not to bound the answer.
MAX_OUTPUT_TOKENS = 512

CLASSIFY_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "is_cafe_content": {
            "type": "boolean",
            "description": (
                "True only if this is about food, drink, or a place that "
                "serves them. False for anything else, whatever else is in it."
            ),
        },
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
    "required": ["is_cafe_content", "category", "confidence", "runner_up",
                 "evidence"],
}

CLASSIFY_PROMPT = f"""Classify this short video. Judge only what you can actually \
see and hear.

FIRST, decide `is_cafe_content`: is this video about food, drink, or a place \
that serves them — a cafe, restaurant, bar, bakery, food stall? Set it false \
for anything else: a living room, a car, a gym, a pet, a skit, a haul. A \
kitchen in someone's home is not a venue. If it is false, say so plainly; do \
not stretch to fit a category, and put what you actually saw in `evidence`.

THEN, if and only if it is cafe content, pick exactly one of five categories:

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
    source: str = ""          # pegasus | pegasus-direct | legacy | archetype | local
    # Set only when something independent has agreed with this label — a human
    # gold label, or a second classifier reaching the same answer by a
    # different route. The model's own confidence is not verification: a model
    # that is confidently wrong reports "high" just as loudly.
    verified: bool = False
    verified_by: str = ""     # gold | agreement | human

    @property
    def is_confident(self) -> bool:
        return self.confidence in ("high", "medium")

    @property
    def is_ambiguous(self) -> bool:
        """A confident answer with a close second still deserves a human look
        when the label decides where Create places the clip."""
        return bool(self.runner_up) and self.confidence == "low"

    @property
    def is_pushable(self) -> bool:
        """May this label be acted on — trained from, or used to place a clip?

        Confidence and verification are different claims and both are required.
        Confidence is the model's opinion of itself; verification is evidence
        from outside the model.
        """
        return self.is_confident and self.verified

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

    def __init__(self, api_key: Optional[str] = None, timeout: int = 300,
                 model_name: str = "pegasus1.2",
                 direct_model_name: str = DIRECT_MODEL):
        self.api_key = api_key or os.environ.get("TWELVELABS_API_KEY", "")
        self.timeout = timeout
        self.model_name = model_name
        self.direct_model_name = direct_model_name
        # Token usage from the most recent call — the direct path bills tokens,
        # so this is how a run reports what it actually cost.
        self.last_usage: dict[str, Any] = {}
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

    def _analyze(self, source: dict[str, Any], model_name: str,
                 source_label: str) -> Classification:
        ok, why = self.available()
        if not ok:
            raise ClassifierError(why)

        payload = {
            "model_name": model_name,
            "prompt": CLASSIFY_PROMPT,
            "temperature": 0,
            "stream": False,
            "max_tokens": MAX_OUTPUT_TOKENS,
            "response_format": {"type": "json_schema", "json_schema": CLASSIFY_SCHEMA},
        }
        payload.update(source)

        resp = self._sess().post(f"{BASE_URL}/analyze", timeout=self.timeout,
                                 json=payload)
        if resp.status_code >= 400:
            raise ClassifierError(f"analyze -> {resp.status_code}: {resp.text[:300]}")

        body = resp.json() or {}
        data = body.get("data")
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

        # The five categories only mean anything for cafe content. Junk that
        # reached the corpus is parked outside the vocabulary rather than
        # forced into the nearest-looking bucket.
        if data.get("is_cafe_content") is False:
            category = NOT_CAFE

        result = Classification(
            category=category,
            confidence=data.get("confidence") or "low",
            runner_up=data.get("runner_up") or "",
            evidence=data.get("evidence") or "",
            source=source_label,
        )
        self.last_usage = body.get("usage") or {}
        return result

    def classify_video_id(self, twelvelabs_video_id: str) -> Classification:
        """Indexed path — free of media handling, but the video must be indexed."""
        return self._analyze({"video_id": twelvelabs_video_id},
                             self.model_name, self.name)

    def classify_file(self, path: Path | str) -> Classification:
        """Direct path — classify a file that was never indexed.

        This is the one that scales to the whole corpus: harvested video can be
        downloaded, classified, and deleted without consuming index minutes or
        leaving a copy of someone else's video sitting in our account.
        """
        path = Path(path)
        if not path.exists():
            raise ClassifierError(f"no such file: {path}")
        size = path.stat().st_size
        if size > MAX_DIRECT_FILE_BYTES:
            raise ClassifierError(
                f"{path.name} is {size / 1e6:.1f}MB — over the "
                f"{MAX_DIRECT_FILE_BYTES / 1e6:.0f}MB direct-analyze ceiling; "
                "index it instead")
        if size == 0:
            raise ClassifierError(f"{path.name} is empty (video_file_broken)")

        encoded = base64.b64encode(path.read_bytes()).decode()
        return self._analyze(
            {"video": {"type": "base64_string", "base64_string": encoded}},
            self.direct_model_name, f"{self.name}-direct")

    def classify(self, video: Any) -> Optional[Classification]:
        """Classify a DiscoveredVideo by whichever route is open to it.

        Indexed first: it is already paid for and needs no bytes moved. A local
        evaluation copy is the fallback, which is what lets an unindexed video
        be labelled at all.
        """
        vid = ((getattr(video, "screening", None) or {}).get("video_id"))
        if vid:
            return self.classify_video_id(vid)
        local = getattr(video, "local_path", None)
        if local and Path(local).exists():
            return self.classify_file(local)
        return None


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
