"""Upload verification for the Screening service.

Three gates between "a user pressed upload" and "we spend money analyzing it":

  1. fingerprint.py  — perceptual dedupe (same video, re-encoded or trimmed)
  2. provenance.py   — duplicate-submission and stolen-content checks
  3. venue_check.py  — is the video actually about the claimed venue

pipeline.py runs them in cost order: every free local check fires before the
first paid API call.
"""

from .fingerprint import VideoFingerprint, fingerprint_file, fingerprint_distance
from .store import IntakeStore
from .pipeline import IntakePipeline, SubmissionOutcome
from .venue_check import DirectScreener, VenueGate

__all__ = ["VideoFingerprint", "fingerprint_file", "fingerprint_distance",
           "IntakeStore", "IntakePipeline", "SubmissionOutcome",
           "DirectScreener", "VenueGate"]
