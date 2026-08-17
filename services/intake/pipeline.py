"""The intake pipeline — one entry point, gates in cost order.

    submit(file, submitter_id, claimed_business, claimed_location)
      1. fingerprint the file            local, free
      2. duplicate-submission gate       local, free
      3. public-corpus (theft) gate      local, free
      4. venue verification              ONE paid Pegasus call

The ordering is the budget policy: a duplicate or a suspected re-upload never
costs an API call, because gates 2 and 3 resolve the submission before gate 4
runs. When an early gate ends the run, the later gates are recorded as
`skipped` rather than omitted — an audit of any submission shows every gate
and what it did, including "nothing, deliberately".

Every submission is persisted whatever its outcome. Rejections especially:
the account that trips the theft gate three times with three different
re-encodes of the same video is a pattern the store must be able to show.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Optional

from .fingerprint import FingerprintError, VideoFingerprint, fingerprint_file
from .provenance import (GateResult, PASS, REJECT, REVIEW, SKIP,
                         check_duplicate, check_public_corpus)
from .store import IntakeStore
from .venue_check import VenueGate

VERDICT_APPROVED = "approved_for_collection"
VERDICT_REVIEW = "needs_review"
VERDICT_REJECTED = "rejected"
VERDICT_UNSCREENABLE = "unscreenable"


@dataclass
class SubmissionOutcome:
    submission_id: str
    verdict: str
    reasons: list[str]
    gates: list[GateResult] = field(default_factory=list)
    screening: Optional[dict[str, Any]] = None
    fingerprint: Optional[VideoFingerprint] = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "submission_id": self.submission_id,
            "verdict": self.verdict,
            "reasons": self.reasons,
            "gates": [g.to_dict() for g in self.gates],
            "screening": self.screening,
        }


class IntakePipeline:
    def __init__(self, store: IntakeStore,
                 venue_gate: Optional[VenueGate] = None,
                 on_status: Callable[[str], None] = print):
        self.store = store
        self.venue_gate = venue_gate or VenueGate()
        self.on_status = on_status

    # ------------------------------------------------------------ the gates
    def submit(self, file_path: Path | str, submitter_id: str,
               claimed_business: str, claimed_location: str = "",
               ) -> SubmissionOutcome:
        file_path = Path(file_path)
        gates: list[GateResult] = []

        def finish(verdict: str, reasons: list[str],
                   fingerprint: Optional[VideoFingerprint],
                   screening: Optional[dict[str, Any]] = None,
                   ) -> SubmissionOutcome:
            # Gates that never ran are recorded as skipped, in order.
            ran = {g.gate for g in gates}
            for name in ("fingerprint", "duplicate_submission",
                         "public_corpus", "venue_verification"):
                if name not in ran:
                    gates.append(GateResult(
                        name, SKIP,
                        reason="not reached — an earlier gate decided"))
            submission_id = self.store.record_submission(
                submitter_id=submitter_id,
                claimed_business=claimed_business,
                claimed_location=claimed_location,
                file_name=file_path.name,
                fingerprint=fingerprint,
                gates=[g.to_dict() for g in gates],
                verdict=verdict, reasons=reasons, screening=screening)
            self.on_status(f"[intake] {submission_id}: {verdict} "
                           f"({'; '.join(reasons) or 'clean'})")
            return SubmissionOutcome(submission_id, verdict, reasons,
                                     gates, screening, fingerprint)

        # 1 — fingerprint (also validates the file is a readable video)
        try:
            fingerprint = fingerprint_file(file_path)
        except FingerprintError as exc:
            gates.append(GateResult("fingerprint", REJECT,
                                    reason="unreadable_file",
                                    evidence={"error": str(exc)}))
            return finish(VERDICT_UNSCREENABLE, [f"unreadable file: {exc}"],
                          None)
        gates.append(GateResult(
            "fingerprint", PASS,
            evidence={"frames": fingerprint.n_frames,
                      "duration_seconds": round(fingerprint.duration_seconds, 2),
                      "flat_fraction": round(fingerprint.flat_fraction, 3),
                      "sha256": fingerprint.sha256[:16]}))

        # 2 — duplicate of a previous submission?
        dup = check_duplicate(fingerprint, self.store, submitter_id)
        gates.append(dup)
        if dup.status == REJECT:
            return finish(VERDICT_REJECTED, [dup.reason], fingerprint)
        if dup.status == REVIEW:
            return finish(VERDICT_REVIEW, [dup.reason], fingerprint)

        # 3 — matches a video already public on another platform?
        corpus = check_public_corpus(fingerprint, self.store)
        gates.append(corpus)
        if corpus.status == REVIEW:
            # Possible unowned content: the paid call is withheld until a
            # human settles ownership — no reason to spend on footage we may
            # not be allowed to use.
            return finish(VERDICT_REVIEW, [corpus.reason], fingerprint)

        # 4 — the one paid call: is it about the claimed venue?
        venue, screening = self.venue_gate.check(
            file_path, claimed_business, claimed_location)
        gates.append(venue)
        verdict = {PASS: VERDICT_APPROVED, REVIEW: VERDICT_REVIEW,
                   REJECT: VERDICT_REJECTED}[venue.status]
        reasons = (screening or {}).get("reasons") or [venue.reason]
        return finish(verdict, reasons, fingerprint, screening)

    # ------------------------------------------------------------- utilities
    def check_dupe(self, file_path: Path | str,
                   submitter_id: str = "") -> dict[str, Any]:
        """Dry-run of the free gates only — never spends anything."""
        fingerprint = fingerprint_file(file_path)
        dup = check_duplicate(fingerprint, self.store, submitter_id)
        corpus = check_public_corpus(fingerprint, self.store)
        return {"file": str(file_path),
                "duplicate_submission": dup.to_dict(),
                "public_corpus": corpus.to_dict()}
