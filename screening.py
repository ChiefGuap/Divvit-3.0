"""
Divvit Screening AI — The Collection intake pipeline.

Screens user-submitted videos via the TwelveLabs API (v1.3):
  1. Verify the video is real cafe/restaurant content (not spam/slop/unrelated).
  2. Classify content type: review | vlog | interior | menu_item | event | other.
  3. Verify the video is about the SPECIFIC business it was submitted to.

Architecture:
  - Pegasus (generative video understanding) does the screening via a single
    structured-JSON analysis call.
  - Marengo (embeddings/search) is enabled on the index so accepted videos are
    immediately semantically searchable — this powers The Collection later.

Two flows:
  - INDEX flow (default): upload -> index -> analyze by video_id (pegasus1.2).
    Costs indexing minutes but the video lands in our searchable index, which
    Divvit needs anyway for accepted content.
  - DIRECT flow (experimental): sync analyze with pegasus1.5 passing the video
    source directly (URL). Cheaper pre-screen for videos we might reject before
    paying to index them.
"""

from __future__ import annotations

import json
import os
import time
from dataclasses import dataclass, field, asdict
from typing import Any, Optional

import requests

BASE_URL = "https://api.twelvelabs.io/v1.3"
DEFAULT_INDEX_NAME = "divvit-collection"

CONTENT_TYPES = ["review", "vlog", "interior", "menu_item", "event", "other"]

# JSON schema Pegasus must return (passed via response_format.json_schema)
SCREENING_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "is_food_beverage_content": {
            "type": "boolean",
            "description": "True only if the video substantively shows a cafe/restaurant/food or beverage experience.",
        },
        "content_type": {"type": "string", "enum": CONTENT_TYPES},
        "content_type_confidence": {"type": "string", "enum": ["high", "medium", "low"]},
        "venue_match": {
            "type": "string",
            "enum": ["confirmed", "likely", "unclear", "mismatch", "n/a"],
            "description": "Whether the video is about the specific target business. "
                           "'n/a' when no target business was supplied (catalog screening).",
        },
        "venue_evidence": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Concrete evidence observed: signage, logo, cups/packaging, spoken name, menu boards, distinctive interior.",
        },
        "detected_items": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Menu items / drinks / dishes visible or mentioned.",
        },
        "sentiment": {"type": "string", "enum": ["positive", "neutral", "negative", "n/a"]},
        "quality_flags": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Issues: very_shaky, too_dark, no_audio, watermarked, likely_repost, inappropriate, ai_generated, other.",
        },
        "summary": {"type": "string", "description": "2-3 sentence description of the video."},
    },
    "required": [
        "is_food_beverage_content",
        "content_type",
        "content_type_confidence",
        "venue_match",
        "venue_evidence",
        "detected_items",
        "sentiment",
        "quality_flags",
        "summary",
    ],
}

HARD_REJECT_FLAGS = {"inappropriate"}
REVIEW_FLAGS = {"ai_generated", "likely_repost", "watermarked"}


@dataclass
class BusinessProfile:
    """What we know about the business the user says the video is about."""

    name: str
    location: str = ""  # e.g. "North Park, San Diego"
    cuisine: str = ""  # e.g. "Korean cafe, salt bread + matcha"
    menu_items: list[str] = field(default_factory=list)
    visual_cues: list[str] = field(default_factory=list)  # logo colors, cup design, interior notes

    def describe(self) -> str:
        parts = [f"Business name: {self.name}"]
        if self.location:
            parts.append(f"Location: {self.location}")
        if self.cuisine:
            parts.append(f"Type: {self.cuisine}")
        if self.menu_items:
            parts.append(f"Known menu items: {', '.join(self.menu_items)}")
        if self.visual_cues:
            parts.append(f"Known visual identifiers: {', '.join(self.visual_cues)}")
        return "\n".join(parts)


@dataclass
class ScreeningResult:
    verdict: str  # "approved_for_collection" | "needs_review" | "rejected"
    reasons: list[str]
    analysis: dict[str, Any]  # raw structured output from Pegasus
    video_id: Optional[str] = None
    index_id: Optional[str] = None

    def to_json(self) -> str:
        return json.dumps(asdict(self), indent=2)


class TwelveLabsError(RuntimeError):
    pass


class ScreeningClient:
    def __init__(self, api_key: Optional[str] = None, base_url: str = BASE_URL):
        self.api_key = api_key or os.environ.get("TWELVELABS_API_KEY", "")
        if not self.api_key:
            raise ValueError("Set TWELVELABS_API_KEY or pass api_key=")
        self.base_url = base_url
        self.session = requests.Session()
        self.session.headers.update({"x-api-key": self.api_key})

    # ------------------------------------------------------------------ http
    def _request(self, method: str, path: str, **kwargs) -> dict[str, Any]:
        url = f"{self.base_url}{path}"
        resp = self.session.request(method, url, timeout=kwargs.pop("timeout", 120), **kwargs)
        if resp.status_code >= 400:
            raise TwelveLabsError(f"{method} {path} -> {resp.status_code}: {resp.text[:500]}")
        if not resp.content:
            return {}
        try:
            return resp.json()
        except ValueError:
            return {"raw": resp.text}

    # ----------------------------------------------------------------- setup
    def validate_key(self) -> bool:
        """Cheap auth check — lists indexes."""
        self._request("GET", "/indexes", params={"page_limit": 1})
        return True

    def get_or_create_index(self, name: str = DEFAULT_INDEX_NAME) -> str:
        """Reuse the Divvit index if it exists, otherwise create it.

        Marengo 3.0 -> semantic search over accepted content (The Collection).
        Pegasus 1.2 -> screening/classification analysis by video_id.
        """
        data = self._request("GET", "/indexes", params={"index_name": name, "page_limit": 1})
        existing = data.get("data") or []
        if existing:
            return existing[0]["_id"]
        payload = {
            "index_name": name,
            "models": [
                {"model_name": "marengo3.0", "model_options": ["visual", "audio"]},
                {"model_name": "pegasus1.2", "model_options": ["visual", "audio"]},
            ],
            "addons": ["thumbnail"],
        }
        created = self._request("POST", "/indexes", json=payload)
        return created["_id"]

    # ---------------------------------------------------------------- upload
    def upload_video(self, index_id: str, file_path: Optional[str] = None,
                     url: Optional[str] = None) -> str:
        """Create a video indexing task. Returns task_id."""
        if bool(file_path) == bool(url):
            raise ValueError("Provide exactly one of file_path or url")
        data = {"index_id": index_id}
        if url:
            data["video_url"] = url
            task = self._request("POST", "/tasks", data=data)
        else:
            with open(file_path, "rb") as fh:
                files = {"video_file": (os.path.basename(file_path), fh, "video/mp4")}
                task = self._request("POST", "/tasks", data=data, files=files, timeout=600)
        return task["_id"]

    def wait_for_task(self, task_id: str, poll_seconds: int = 10,
                      timeout_seconds: int = 1800) -> str:
        """Poll until the indexing task is ready. Returns video_id."""
        deadline = time.time() + timeout_seconds
        while time.time() < deadline:
            task = self._request("GET", f"/tasks/{task_id}")
            status = task.get("status")
            if status == "ready":
                return task["video_id"]
            if status == "failed":
                raise TwelveLabsError(f"Indexing task {task_id} failed: {task}")
            time.sleep(poll_seconds)
        raise TwelveLabsError(f"Indexing task {task_id} timed out after {timeout_seconds}s")

    # --------------------------------------------------------------- analyze
    def _build_prompt(self, business: Optional[BusinessProfile]) -> str:
        if business is None:
            return self._build_catalog_prompt()
        return f"""You are the content screening system for Divvit, a marketplace where cafe and \
restaurant customers submit videos about businesses. Analyze this video submission carefully and \
answer strictly based on what you can actually see and hear — do not guess.

The user claims this video is about the following business:
{business.describe()}

Tasks:
1. Decide if this is genuine cafe/restaurant/food-and-beverage content (a real visit, food, \
drinks, interior, or an event at a food business). Screen recordings of other videos, unrelated \
content, or spam are NOT genuine content.
2. Classify the content type: "review" (person talks about/rates the experience), "vlog" \
(visit experience footage, POV style), "interior" (space/ambience focused), "menu_item" \
(specific food/drink focused), "event" (special event at the business), or "other".
3. Determine if the video is about the SPECIFIC business above. Look for signage, logos, cups \
or packaging branding, menu boards, receipts, spoken mentions, captions, or distinctive interior \
matching the known identifiers. "confirmed" = direct evidence (name visible/spoken). "likely" = \
strong circumstantial match. "unclear" = generic footage that could be anywhere. "mismatch" = \
evidence it is a DIFFERENT business.
4. List menu items shown or mentioned, overall sentiment toward the business, and any quality \
flags (very_shaky, too_dark, no_audio, watermarked, likely_repost, inappropriate, ai_generated).

Respond in the required JSON format only."""

    @staticmethod
    def _build_catalog_prompt() -> str:
        """Screening with no target business — used by Discover on harvested
        videos, where there is nothing to verify a venue against. Same schema,
        same classifier, venue_match fixed to "n/a"."""
        return """You are the content screening system for Divvit, a marketplace for cafe and \
restaurant customer videos. This video was collected from public social media for catalog \
analysis, not submitted by a user. Analyze it based only on what you can actually see and hear \
— do not guess.

Tasks:
1. Decide if this is genuine cafe/restaurant/food-and-beverage content (a real visit, food, \
drinks, interior, or an event at a food business). Screen recordings of other videos, unrelated \
content, ads, or spam are NOT genuine content.
2. Classify the content type: "review" (person talks about/rates the experience), "vlog" \
(visit experience footage, POV style), "interior" (space/ambience focused), "menu_item" \
(specific food/drink focused), "event" (special event at the business), or "other".
3. There is no target business for this video. Set venue_match to "n/a" and put any business \
name you can actually identify from signage, cups, or speech into venue_evidence.
4. List menu items shown or mentioned, overall sentiment toward the business, and any quality \
flags (very_shaky, too_dark, no_audio, watermarked, likely_repost, inappropriate, ai_generated).

Respond in the required JSON format only."""

    def analyze_indexed(self, video_id: str,
                        business: Optional[BusinessProfile] = None) -> dict[str, Any]:
        payload = {
            "model_name": "pegasus1.2",
            "video_id": video_id,
            "prompt": self._build_prompt(business),
            "temperature": 0,
            "stream": False,
            "max_tokens": 2000,
            "response_format": {"type": "json_schema", "json_schema": SCREENING_SCHEMA},
        }
        resp = self._request("POST", "/analyze", json=payload, timeout=300)
        return self._parse_analysis(resp)

    def analyze_direct(self, video_url: str,
                       business: Optional[BusinessProfile] = None) -> dict[str, Any]:
        """Experimental: pegasus1.5 direct-source analysis (no indexing cost).
        Falls back with TwelveLabsError if the account/plan doesn't support it."""
        payload = {
            "model_name": "pegasus1.5",
            "video": {"url": video_url},
            "prompt": self._build_prompt(business),
            "temperature": 0,
            "stream": False,
            "response_format": {"type": "json_schema", "json_schema": SCREENING_SCHEMA},
        }
        resp = self._request("POST", "/analyze", json=payload, timeout=300)
        return self._parse_analysis(resp)

    @staticmethod
    def _parse_analysis(resp: dict[str, Any]) -> dict[str, Any]:
        text = resp.get("data") or resp.get("raw") or ""
        if isinstance(text, dict):
            return text
        text = text.strip()
        # tolerate code fences
        if text.startswith("```"):
            text = text.strip("`")
            if text.startswith("json"):
                text = text[4:]
        try:
            return json.loads(text)
        except ValueError as exc:
            raise TwelveLabsError(f"Could not parse analysis JSON: {text[:300]}") from exc

    # --------------------------------------------------------------- verdict
    @staticmethod
    def decide(analysis: dict[str, Any]) -> tuple[str, list[str]]:
        reasons: list[str] = []
        flags = set(analysis.get("quality_flags") or [])

        if flags & HARD_REJECT_FLAGS:
            return "rejected", [f"quality flag: {', '.join(flags & HARD_REJECT_FLAGS)}"]
        if not analysis.get("is_food_beverage_content"):
            return "rejected", ["not genuine cafe/restaurant content"]
        if analysis.get("venue_match") == "mismatch":
            return "rejected", ["video appears to be about a different business"]

        if analysis.get("venue_match") == "unclear":
            reasons.append("could not verify the video is about this specific business")
        if analysis.get("content_type_confidence") == "low":
            reasons.append("low confidence in content-type classification")
        if flags & REVIEW_FLAGS:
            reasons.append(f"quality flags: {', '.join(flags & REVIEW_FLAGS)}")

        if reasons:
            return "needs_review", reasons

        return "approved_for_collection", [
            f"venue {analysis.get('venue_match')}",
            f"type {analysis.get('content_type')} ({analysis.get('content_type_confidence')})",
        ]

    # ------------------------------------------------------------- pipeline
    def screen_submission(
        self,
        business: Optional[BusinessProfile] = None,
        file_path: Optional[str] = None,
        url: Optional[str] = None,
        index_name: str = DEFAULT_INDEX_NAME,
        on_status=print,
    ) -> ScreeningResult:
        """Full intake pipeline: index the submission, screen it, return verdict."""
        index_id = self.get_or_create_index(index_name)
        on_status(f"[divvit] index: {index_id}")

        task_id = self.upload_video(index_id, file_path=file_path, url=url)
        on_status(f"[divvit] indexing task: {task_id} (this can take a few minutes)")

        video_id = self.wait_for_task(task_id)
        on_status(f"[divvit] video ready: {video_id}")

        analysis = self.analyze_indexed(video_id, business)
        verdict, reasons = self.decide(analysis)
        on_status(f"[divvit] verdict: {verdict} ({'; '.join(reasons)})")

        return ScreeningResult(
            verdict=verdict, reasons=reasons, analysis=analysis,
            video_id=video_id, index_id=index_id,
        )
