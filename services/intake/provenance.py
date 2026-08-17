"""Provenance gates — has this video been here before, and whose is it?

Two questions, checked in this order because the first is cheaper to explain:

  1. **Duplicate submission.** The fingerprint matches a previous submission.
     Who submitted the original decides what the duplicate means:
       - the SAME submitter: an idempotent resubmit (double-tap, retry after
         a network error, or trying again after a rejection). Reject with
         `duplicate_submission_resubmit` and point at their own earlier
         submission. Not suspicious.
       - a DIFFERENT submitter: someone re-uploading footage another user
         already claimed. Reject with `duplicate_submission_other_user` and
         record both parties — this is the possible-theft case, and if a
         reward was paid on the original, ops needs the pair.

  2. **Known public video.** The fingerprint matches a video Discover
     harvested from public social media. This is NOT a rejection: the
     submitter may well be the original creator bringing their own TikTok to
     Divvit, which is exactly the behaviour the product wants. It goes to
     `needs_review` as `possible_unowned_content`, with the platform URL and
     creator handle attached so ops can check the claim the only way it can
     be checked — does the submitter control that account?

A `near` fingerprint verdict (suspicious distance band, 14-20 bits) routes to
review rather than rejecting: at that distance we are looking at either an
aggressive edit of the same footage or an unlucky pair, and a human should
say which.

Everything here is local math against SQLite — no network, no API spend. The
pipeline runs these before any paid call on purpose.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Optional

from .fingerprint import FingerprintMatch, VideoFingerprint, compare
from .store import IntakeStore

# Gate outcome statuses, shared with the pipeline.
PASS, REJECT, REVIEW, SKIP = "pass", "reject", "review", "skipped"

REASON_RESUBMIT = "duplicate_submission_resubmit"
REASON_OTHER_USER = "duplicate_submission_other_user"
REASON_UNOWNED = "possible_unowned_content"


@dataclass
class GateResult:
    """One gate's verdict, self-describing enough to audit later."""

    gate: str
    status: str                        # pass | reject | review | skipped
    reason: str = ""
    evidence: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {"gate": self.gate, "status": self.status,
                "reason": self.reason, "evidence": self.evidence}


def _match_evidence(match: FingerprintMatch) -> dict[str, Any]:
    return {"distance_bits": match.distance, "exact_bytes": match.exact,
            "fingerprint_verdict": match.verdict}


def check_duplicate(fingerprint: VideoFingerprint, store: IntakeStore,
                    submitter_id: str) -> GateResult:
    """Compare against every prior submission; earliest match wins.

    Oldest-first matters: if the same footage was submitted three times, the
    duplicate is attributed to the FIRST submission — that is the claim with
    priority, and the one a reward would have been paid against.
    """
    priors = store.fingerprinted_submissions()
    best: Optional[tuple[FingerprintMatch, dict[str, Any]]] = None
    for prior in priors:
        match = compare(fingerprint, prior["fingerprint"])
        if match.verdict == "distinct":
            continue
        if best is None or match.distance < best[0].distance:
            best = (match, prior)
            if match.exact:
                break  # cannot beat byte-identity

    if best is None:
        return GateResult("duplicate_submission", PASS,
                          evidence={"prior_submissions_checked": len(priors)})

    match, prior = best
    evidence = {
        **_match_evidence(match),
        "matched_submission_id": prior["submission_id"],
        "matched_submitter_id": prior["submitter_id"],
        "matched_claimed_business": prior.get("claimed_business"),
        "matched_at": prior.get("created_at"),
    }

    if match.verdict == "near":
        return GateResult(
            "duplicate_submission", REVIEW, reason="near_duplicate_submission",
            evidence=evidence)

    if prior["submitter_id"] == submitter_id:
        return GateResult("duplicate_submission", REJECT,
                          reason=REASON_RESUBMIT, evidence=evidence)

    evidence["possible_theft"] = True
    return GateResult("duplicate_submission", REJECT,
                      reason=REASON_OTHER_USER, evidence=evidence)


def check_public_corpus(fingerprint: VideoFingerprint,
                        store: IntakeStore) -> GateResult:
    """Compare against fingerprints of known public videos.

    A match is never an auto-reject: the likeliest honest explanation is the
    creator submitting their own public post. The gate's job is to make sure
    that claim gets CHECKED rather than assumed, and to hand ops what the
    check needs: the platform URL and the handle that posted it.
    """
    rows = store.corpus_fingerprints()
    if not rows:
        return GateResult("public_corpus", PASS,
                          evidence={"corpus_size": 0,
                                    "note": "no public fingerprints indexed"})

    best: Optional[tuple[FingerprintMatch, dict[str, Any]]] = None
    for row in rows:
        match = compare(fingerprint, row["fingerprint"])
        if match.verdict == "distinct":
            continue
        if best is None or match.distance < best[0].distance:
            best = (match, row)
            if match.exact:
                break

    if best is None:
        return GateResult("public_corpus", PASS,
                          evidence={"corpus_size": len(rows)})

    match, row = best
    return GateResult(
        "public_corpus", REVIEW, reason=REASON_UNOWNED,
        evidence={
            **_match_evidence(match),
            "matched_url": row.get("url"),
            "matched_platform": row.get("platform"),
            "matched_creator_handle": row.get("creator_handle"),
            "matched_title": row.get("title"),
            "ops_check": ("verify the submitter controls "
                          f"{row.get('creator_handle') or 'the source account'}"
                          f" on {row.get('platform') or 'the platform'}"),
        })
