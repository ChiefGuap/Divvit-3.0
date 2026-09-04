"""Turning a pasted link into a decided claim.

`gates.py` is deliberately pure — it judges data handed to it. This module is
the part that touches the world: it pulls the fingerprint taken at screening,
downloads the platform's cover frame, runs the gates, and records the outcome.

Three things live here that the pure layer cannot know about:

**The claims table.** A post id can only be claimed once. Without that, the
same link pays out repeatedly, which is a cheaper attack than anything the
five gates are looking for.

**The T+7 re-check.** Approved claims are re-examined a week later; if the
post is gone we claw back. Paying for posts that live ninety seconds is the
cheapest attack in the system, and gate 1 already knows how to detect it.

**Cover download.** Fetched to a temp file and deleted straight after. It is
the only piece of media the platform will give us, and it exists only to
answer "is this the video we screened?"
"""

from __future__ import annotations

import json
import sqlite3
import tempfile
import urllib.error
import urllib.request
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterator, Optional

from services.intake.fingerprint import CoverMatch, VideoFingerprint, cover_match
from services.intake.store import IntakeStore

from .accounts import AccountStore

from .gates import (APPROVE, APPROVE_SOFT, ClaimResult, GateOutcome, FAIL,
                    NODATA, RECHECK_AFTER_DAYS, SKIPPED, TIERS, route,
                    verify_claim)
from .links import LinkError, USER_AGENT, resolve as resolve_link

DEFAULT_DB = Path("data/claims.db")

_SCHEMA = """
CREATE TABLE IF NOT EXISTS claims (
    claim_id       TEXT PRIMARY KEY,
    platform       TEXT NOT NULL,
    post_id        TEXT NOT NULL,
    submitter_id   TEXT NOT NULL,
    submission_id  TEXT,              -- the in-app screening this claims against
    tier           INTEGER NOT NULL,
    verdict        TEXT NOT NULL,
    gates          TEXT,              -- JSON array
    post           TEXT,              -- JSON metadata as fetched
    soft_passes    TEXT,              -- JSON array
    created_at     TEXT NOT NULL,
    recheck_at     TEXT,              -- set only for paid claims
    recheck_status TEXT               -- null | ok | clawed_back
);
-- One payout per post, enforced by the database rather than by a check that
-- could be raced by two requests arriving together.
CREATE UNIQUE INDEX IF NOT EXISTS idx_claim_post ON claims(platform, post_id);
CREATE INDEX IF NOT EXISTS idx_claim_submitter ON claims(submitter_id);
CREATE INDEX IF NOT EXISTS idx_claim_recheck   ON claims(recheck_at);
"""

PAID_VERDICTS = (APPROVE, APPROVE_SOFT)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class ClaimStore:
    def __init__(self, path: Path | str = DEFAULT_DB) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self._conn() as conn:
            conn.executescript(_SCHEMA)

    @contextmanager
    def _conn(self) -> Iterator[sqlite3.Connection]:
        conn = sqlite3.connect(self.path)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
            conn.commit()
        finally:
            conn.close()

    def prior_claim(self, platform: str, post_id: str) -> Optional[dict[str, Any]]:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT * FROM claims WHERE platform=? AND post_id=?",
                (platform, post_id)).fetchone()
        return dict(row) if row else None

    def record(self, claim_id: str, platform: str, post_id: str,
               submitter_id: str, submission_id: Optional[str], tier: int,
               result: ClaimResult, now: Optional[datetime] = None) -> None:
        """`now` is injectable so the re-check schedule is testable. Taking it
        from the wall clock made the payout window untestable, which for a
        clawback deadline is exactly the wrong thing to leave unverified."""
        stamp = now or datetime.now(timezone.utc)
        recheck = None
        if result.verdict in PAID_VERDICTS:
            recheck = (stamp + timedelta(days=RECHECK_AFTER_DAYS)).isoformat()
        with self._conn() as conn:
            conn.execute(
                "INSERT OR REPLACE INTO claims (claim_id, platform, post_id,"
                " submitter_id, submission_id, tier, verdict, gates, post,"
                " soft_passes, created_at, recheck_at, recheck_status)"
                " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NULL)",
                (claim_id, platform, post_id, submitter_id, submission_id, tier,
                 result.verdict, json.dumps([g.to_dict() for g in result.gates]),
                 json.dumps(result.post), json.dumps(result.soft_passes),
                 stamp.isoformat(), recheck))

    def due_for_recheck(self, now: Optional[datetime] = None) -> list[dict[str, Any]]:
        now = now or datetime.now(timezone.utc)
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT * FROM claims WHERE recheck_at IS NOT NULL"
                " AND recheck_status IS NULL AND recheck_at <= ?"
                " ORDER BY recheck_at ASC", (now.isoformat(),)).fetchall()
        return [dict(r) for r in rows]

    def mark_recheck(self, claim_id: str, status: str) -> None:
        with self._conn() as conn:
            conn.execute("UPDATE claims SET recheck_status=? WHERE claim_id=?",
                         (status, claim_id))

    def claims(self, limit: int = 50) -> list[dict[str, Any]]:
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT * FROM claims ORDER BY created_at DESC LIMIT ?",
                (limit,)).fetchall()
        return [dict(r) for r in rows]

    def counts(self) -> dict[str, Any]:
        with self._conn() as conn:
            total = conn.execute("SELECT COUNT(*) FROM claims").fetchone()[0]
            by = conn.execute(
                "SELECT verdict, COUNT(*) c FROM claims GROUP BY verdict").fetchall()
            due = conn.execute(
                "SELECT COUNT(*) FROM claims WHERE recheck_at IS NOT NULL"
                " AND recheck_status IS NULL").fetchone()[0]
        return {"claims": total, "by_verdict": {r["verdict"]: r["c"] for r in by},
                "awaiting_recheck": due}


# ----------------------------------------------------------------- cover

def download_cover(url: str, timeout: int = 30) -> Optional[Path]:
    """Fetch the cover frame to a temp file. Returns None if it cannot be had —
    a missing cover holds the claim for review, it never passes it."""
    if not url:
        return None
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            if resp.status != 200:
                return None
            data = resp.read()
    except (urllib.error.URLError, OSError, TimeoutError):
        return None
    if not data:
        return None
    fd = tempfile.NamedTemporaryFile(suffix=".jpg", delete=False)
    fd.write(data)
    fd.close()
    return Path(fd.name)


def screened_fingerprint(intake: IntakeStore, submitter_id: str,
                         submission_id: Optional[str] = None
                         ) -> tuple[Optional[VideoFingerprint], Optional[str]]:
    """The fingerprint taken when the creator screened the video in-app.

    Without an explicit submission id, the most recent screening by that
    submitter is used — which is what "screen it, then post it" produces in
    practice. Returns (None, None) when nothing was screened, and gate 4 then
    holds rather than passing by default.
    """
    subs = intake.submissions(submitter_id=submitter_id)
    for s in subs:
        if submission_id and s["submission_id"] != submission_id:
            continue
        fp = s.get("fingerprint")
        if isinstance(fp, VideoFingerprint):
            return fp, s["submission_id"]
        if submission_id:
            break
    return None, None


# ------------------------------------------------------------------ claim

def process_claim(url: str, submitter_id: str, handle_on_file: str,
                  tier: int = 1, submission_id: Optional[str] = None,
                  intake: Optional[IntakeStore] = None,
                  store: Optional[ClaimStore] = None,
                  accounts: Optional[AccountStore] = None,
                  now: Optional[datetime] = None) -> dict[str, Any]:
    """Full pipeline: resolve, dedupe the post, match the cover, run the gates.

    The post-id check runs *before* the gates on purpose. A link already paid
    out costs nothing to detect, and running five gates on it — one of which
    downloads a file — would be paying to re-answer a question the database
    already settled.
    """
    intake = intake or IntakeStore()
    store = store or ClaimStore()
    accounts = accounts or AccountStore()

    try:
        link = resolve_link(url)
    except LinkError as exc:
        return {"verdict": "reject", "tier": tier, "gates": [],
                "post": None, "soft_passes": [], "submission_id": None,
                "screened": False,
                "ownership_proof": {"connected": False,
                                    "reason": "not evaluated — the link did not resolve"},
                "claim_id": None,
                "user_message": "That link doesn't look like a TikTok or Instagram post.",
                "error": str(exc)}

    prior = store.prior_claim(link.platform, link.video_id) if link.video_id else None
    if prior:
        gates = [GateOutcome("resolve", FAIL,
                             f"post already claimed on {prior['created_at'][:10]}"
                             f" by {prior['submitter_id']}",
                             {"prior_claim": prior["claim_id"],
                              "prior_verdict": prior["verdict"]},
                             user_message="You've already claimed this post.")]
        for g in ("ownership", "window", "content_match", "screening"):
            gates.append(GateOutcome(g, SKIPPED, "not reached — this post was already claimed"))
        # The post metadata from the original claim, so the creator can see
        # *which* post this was — carried from the row we already read rather
        # than re-fetching, which would pay to answer a settled question.
        try:
            prior_post = json.loads(prior["post"] or "null")
        except (TypeError, ValueError):
            prior_post = None
        # Same keys as the gate path. A client must never have to branch on
        # which branch produced the response, so every field the normal path
        # returns is present here too.
        return {"verdict": "reject", "tier": tier,
                "gates": [g.to_dict() for g in gates],
                "post": prior_post, "soft_passes": [],
                "user_message": "You've already claimed this post.",
                "submission_id": prior["submission_id"],
                "screened": bool(prior["submission_id"]),
                "ownership_proof": {"connected": False,
                                    "reason": "not evaluated — this post was "
                                              "already claimed"},
                "claim_id": prior["claim_id"],
                "duplicate_of": prior["claim_id"],
                "claimed_at": prior["created_at"]}

    # Ownership proof is looked up, never accepted from the caller. A request
    # that could assert `connected` would be able to upgrade its own gate 2
    # from a soft pass to a hard pass, which is precisely the check that stops
    # an expensive reward paying out on an asserted identity.
    connected, proof_reason = accounts.ownership_proof(
        submitter_id, link.platform, handle_on_file)

    # Gate 4 inputs: what we screened, and what they posted.
    fingerprint, used_submission = screened_fingerprint(intake, submitter_id, submission_id)
    cover_path: Optional[Path] = None
    match: Optional[CoverMatch] = None
    result: Optional[ClaimResult] = None
    try:
        # The gates need the cover, but the cover needs the post metadata that
        # gate 1 fetches. Run gate 1's fetch once here and hand the result in.
        from .links import fetch as fetch_post
        try:
            post = fetch_post(link)
        except LinkError:
            post = None

        if post is not None and post.live and fingerprint is not None:
            cover_path = download_cover(post.thumbnail_url or "")
            if cover_path:
                try:
                    match = cover_match(fingerprint, cover_path)
                except Exception:
                    match = None       # unreadable cover holds; it never passes

        result = verify_claim(url, handle_on_file, tier=tier, cover_result=match,
                              connected=connected, now=now)
    finally:
        if cover_path:
            cover_path.unlink(missing_ok=True)

    payload = result.to_dict()
    payload["submission_id"] = used_submission
    payload["screened"] = fingerprint is not None
    payload["ownership_proof"] = {"connected": connected, "reason": proof_reason}

    claim_id = f"clm_{link.platform}_{link.video_id}"[:64]
    if link.video_id:
        store.record(claim_id, link.platform, link.video_id, submitter_id,
                     used_submission, tier, result, now=now)
        payload["claim_id"] = claim_id
    return payload


def run_rechecks(store: Optional[ClaimStore] = None,
                 now: Optional[datetime] = None) -> list[dict[str, Any]]:
    """T+7: is the post we paid for still up?

    Only gate 1 is re-run. The other four judged facts that cannot change —
    who posted it, when, and whether it was the screened video. Only liveness
    can change, and it is the thing being attacked.
    """
    store = store or ClaimStore()
    from .links import fetch as fetch_post
    out: list[dict[str, Any]] = []
    for claim in store.due_for_recheck(now=now):
        post_json = json.loads(claim["post"] or "null") or {}
        handle = post_json.get("handle") or "x"
        url = f"https://www.tiktok.com/@{handle}/video/{claim['post_id']}"
        try:
            meta = fetch_post(resolve_link(url))
            status = "ok" if meta.live else "clawed_back"
        except LinkError:
            # An outage is not evidence of deletion. Leave it due and retry.
            out.append({"claim_id": claim["claim_id"], "status": "deferred",
                        "reason": "could not reach the platform"})
            continue
        store.mark_recheck(claim["claim_id"], status)
        out.append({"claim_id": claim["claim_id"], "status": status,
                    "submitter_id": claim["submitter_id"]})
    return out
