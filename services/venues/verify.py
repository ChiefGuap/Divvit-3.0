"""Cross-reference verification — is this video really from this venue?

A user can upload anything and claim it is their local cafe. With a reward
attached, someone will. This module checks the claim against independent
evidence rather than trusting the model's impression of the footage.

Four signals, deliberately independent so no single forgery defeats them:

  1. **Geo** — GPS in the video's metadata vs the venue's real coordinates.
     The strongest signal by far and the hardest to fake, because a phone
     writes it at capture time. Also the easiest to *lose*: every social
     platform strips it, so this only exists for direct app uploads.
  2. **Visual reference** — photos of the real venue (Places/Street View)
     matched against the submitted video with TwelveLabs image search. This is
     the check that catches "footage of a different cafe entirely".
  3. **Signage** — the venue name Pegasus read off signs/cups vs the venue's
     real name.
  4. **Menu** — dishes detected vs the venue's known menu.

The scoring rule that matters: **a signal that was not checked never counts as
a pass.** Trust is computed only over signals with actual evidence, and a
verdict of `verified` requires enough of them. Otherwise an empty business
profile would produce a perfect score by having nothing to contradict.
"""

from __future__ import annotations

import math
import re
import subprocess
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Any, Optional

from .reference import KIND_INTERIOR, KIND_STOREFRONT, VenueFingerprint
from .resolver import name_similarity, normalize

PASS, FAIL, INCONCLUSIVE, NOT_CHECKED = "pass", "fail", "inconclusive", "not_checked"

# A venue's footage should be captured at the venue. 150m allows for GPS drift
# in a dense city block; beyond 500m it is a different place.
GEO_CONFIRM_METERS = 150.0
GEO_REJECT_METERS = 500.0

# How far down the image-search results the submitted video may appear and
# still count as a visual match.
VISUAL_TOP_N = 5

VERIFY_THRESHOLD = 0.75
REVIEW_THRESHOLD = 0.45
# Below this many checked signals we cannot responsibly auto-approve, however
# well the checks that did run scored.
MIN_SIGNALS_FOR_AUTO = 2

# ISO 6709, as Apple writes it: "+32.7157-117.1611+021.000/"
_ISO6709 = re.compile(r"([+-]\d+\.?\d*)([+-]\d+\.?\d*)")

# Words that appear on every menu and so prove nothing about which venue it is.
_MENU_STOPWORDS = {"with", "and", "the", "fresh", "house", "special", "style",
                   "served", "topping", "sauce", "side", "plate", "bowl"}


@dataclass
class Signal:
    name: str
    status: str
    weight: float
    score: float = 0.0        # 0..1, meaningful only when status is pass/fail
    detail: str = ""

    @property
    def checked(self) -> bool:
        return self.status in (PASS, FAIL)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class VerificationResult:
    verdict: str                       # verified | needs_review | rejected
    trust_score: float
    signals: list[Signal] = field(default_factory=list)
    reasons: list[str] = field(default_factory=list)

    def checked_signals(self) -> list[Signal]:
        return [s for s in self.signals if s.checked]

    def to_dict(self) -> dict[str, Any]:
        return {
            "verdict": self.verdict,
            "trust_score": round(self.trust_score, 3),
            "signals_checked": len(self.checked_signals()),
            "signals": [s.to_dict() for s in self.signals],
            "reasons": self.reasons,
        }


# ------------------------------------------------------------------- geo

def haversine_meters(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def extract_video_gps(path: Path | str) -> Optional[tuple[float, float]]:
    """Capture coordinates from video metadata, if the file still carries them.

    iPhone writes `com.apple.quicktime.location.ISO6709`; Android writes
    `location`. Every social platform strips both on upload, so expect this
    only for footage submitted directly through the Divvit app — which is
    precisely the footage where a reward is at stake.
    """
    try:
        proc = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format_tags",
             "-of", "default=nw=1", str(path)],
            capture_output=True, text=True, timeout=60)
    except (subprocess.SubprocessError, OSError):
        return None

    for line in proc.stdout.splitlines():
        if "location" not in line.lower():
            continue
        match = _ISO6709.search(line)
        if match:
            try:
                return float(match.group(1)), float(match.group(2))
            except ValueError:
                continue
    return None


# ---------------------------------------------------------------- visual

class VisualMatcher:
    """Matches reference photos of a venue against an indexed submission.

    Uses TwelveLabs image-query search: submit a photo of the real venue and
    ask which indexed videos look like it. If the submission ranks, the
    footage shows the same place.
    """

    def __init__(self, api_key: str, index_id: str, timeout: int = 120):
        self.api_key = api_key
        self.index_id = index_id
        self.timeout = timeout
        self._session = None

    def available(self) -> bool:
        return bool(self.api_key and self.index_id)

    def _session_or_new(self):
        if self._session is None:
            import requests
            self._session = requests.Session()
            self._session.headers.update({"x-api-key": self.api_key})
        return self._session

    def _search_by_image(self, image_bytes: bytes) -> list[dict[str, Any]]:
        session = self._session_or_new()
        files = {
            "index_id": (None, self.index_id),
            "query_media_type": (None, "image"),
            "query_media_file": ("ref.jpg", image_bytes, "image/jpeg"),
            "search_options": (None, "visual"),
        }
        resp = session.post("https://api.twelvelabs.io/v1.3/search",
                            files=files, timeout=self.timeout)
        if resp.status_code >= 400:
            return []
        return (resp.json() or {}).get("data") or []

    def match(self, fingerprint: VenueFingerprint,
              twelvelabs_video_id: str, max_images: int = 4
              ) -> tuple[Optional[float], str]:
        """Fraction of reference photos that surface this video, weighted by
        how probative each photo kind is. Returns (score, detail)."""
        if not self.available():
            return None, "no TwelveLabs index available"

        images = (fingerprint.images_of(KIND_STOREFRONT, KIND_INTERIOR)
                  or fingerprint.reference_images)[:max_images]
        if not images:
            return None, "no reference images for this venue"

        import requests
        hit_weight = 0.0
        total_weight = 0.0
        checked = 0
        for image in images:
            try:
                if image.local_path and Path(image.local_path).exists():
                    payload = Path(image.local_path).read_bytes()
                else:
                    payload = requests.get(image.url, timeout=self.timeout).content
            except Exception:
                continue
            if not payload:
                continue
            results = self._search_by_image(payload)
            if not results:
                continue
            checked += 1
            total_weight += image.weight()
            top = [r.get("video_id") for r in results[:VISUAL_TOP_N]]
            if twelvelabs_video_id in top:
                # Ranking first is much stronger than scraping into the tail.
                rank = top.index(twelvelabs_video_id)
                hit_weight += image.weight() * (1.0 if rank == 0 else 0.7)

        if not checked or total_weight == 0:
            return None, "reference images unusable"
        return hit_weight / total_weight, f"{checked} reference photo(s) compared"


# ------------------------------------------------------------------ verify

class CrossReferenceVerifier:
    def __init__(self, visual_matcher: Optional[VisualMatcher] = None,
                 verify_threshold: float = VERIFY_THRESHOLD,
                 review_threshold: float = REVIEW_THRESHOLD):
        self.visual = visual_matcher
        self.verify_threshold = verify_threshold
        self.review_threshold = review_threshold

    # -- individual signals ------------------------------------------------
    def _geo_signal(self, video_path: Optional[Path | str],
                    fingerprint: VenueFingerprint) -> Signal:
        s = Signal("geo_proximity", NOT_CHECKED, weight=0.40)
        if not fingerprint.has_geo():
            s.detail = "venue has no coordinates on file"
            return s
        if not video_path:
            s.detail = "no media file to read capture location from"
            return s
        coords = extract_video_gps(video_path)
        if coords is None:
            s.detail = "video carries no capture location (stripped or absent)"
            return s

        distance = haversine_meters(coords[0], coords[1],
                                    fingerprint.latitude, fingerprint.longitude)
        s.detail = f"captured {distance:.0f}m from the venue"
        if distance <= GEO_CONFIRM_METERS:
            s.status, s.score = PASS, 1.0
        elif distance >= GEO_REJECT_METERS:
            s.status, s.score = FAIL, 0.0
        else:
            # Between the two: real but imprecise, or nearby but not inside.
            s.status = PASS
            s.score = 1.0 - (distance - GEO_CONFIRM_METERS) / (
                GEO_REJECT_METERS - GEO_CONFIRM_METERS)
        return s

    def _visual_signal(self, fingerprint: VenueFingerprint,
                       twelvelabs_video_id: Optional[str]) -> Signal:
        s = Signal("visual_reference_match", NOT_CHECKED, weight=0.30)
        if not twelvelabs_video_id:
            s.detail = "submission is not indexed"
            return s
        if self.visual is None:
            s.detail = "no visual matcher configured"
            return s
        score, detail = self.visual.match(fingerprint, twelvelabs_video_id)
        s.detail = detail
        if score is None:
            return s
        s.score = score
        s.status = PASS if score >= 0.5 else FAIL
        return s

    def _signage_signal(self, analysis: dict,
                        fingerprint: VenueFingerprint) -> Signal:
        s = Signal("signage_name", NOT_CHECKED, weight=0.20)
        evidence = [e for e in (analysis.get("venue_evidence") or []) if e]
        if not evidence:
            s.detail = "no venue name visible or spoken"
            return s
        names = [fingerprint.name] + list(fingerprint.aliases)
        best = max((name_similarity(e, n) for e in evidence for n in names
                    if n), default=0.0)
        s.score = best
        s.detail = f"read {evidence[0]!r} (similarity {best:.2f})"
        # A clearly different venue name is evidence AGAINST, not absence.
        s.status = PASS if best >= 0.7 else FAIL
        return s

    def _menu_signal(self, analysis: dict,
                     fingerprint: VenueFingerprint) -> Signal:
        s = Signal("menu_overlap", NOT_CHECKED, weight=0.10)
        detected = [d for d in (analysis.get("detected_items") or []) if d]
        if not detected or not fingerprint.menu_items:
            s.detail = "no menu on file, or nothing identifiable in the video"
            return s
        # Token overlap, not substring. Pegasus describes dishes loosely
        # ("Ice cream with cereal topping") where a menu says "cereal cone" —
        # substring matching misses that, token overlap catches it.
        def content_words(text: str) -> set[str]:
            return {w for w in normalize(text).split()
                    if len(w) > 3 and w not in _MENU_STOPWORDS}

        known = [content_words(m) for m in fingerprint.menu_items]
        known = [k for k in known if k]
        hits = [d for d in detected
                if any(content_words(d) & k for k in known)]
        s.score = min(1.0, len(hits) / 2.0)
        s.detail = (f"matched {', '.join(hits[:3])}" if hits
                    else "no detected dish is on this venue's menu")
        s.status = PASS if hits else FAIL
        return s

    # -- orchestration -----------------------------------------------------
    def verify(self, *, screening: dict, fingerprint: VenueFingerprint,
               video_path: Optional[Path | str] = None,
               twelvelabs_video_id: Optional[str] = None) -> VerificationResult:
        analysis = (screening or {}).get("analysis") or {}

        # Content that is not about food cannot be about this venue.
        if analysis.get("is_food_beverage_content") is False:
            return VerificationResult(
                verdict="rejected", trust_score=0.0,
                reasons=["not food or beverage content"])

        signals = [
            self._geo_signal(video_path, fingerprint),
            self._visual_signal(fingerprint, twelvelabs_video_id),
            self._signage_signal(analysis, fingerprint),
            self._menu_signal(analysis, fingerprint),
        ]

        checked = [s for s in signals if s.checked]
        reasons: list[str] = []

        if not checked:
            return VerificationResult(
                verdict="needs_review", trust_score=0.0, signals=signals,
                reasons=["nothing could be cross-referenced — enrich the "
                         "business profile (coordinates, photos, menu)"])

        # Weighted mean over checked signals only. Unchecked signals are
        # absent evidence, never silent approval.
        total_weight = sum(s.weight for s in checked)
        trust = sum(s.score * s.weight for s in checked) / total_weight

        # A hard geo contradiction is disqualifying on its own: footage shot
        # half a kilometre away is not this venue, whatever else matches.
        geo = signals[0]
        if geo.status == FAIL:
            reasons.append(f"capture location contradicts the venue ({geo.detail})")
            return VerificationResult(verdict="rejected", trust_score=min(trust, 0.2),
                                      signals=signals, reasons=reasons)

        # Likewise a clearly different business name on screen.
        # Below this, the name on screen is a *different* business rather than
        # a damaged read of the right one. Measured: "Bronx Pizza" against
        # "The Cauldron Ice Cream" scores 0.41, so a 0.4 cutoff let an obvious
        # mismatch through to a human queue instead of rejecting it.
        visual, signage = signals[1], signals[2]
        if signage.status == FAIL and signage.score < 0.5:
            reasons.append(f"signage names a different business ({signage.detail})")
            return VerificationResult(verdict="rejected", trust_score=min(trust, 0.3),
                                      signals=signals, reasons=reasons)

        # Two independent checks failing is not a borderline call. A video that
        # neither looks like the venue nor names it is someone else's footage,
        # and sending that to a human queue just launders the decision.
        if visual.status == FAIL and signage.status == FAIL:
            reasons.append(
                "footage does not match the venue's reference photos and the "
                "signage names a different business")
            return VerificationResult(verdict="rejected", trust_score=min(trust, 0.3),
                                      signals=signals, reasons=reasons)

        if analysis.get("quality_flags"):
            flags = [f for f in analysis["quality_flags"]
                     if f in ("likely_repost", "ai_generated", "watermarked")]
            if flags:
                trust *= 0.5
                reasons.append(f"content authenticity flags: {', '.join(flags)}")

        if trust >= self.verify_threshold and len(checked) >= MIN_SIGNALS_FOR_AUTO:
            verdict = "verified"
        elif trust >= self.review_threshold:
            verdict = "needs_review"
            if len(checked) < MIN_SIGNALS_FOR_AUTO:
                reasons.append(
                    f"only {len(checked)} signal(s) could be checked — "
                    f"need {MIN_SIGNALS_FOR_AUTO} to auto-approve")
        else:
            verdict = "needs_review"
            reasons.append("cross-reference evidence too weak to confirm")

        for s in checked:
            reasons.append(f"{s.name}: {s.status} — {s.detail}")

        return VerificationResult(verdict=verdict, trust_score=trust,
                                  signals=signals, reasons=reasons)
