"""Venue verification — is this video about the place the submitter claims?

Three stages, each reusing a piece that already exists:

  1. **Claim resolution** (services/venues.resolver). "La Bora" + "North
     Park, San Diego" is resolved against the business catalog to a canonical
     record, which enriches the screening prompt with everything we know
     (menu, aliases, visual cues). A claim that resolves to nothing still
     proceeds — a bare name+location profile is enough for Pegasus to check
     signage against — it just can't be corroborated as richly.

  2. **Screening** (screening.py, business mode). One structured Pegasus call
     answers: is this real cafe content, and is it about THIS business. The
     call goes through the direct /analyze path (inline base64, pegasus1.5) —
     the same pattern services/classify measured and guarded: tokens not
     indexed minutes, 22MB file gate, max_tokens floor of 512, temperature 0.
     The verdict logic is ScreeningClient.decide, unchanged.

  3. **Corpus cross-check.** Discover's harvested corpus may already hold
     screened videos for the same business. What THOSE videos showed —
     signage read, dishes detected — is independent context this submission
     should rhyme with. Agreement raises confidence (and can rescue an
     'unclear' venue_match); disagreement routes to a human. At launch the
     corpus knows nothing about most venues, so the empty-corpus path is the
     designed-for case: the gate degrades to screening alone and says so.
"""

from __future__ import annotations

import base64
import json
import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional, Protocol

import requests

from screening import BusinessProfile, ScreeningClient, SCREENING_SCHEMA
from services.venues import BusinessCatalog, VenueResolver, name_similarity, normalize

from .provenance import GateResult, PASS, REJECT, REVIEW

BASE_URL = "https://api.twelvelabs.io/v1.3"

# Same guards as services/classify/classifier.py, measured there 2026-08-16:
# the API's 30MB base64 ceiling gated on the file (base64 inflates ~4/3), and
# the direct path's hard floor of 512 output tokens.
DIRECT_MODEL = "pegasus1.5"
MAX_DIRECT_FILE_BYTES = 22 * 1024 * 1024
MAX_OUTPUT_TOKENS = 2000  # screening schema is bigger than classify's; >512 floor

# Corpus corroboration thresholds. Evidence strings come from Pegasus reading
# pixels, so comparison uses the same OCR-tolerant similarity the resolver
# uses. 0.6 aligns with a solid partial name match; 0.3 is below anything two
# reads of the same sign produce.
CORROBORATE_THRESHOLD = 0.60
CONTRADICT_THRESHOLD = 0.30
# One corpus video agreeing could be one mistake; contradiction is only
# declared when at least two independent corpus videos had readable evidence.
MIN_CORPUS_VIDEOS_FOR_CONTRADICTION = 2

_UNCLEAR_REASON = "could not verify the video is about this specific business"


class ScreenerUnavailable(RuntimeError):
    pass


class Screener(Protocol):
    """What the venue gate needs from a screening backend. Tests fake this."""

    def available(self) -> tuple[bool, str]: ...

    def screen_file(self, path: Path | str,
                    business: BusinessProfile) -> dict[str, Any]: ...


class DirectScreener:
    """screening.py's business-mode analysis over the direct /analyze path.

    ScreeningClient's own flows either index the video (costs minutes) or
    need a URL. Intake holds a local file and must not index content that
    might still be rejected, so this runs the same prompt, schema and
    verdict logic with an inline base64 source — the pattern
    services/classify proved out. Nothing lands in any index.
    """

    def __init__(self, api_key: Optional[str] = None, timeout: int = 300):
        self.api_key = api_key or os.environ.get("TWELVELABS_API_KEY", "")
        self.timeout = timeout
        self.last_usage: dict[str, Any] = {}
        self._session: Optional[requests.Session] = None

    def available(self) -> tuple[bool, str]:
        if not self.api_key:
            return False, "TWELVELABS_API_KEY not set"
        return True, f"twelvelabs {DIRECT_MODEL} direct"

    def _sess(self) -> requests.Session:
        if self._session is None:
            self._session = requests.Session()
            self._session.headers.update({"x-api-key": self.api_key})
        return self._session

    def screen_file(self, path: Path | str,
                    business: BusinessProfile) -> dict[str, Any]:
        path = Path(path)
        size = path.stat().st_size
        if size > MAX_DIRECT_FILE_BYTES:
            raise ScreenerUnavailable(
                f"{path.name} is {size / 1e6:.1f}MB — over the "
                f"{MAX_DIRECT_FILE_BYTES / 1e6:.0f}MB direct-analyze ceiling")
        if size == 0:
            raise ScreenerUnavailable(f"{path.name} is empty")

        # The prompt builder only touches `self` in catalog mode (business
        # None); intake always has a business, so borrowing it unbound keeps
        # screening.py untouched.
        prompt = ScreeningClient._build_prompt(None, business)  # type: ignore[arg-type]
        payload = {
            "model_name": DIRECT_MODEL,
            "video": {"type": "base64_string",
                      "base64_string": base64.b64encode(path.read_bytes()).decode()},
            "prompt": prompt,
            "temperature": 0,
            "stream": False,
            "max_tokens": MAX_OUTPUT_TOKENS,
            "response_format": {"type": "json_schema",
                                "json_schema": SCREENING_SCHEMA},
        }
        resp = self._sess().post(f"{BASE_URL}/analyze", json=payload,
                                 timeout=self.timeout)
        if resp.status_code >= 400:
            raise ScreenerUnavailable(
                f"analyze -> {resp.status_code}: {resp.text[:300]}")
        body = resp.json() or {}
        self.last_usage = body.get("usage") or {}
        data = body.get("data")
        if isinstance(data, dict):
            return data
        text = str(data or "").strip()
        if text.startswith("```"):
            text = text.strip("`")
            if text.startswith("json"):
                text = text[4:]
        try:
            return json.loads(text)
        except ValueError as exc:
            raise ScreenerUnavailable(
                f"unparseable screening analysis: {text[:200]}") from exc


# ----------------------------------------------------------- claim resolution

def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")


@dataclass
class ResolvedClaim:
    profile: BusinessProfile
    business_id: str
    in_catalog: bool = False
    resolution: dict[str, Any] = field(default_factory=dict)


def resolve_claim(claimed_business: str, claimed_location: str,
                  catalog: Optional[BusinessCatalog] = None) -> ResolvedClaim:
    """Claimed name+location -> the richest BusinessProfile we can build.

    A catalog hit brings menu items, aliases and visual cues into the
    screening prompt — Pegasus verifies much better open-book. No catalog,
    or no hit, still yields a usable bare profile; the claim is what the
    user typed, not what we already knew.
    """
    city = (claimed_location or "").split(",")[-1].strip()

    if catalog and len(catalog):
        resolver = VenueResolver(catalog)
        result = resolver.resolve([claimed_business], city=city)
        if result.best is not None:
            record = catalog.get(result.best.business_id)
            if record is not None:
                return ResolvedClaim(
                    profile=BusinessProfile(
                        name=record.name,
                        location=claimed_location or record.city,
                        cuisine=record.cuisine,
                        menu_items=list(record.menu_items),
                        visual_cues=list(record.visual_cues),
                    ),
                    business_id=record.business_id,
                    in_catalog=True,
                    resolution=result.best.to_dict())

    return ResolvedClaim(
        profile=BusinessProfile(name=claimed_business,
                                location=claimed_location),
        business_id=f"claimed:{_slug(claimed_business)}--{_slug(city)}",
        in_catalog=False,
        resolution={"verdict": "not_in_catalog"})


# --------------------------------------------------------- corpus cross-check

def _corpus_context(corpus_store: Any, business_id: str,
                    business_name: str) -> list[dict[str, Any]]:
    """Screened corpus videos that are about this business.

    Matched by business_id when Discover tagged one, and by venue evidence
    similarity otherwise — the corpus predates business tagging for most
    rows, but a video whose screening read the same name off a sign is
    evidence about the same venue.
    """
    if corpus_store is None:
        return []
    rows: list[dict[str, Any]] = []
    seen: set[str] = set()
    try:
        tagged = corpus_store.query(business_id=business_id, screened_only=True)
    except Exception:
        return []
    for video in tagged:
        analysis = (video.screening or {}).get("analysis") or {}
        rows.append({"canonical_id": video.canonical_id, "url": video.url,
                     "analysis": analysis})
        seen.add(video.canonical_id)

    for video in corpus_store.query(screened_only=True):
        if video.canonical_id in seen:
            continue
        analysis = (video.screening or {}).get("analysis") or {}
        evidence = analysis.get("venue_evidence") or []
        if any(name_similarity(e, business_name) >= CORROBORATE_THRESHOLD
               for e in evidence):
            rows.append({"canonical_id": video.canonical_id, "url": video.url,
                         "analysis": analysis})
    return rows


def _item_tokens(items: list[str]) -> set[str]:
    return {w for item in items for w in normalize(item).split() if len(w) > 3}


def cross_check(analysis: dict[str, Any],
                context: list[dict[str, Any]]) -> dict[str, Any]:
    """Compare this submission's evidence with what the corpus already saw.

    Returns {status, ...evidence}. status is one of:
      no_context    — corpus knows nothing about this venue (common at launch)
      corroborated  — independent footage agrees on signage and/or menu
      neutral       — context exists but neither agrees nor disagrees
      contradicted  — corpus footage consistently shows different evidence
    """
    if not context:
        return {"status": "no_context", "corpus_videos": 0}

    sub_evidence = [e for e in (analysis.get("venue_evidence") or []) if e]
    sub_items = _item_tokens(analysis.get("detected_items") or [])

    corpus_evidence: list[str] = []
    corpus_items: set[str] = set()
    readable = 0
    for row in context:
        ev = [e for e in (row["analysis"].get("venue_evidence") or []) if e]
        if ev:
            readable += 1
        corpus_evidence += ev
        corpus_items |= _item_tokens(row["analysis"].get("detected_items") or [])

    name_score = max((name_similarity(a, b)
                      for a in sub_evidence for b in corpus_evidence),
                     default=0.0)
    item_overlap = sorted(sub_items & corpus_items)

    out: dict[str, Any] = {
        "corpus_videos": len(context),
        "best_evidence_similarity": round(name_score, 3),
        "shared_menu_tokens": item_overlap[:6],
        "corpus_urls": [r["url"] for r in context[:3]],
    }

    if name_score >= CORROBORATE_THRESHOLD or len(item_overlap) >= 2:
        out["status"] = "corroborated"
    elif (sub_evidence and readable >= MIN_CORPUS_VIDEOS_FOR_CONTRADICTION
          and name_score < CONTRADICT_THRESHOLD and not item_overlap):
        out["status"] = "contradicted"
    else:
        out["status"] = "neutral"
    return out


# ------------------------------------------------------------------ the gate

class VenueGate:
    """Claim -> profile -> paid screening -> corpus cross-check -> verdict."""

    def __init__(self, screener: Optional[Screener] = None,
                 catalog: Optional[BusinessCatalog] = None,
                 corpus_store: Any = None):
        self.screener = screener
        self.catalog = catalog
        self.corpus_store = corpus_store

    def check(self, file_path: Path | str, claimed_business: str,
              claimed_location: str) -> tuple[GateResult, Optional[dict[str, Any]]]:
        """Returns (gate result, screening payload or None)."""
        claim = resolve_claim(claimed_business, claimed_location, self.catalog)

        if self.screener is None:
            return GateResult(
                "venue_verification", REVIEW,
                reason="screening_unavailable",
                evidence={"claim": claim.resolution,
                          "note": "no screener configured — venue claim "
                                  "recorded but unverified"}), None
        ok, why = self.screener.available()
        if not ok:
            return GateResult(
                "venue_verification", REVIEW,
                reason="screening_unavailable",
                evidence={"claim": claim.resolution, "note": why}), None

        try:
            analysis = self.screener.screen_file(file_path, claim.profile)
        except ScreenerUnavailable as exc:
            return GateResult(
                "venue_verification", REVIEW, reason="screening_failed",
                evidence={"claim": claim.resolution, "error": str(exc)}), None

        verdict, reasons = ScreeningClient.decide(analysis)

        context = _corpus_context(self.corpus_store, claim.business_id,
                                  claim.profile.name)
        corroboration = cross_check(analysis, context)

        # Corroboration can rescue exactly one situation: screening believed
        # the content but could not pin the venue, and independent corpus
        # footage of this business shows the same signage or menu. It never
        # overrides a rejection and never upgrades past other review reasons.
        if (verdict == "needs_review" and reasons == [_UNCLEAR_REASON]
                and corroboration["status"] == "corroborated"):
            verdict = "approved_for_collection"
            reasons = ["venue unclear to screening, corroborated by "
                       f"{corroboration['corpus_videos']} corpus video(s) "
                       "of this business"]
        elif corroboration["status"] == "contradicted" \
                and verdict == "approved_for_collection":
            verdict = "needs_review"
            reasons = ["corpus footage of this business shows different "
                       "signage/menu than this submission"] + reasons

        status = {"approved_for_collection": PASS,
                  "needs_review": REVIEW}.get(verdict, REJECT)
        payload = {
            "verdict": verdict,
            "reasons": reasons,
            "analysis": analysis,
            "mode": "business",
            "path": "direct",
            "claim": {"business_id": claim.business_id,
                      "in_catalog": claim.in_catalog,
                      "resolution": claim.resolution},
            "corroboration": corroboration,
            "usage": getattr(self.screener, "last_usage", {}) or {},
        }
        return GateResult(
            "venue_verification", status,
            reason="; ".join(reasons),
            evidence={"venue_match": analysis.get("venue_match"),
                      "venue_evidence": analysis.get("venue_evidence"),
                      "corroboration": corroboration}), payload
