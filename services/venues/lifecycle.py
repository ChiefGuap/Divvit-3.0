"""Roster lifecycle — deciding which OSM cafes are still real businesses.

## Why

The roster comes from OpenStreetMap, and OSM has no concept of a business
closing. A cafe shuts, the sign comes down, and the node stays exactly where a
mapper left it in 2019. Measured on the Orange County roster (2026-08-19),
88 of 359 independents could not be given a review signal for reasons that all
point the same way:

  * **70** — Google's nearest same-name match sat further than the 400m drift
    gate allows, *with the OSM node already passed as a 5km location bias*.
    That is not a matching bug. Google has no business of that name near that
    point.
  * **18** — Google reports `CLOSED_PERMANENTLY` or `CLOSED_TEMPORARILY`.

Carrying those as permanently "unmeasurable" is the wrong shape twice over.
They pollute the pending queues, so every future pass re-attempts them; and a
closed cafe that later picked up a video signal could walk into a prospect
ranking. Showing a cafe owner a league table with a shuttered competitor on it
is the kind of error that ends a sales conversation.

## What this module does not do

It does not delete anything. `status` is an additive column, the evidence and
the date travel with it, and `--include-inactive` brings the full roster back.
"Which cafes did we retire and why" has to stay answerable — that is the
difference between a finding and a lost row.

## The states, and why there are three

`closed` and `unverifiable` are both excluded from ranking, but they are not
the same claim and must not be collapsed:

    closed         Google's first-party `businessStatus` says the business is
                   not trading. Confidence `high` for CLOSED_PERMANENTLY,
                   `medium` for CLOSED_TEMPORARILY — temporary closures
                   reverse, and a cafe that reopens should re-enter the roster
                   on the next assessment rather than stay retired.

    unverifiable   We looked and could not confirm a business of that name
                   exists at that point. Consistent with a quiet closure or a
                   rename; also consistent with a cafe Google simply lists
                   under a different name. Confidence `low`, always. This is
                   an admission about our evidence, not a claim about the
                   cafe.

    active         No contrary evidence — either we have a live review signal
                   for it, or nothing has said otherwise. The default.

## Cost

Assessment reads the evidence already stored on `cafe_signals` first. A cafe
with a stored Google signal is `active` with no lookup at all. Only cafes
whose recorded reason is missing (an earlier pass overwrote `errors` on its
next write) fall through to `PlacesClient.find()`, and that is served from the
on-disk query+bias cache — measured at 0 billed calls on the first live run.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from dataclasses import dataclass, field, asdict
from typing import Any, Callable, Optional

from .roster import (CafeRecord, STATUS_ACTIVE, STATUS_CLOSED,
                     STATUS_UNVERIFIABLE)

# Google's non-operational businessStatus values, and how much we trust each
# as a retirement decision.
CLOSED_STATUS_CONFIDENCE = {
    "CLOSED_PERMANENTLY": "high",
    "CLOSED_TEMPORARILY": "medium",
}

# A drift refusal or an empty result set is never better than a weak signal:
# absence of evidence, recorded as such.
UNVERIFIABLE_CONFIDENCE = "low"

_DRIFT_RE = re.compile(r"matched '(?P<name>.*?)'\s+(?P<metres>[0-9.]+)m away")
_CLOSED_RE = re.compile(r"'(?P<name>.*?)' is (?P<status>CLOSED_[A-Z_]+)")


def _utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class Verdict:
    """One lifecycle assessment: the state, how sure we are, why, and what we
    actually saw. The evidence is the point — a bare state is an assertion
    nobody downstream can check or overturn."""

    status: str
    confidence: str
    reason: str
    evidence: dict[str, Any] = field(default_factory=dict)

    @property
    def is_active(self) -> bool:
        return self.status == STATUS_ACTIVE

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


ACTIVE_NO_EVIDENCE = Verdict(
    status=STATUS_ACTIVE, confidence="low",
    reason="no contrary evidence — never assessed against a review source",
    evidence={"source": "none"})


# ------------------------------------------------------- evidence readers

def verdict_from_match(match: Any, reason: Optional[str]) -> Verdict:
    """`PlacesClient.find()`'s (match, rejection-reason) -> a Verdict.

    Note the case that looks like a failure and is not: a match that is
    operational but carries no rating yet. `collect_places` returns None for
    it because there is no *review signal*, but the identity check passed and
    Google says it is trading. A brand-new cafe nobody has reviewed is the
    most active thing on the roster.
    """
    if match is not None:
        status_text = getattr(match, "business_status", "") or ""
        if status_text in CLOSED_STATUS_CONFIDENCE:
            return Verdict(
                status=STATUS_CLOSED,
                confidence=CLOSED_STATUS_CONFIDENCE[status_text],
                reason=(f"Google reports '{match.name}' as {status_text}"),
                evidence={"source": "google_places",
                          "business_status": status_text,
                          "matched_name": match.name,
                          "place_id": getattr(match, "place_id", None),
                          "distance_m": getattr(match, "distance_m", None)})
        return Verdict(
            status=STATUS_ACTIVE, confidence="high",
            reason=f"Google lists '{match.name}' as {status_text or 'present'}"
                   " at this location",
            evidence={"source": "google_places",
                      "business_status": status_text or None,
                      "matched_name": match.name,
                      "place_id": getattr(match, "place_id", None),
                      "distance_m": getattr(match, "distance_m", None),
                      "rating": getattr(match, "rating", None)})
    return verdict_from_reason(reason)


def verdict_from_reason(reason: Optional[str]) -> Verdict:
    """Parse a stored `cafe_signals.errors` string into a Verdict.

    These strings are what the live passes already wrote, so this replays the
    original finding without re-querying anything. Anything unrecognised
    returns `active` — an unparsed string is our problem, not evidence that a
    cafe closed, and defaulting the other way would retire real prospects.
    """
    text = (reason or "").strip()
    if not text:
        return ACTIVE_NO_EVIDENCE

    closed = _CLOSED_RE.search(text)
    if closed:
        status_text = closed.group("status")
        return Verdict(
            status=STATUS_CLOSED,
            confidence=CLOSED_STATUS_CONFIDENCE.get(status_text, "medium"),
            reason=f"Google reports '{closed.group('name')}' as {status_text}",
            evidence={"source": "google_places",
                      "business_status": status_text,
                      "matched_name": closed.group("name"),
                      "recorded_reason": text})

    drift = _DRIFT_RE.search(text)
    if drift:
        try:
            metres = round(float(drift.group("metres")), 1)
        except ValueError:
            metres = None
        return Verdict(
            status=STATUS_UNVERIFIABLE,
            confidence=UNVERIFIABLE_CONFIDENCE,
            reason=("no business of this name near the OSM node — nearest "
                    f"same-name match '{drift.group('name')}' is {metres}m "
                    "away, past the 400m drift gate, with the node already "
                    "applied as a location bias"),
            evidence={"source": "google_places",
                      "rejected_match": drift.group("name"),
                      "distance_m": metres,
                      "location_bias_applied": True,
                      "recorded_reason": text})

    if "no result" in text:
        return Verdict(
            status=STATUS_UNVERIFIABLE,
            confidence=UNVERIFIABLE_CONFIDENCE,
            reason="Google Places returned no business for this name and city",
            evidence={"source": "google_places", "result_count": 0,
                      "recorded_reason": text})

    if "no ratings yet" in text:
        # Found, operational, simply unrated. Emphatically active.
        return Verdict(
            status=STATUS_ACTIVE, confidence="high",
            reason="listed on Google and trading, with no ratings yet",
            evidence={"source": "google_places", "rating": None,
                      "recorded_reason": text})

    return Verdict(status=STATUS_ACTIVE, confidence="low",
                   reason="no contrary evidence in the recorded reason",
                   evidence={"source": "cafe_signals",
                             "recorded_reason": text})


def _places_reasons(signals: Optional[dict[str, Any]]) -> list[str]:
    errors = (signals or {}).get("errors") or []
    if isinstance(errors, str):
        errors = [errors]
    return [e for e in errors if isinstance(e, str) and e.startswith("places:")]


def assess_cafe(cafe: CafeRecord, signals: Optional[dict[str, Any]],
                places_client: Any = None) -> Verdict:
    """Decide one cafe's lifecycle state from the cheapest evidence available.

    Order matters, and it is an order of cost as well as of authority:

      1. A stored Google review signal — Google answered about this business,
         so it exists. No call.
      2. A stored `places:` rejection reason — replay the original finding.
         No call.
      3. A Places lookup, if a client was supplied. Served from the query+bias
         cache for anything a previous pass already touched, so this is
         normally free too. Reached only when (2) was clobbered by a later
         write to the same `errors` column.
      4. Nothing to go on -> active. Absence of evidence never retires a cafe.
    """
    google = (signals or {}).get("google")
    if google:
        status_text = google.get("business_status") or ""
        if status_text in CLOSED_STATUS_CONFIDENCE:
            return Verdict(
                status=STATUS_CLOSED,
                confidence=CLOSED_STATUS_CONFIDENCE[status_text],
                reason=f"Google reports this business as {status_text}",
                evidence={"source": "cafe_signals.google",
                          "business_status": status_text,
                          "place_id": google.get("place_id"),
                          "matched_name": google.get("matched_name")})
        return Verdict(
            status=STATUS_ACTIVE, confidence="high",
            reason=("a Google review signal is attached, so the business is "
                    "listed and trading"),
            evidence={"source": "cafe_signals.google",
                      "place_id": google.get("place_id"),
                      "matched_name": google.get("matched_name"),
                      "rating": google.get("rating"),
                      "review_count": google.get("review_count")})

    reasons = _places_reasons(signals)
    if reasons:
        # Last reason wins: it is the most recent attempt.
        return verdict_from_reason(reasons[-1])

    if places_client is not None:
        match, reason = places_client.find(
            cafe.name, city=cafe.city, latitude=cafe.lat, longitude=cafe.lon)
        return verdict_from_match(match, reason)

    return ACTIVE_NO_EVIDENCE


# ------------------------------------------------------------- the pass

def run_lifecycle_pass(roster: Any, places_client: Any = None,
                       limit: Optional[int] = None,
                       dry_run: bool = False,
                       on_status: Callable[[str], None] = lambda _: None,
                       now: str = "") -> dict[str, Any]:
    """Assess every independent on the roster and persist the verdicts.

    Idempotent by construction: the verdict is a pure function of the stored
    evidence, so re-running produces the same states. Transitions are counted
    and returned, which is how a run reports "3 cafes reopened" rather than
    only ever reporting retirements.
    """
    checked_at = now or _utcnow()
    signals = roster.all_signals()
    cafes = roster.cafes(include_inactive=True, limit=limit)

    tally: dict[str, Any] = {
        "assessed": 0, "changed": 0, "unchanged": 0,
        STATUS_ACTIVE: 0, STATUS_CLOSED: 0, STATUS_UNVERIFIABLE: 0,
        "transitions": {}, "reactivated": 0, "retired": 0,
    }
    for cafe in cafes:
        verdict = assess_cafe(cafe, signals.get(cafe.cafe_id), places_client)
        tally["assessed"] += 1
        tally[verdict.status] += 1

        before = cafe.status or STATUS_ACTIVE
        if before != verdict.status:
            tally["changed"] += 1
            key = f"{before}->{verdict.status}"
            tally["transitions"][key] = tally["transitions"].get(key, 0) + 1
            if verdict.status == STATUS_ACTIVE:
                tally["reactivated"] += 1
            else:
                tally["retired"] += 1
            on_status(f"  {before} -> {verdict.status:<12} {cafe.name} "
                      f"— {verdict.reason}")
        else:
            tally["unchanged"] += 1

        if not dry_run:
            roster.set_status(cafe.cafe_id, verdict.status,
                              confidence=verdict.confidence,
                              reason=verdict.reason,
                              evidence=verdict.evidence,
                              checked_at=checked_at)
    return tally
