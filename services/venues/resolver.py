"""Venue resolution — "CALDROWN ICE CREAM" -> a business_id.

Screening reads venue names off signage, cups and speech. Those strings are
noisy in a specific way: they come from a model reading pixels, so they contain
OCR-style errors ("CALDROWN" for "Cauldron"), inconsistent casing, and partial
names ("Ruffin" for "Pizza by Ruffin"). Exact matching fails on all of it.

This is open-set identification: the right answer is often *no business in our
catalog*, and saying so confidently matters more than forcing a match. A wrong
attach puts someone else's video on a business's dashboard and, if a reward is
attached, pays a user for footage of a competitor.

Scoring combines a fuzzy name score with independent corroboration — city,
menu items, cuisine — because name similarity alone is not enough to justify
attaching a video to a paying customer's account.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field, asdict
from difflib import SequenceMatcher
from typing import Any, Optional

from .catalog import BusinessCatalog, BusinessRecord

# Words that carry no identifying signal — every third cafe has them, so
# leaving them in inflates similarity between unrelated venues.
_STOPWORDS = {
    "the", "a", "an", "and", "of", "at", "on", "in",
    "cafe", "café", "coffee", "restaurant", "kitchen", "bar", "grill",
    "eatery", "bistro", "shop", "house", "co", "company", "llc", "inc",
    "ltd", "and", "&",
}

_PUNCT = re.compile(r"[^\w\s]")
_SPACE = re.compile(r"\s+")

# Verdict thresholds. Deliberately conservative: the cost of a wrong attach is
# higher than the cost of a human glance at an ops queue.
CONFIRM_THRESHOLD = 0.86
REVIEW_THRESHOLD = 0.62


def normalize(text: str) -> str:
    lowered = _PUNCT.sub(" ", (text or "").lower())
    return _SPACE.sub(" ", lowered).strip()


def content_tokens(text: str) -> list[str]:
    """Normalized tokens with generic venue words removed.

    Falls back to all tokens when stripping would leave nothing — a business
    genuinely called "The Coffee House" must still be matchable.
    """
    tokens = [t for t in normalize(text).split() if t]
    stripped = [t for t in tokens if t not in _STOPWORDS]
    return stripped or tokens


def _ratio(a: str, b: str) -> float:
    return SequenceMatcher(None, a, b).ratio()


def name_similarity(evidence: str, candidate: str) -> float:
    """OCR-tolerant similarity between a read name and a catalog name.

    Three views, best wins:
      * whole normalized string — catches transpositions and dropped letters
      * token alignment — each evidence token matched to its best counterpart,
        so word order and extra words ("Pizza by Ruffin" vs "Ruffin") survive
      * containment — a partial read that is a clean substring of the real name
    """
    ev_tokens = content_tokens(evidence)
    cand_tokens = content_tokens(candidate)
    if not ev_tokens or not cand_tokens:
        return 0.0

    ev_joined = " ".join(ev_tokens)
    cand_joined = " ".join(cand_tokens)

    whole = _ratio(ev_joined, cand_joined)

    # Token alignment, weighted by token length so "cauldron" counts for more
    # than "ice" when deciding whether two names refer to the same venue.
    total_weight = 0.0
    weighted = 0.0
    for token in ev_tokens:
        best = max((_ratio(token, other) for other in cand_tokens), default=0.0)
        weight = len(token)
        weighted += best * weight
        total_weight += weight
    aligned = weighted / total_weight if total_weight else 0.0

    # One name fully contained in the other (a sign showing only part of it).
    containment = 0.0
    if ev_joined and cand_joined:
        if ev_joined in cand_joined or cand_joined in ev_joined:
            shorter, longer = sorted((ev_joined, cand_joined), key=len)
            containment = 0.75 + 0.25 * (len(shorter) / len(longer))

    return max(whole, aligned, containment)


@dataclass
class VenueMatch:
    business_id: str
    business_name: str
    evidence: str            # the raw string that matched
    score: float
    name_score: float
    verdict: str             # confirmed | needs_review | unknown
    signals: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class ResolutionResult:
    verdict: str                          # confirmed | needs_review | unknown
    best: Optional[VenueMatch] = None
    alternatives: list[VenueMatch] = field(default_factory=list)
    # A ranking video featuring five restaurants is genuinely about all five.
    # `exclusive=False` says: show it on each one's dashboard as a mention, but
    # do not present it to any of them as content made about them alone.
    multi_venue: bool = False
    exclusive: bool = True
    unresolved_evidence: list[str] = field(default_factory=list)

    def matched_business_ids(self) -> list[str]:
        """Every business this video should surface for."""
        ids = [self.best.business_id] if self.best else []
        return ids + [m.business_id for m in self.alternatives]

    def to_dict(self) -> dict[str, Any]:
        return {
            "verdict": self.verdict,
            "best": self.best.to_dict() if self.best else None,
            "alternatives": [m.to_dict() for m in self.alternatives],
            "multi_venue": self.multi_venue,
            "exclusive": self.exclusive,
            "matched_business_ids": self.matched_business_ids(),
            "unresolved_evidence": self.unresolved_evidence,
        }


def _corroborate(record: BusinessRecord, detected_items: list[str],
                 city: str, cuisine: str) -> tuple[float, list[str]]:
    """Independent evidence that this is the right business.

    Name similarity can be coincidental; a menu match is not. Capped so
    corroboration can rescue a slightly-misread name but never manufacture a
    match on its own.
    """
    bonus, signals = 0.0, []

    if city and record.city and normalize(city) in normalize(record.city):
        bonus += 0.10
        signals.append(f"city:{record.city}")

    if detected_items and record.menu_items:
        known = {normalize(m) for m in record.menu_items}
        hits = [d for d in detected_items
                if any(normalize(d) in k or k in normalize(d) for k in known)]
        if hits:
            bonus += min(0.12, 0.06 * len(hits))
            signals.append(f"menu:{','.join(hits[:3])}")

    if cuisine and record.cuisine:
        if normalize(cuisine) in normalize(record.cuisine) or \
                normalize(record.cuisine) in normalize(cuisine):
            bonus += 0.04
            signals.append(f"cuisine:{record.cuisine}")

    if record.is_partner:
        # A tiebreak, not evidence — small enough that it can never flip a
        # non-match into a match.
        bonus += 0.02
        signals.append("partner")

    return bonus, signals


class VenueResolver:
    def __init__(self, catalog: BusinessCatalog,
                 confirm_threshold: float = CONFIRM_THRESHOLD,
                 review_threshold: float = REVIEW_THRESHOLD):
        self.catalog = catalog
        self.confirm_threshold = confirm_threshold
        self.review_threshold = review_threshold

    def resolve(self, venue_evidence: list[str], *,
                detected_items: Optional[list[str]] = None,
                city: str = "", cuisine: str = "") -> ResolutionResult:
        """Match screening's venue evidence against the catalog."""
        evidence = [e for e in (venue_evidence or []) if e and e.strip()]
        if not evidence:
            return ResolutionResult(verdict="unknown")

        candidates = self.catalog.in_city(city) or self.catalog.records
        detected_items = detected_items or []

        matches: list[VenueMatch] = []
        for record in candidates:
            best_name_score, best_evidence = 0.0, ""
            for ev in evidence:
                for candidate_name in record.all_names():
                    score = name_similarity(ev, candidate_name)
                    if score > best_name_score:
                        best_name_score, best_evidence = score, ev
            if best_name_score < 0.4:
                continue

            bonus, signals = _corroborate(record, detected_items, city, cuisine)
            # Scale corroboration into the headroom above the name score rather
            # than adding it flat. Flat addition saturates at 1.0 and destroys
            # the ordering between candidates — exactly what we need to detect
            # an ambiguous match.
            total = best_name_score + bonus * (1.0 - best_name_score)
            matches.append(VenueMatch(
                business_id=record.business_id, business_name=record.name,
                evidence=best_evidence, score=round(total, 3),
                name_score=round(best_name_score, 3),
                verdict="", signals=signals))

        matches.sort(key=lambda m: m.score, reverse=True)
        if not matches:
            return ResolutionResult(verdict="unknown",
                                    unresolved_evidence=evidence)

        best = matches[0]
        if best.score >= self.confirm_threshold:
            best.verdict = "confirmed"
        elif best.score >= self.review_threshold:
            best.verdict = "needs_review"
        else:
            best.verdict = "unknown"

        # Which evidence strings did nothing resolve to?
        resolved = {m.evidence for m in matches if m.score >= self.review_threshold}
        unresolved = [e for e in evidence if e not in resolved]

        # Multi-venue means distinct businesses matched from *distinct* pieces
        # of evidence. Two spellings of one sign is still one venue; two
        # different restaurant names is a ranking video.
        others = [m for m in matches[1:6]
                  if m.score >= self.review_threshold and m.evidence != best.evidence]
        multi_venue = len(others) >= 1

        for m in others:
            m.verdict = "confirmed" if m.score >= self.confirm_threshold else "needs_review"

        # Two near-equal candidates for the SAME evidence string is genuine
        # ambiguity ("which Cauldron?") and needs a human. Two high scores from
        # different strings is just a video featuring two venues — not
        # ambiguous at all, so the downgrade must not fire there.
        if best.verdict == "confirmed" and not multi_venue:
            rival = next((m for m in matches[1:] if m.evidence == best.evidence), None)
            if rival and best.score - rival.score < 0.06:
                best.verdict = "needs_review"
                best.signals.append(f"ambiguous_with:{rival.business_name}")

        return ResolutionResult(
            verdict=best.verdict,
            best=best if best.verdict != "unknown" else None,
            alternatives=others[:4],
            multi_venue=multi_venue,
            exclusive=not multi_venue,
            unresolved_evidence=unresolved,
        )


def resolve_from_screening(screening: dict, catalog: BusinessCatalog, *,
                           city: str = "", cuisine: str = "",
                           resolver: Optional["VenueResolver"] = None
                           ) -> ResolutionResult:
    """Resolve straight from a screening payload.

    The one entry point the submission pipeline needs: hand it what screening
    returned and get back which businesses the video belongs to. Content that
    failed screening never reaches resolution — there is no venue to find in a
    video that is not about food.
    """
    analysis = (screening or {}).get("analysis") or {}
    if not analysis.get("is_food_beverage_content", True):
        return ResolutionResult(verdict="unknown")
    resolver = resolver or VenueResolver(catalog)
    return resolver.resolve(
        analysis.get("venue_evidence") or [],
        detected_items=analysis.get("detected_items") or [],
        city=city, cuisine=cuisine)
