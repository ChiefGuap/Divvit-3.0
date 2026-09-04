"""Tests for the claim store: post-id dedupe and the T+7 re-check.

Both exist because of attacks the five gates cannot see:

  * A link that passed once will pass again. Without a post-id record, the
    same post pays out repeatedly — cheaper than defeating any gate.
  * A post can be deleted the moment the reward lands. Paying for content
    that lives ninety seconds is the cheapest attack in the system.

    .venv/bin/python -m services.verify.tests.test_claims
"""

from __future__ import annotations

import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[3]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from services.verify.claims import ClaimStore, run_rechecks           # noqa: E402
from services.verify.gates import (APPROVE, APPROVE_SOFT, ClaimResult,  # noqa: E402
                                   GateOutcome, HOLD, PASS, REJECT)
from services.verify.links import PostMetadata                        # noqa: E402

_failures: list[str] = []
NOW = datetime(2026, 9, 1, 12, 0, tzinfo=timezone.utc)


def check(cond: bool, label: str) -> None:
    print(f"  {'ok  ' if cond else 'FAIL'} {label}")
    if not cond:
        _failures.append(label)


def store() -> ClaimStore:
    return ClaimStore(tempfile.mktemp(suffix=".db"))


def result(verdict: str) -> ClaimResult:
    return ClaimResult(verdict=verdict, tier=2,
                       gates=[GateOutcome("resolve", PASS)],
                       post={"handle": "diner", "video_id": "700"},
                       soft_passes=["ownership"], diner_message="")


def test_post_id_is_claimed_once() -> None:
    print("\npost-id dedupe")
    s = store()
    check(s.prior_claim("tiktok", "700") is None, "an unclaimed post has no prior claim")

    s.record("clm_a", "tiktok", "700", "diner_1", "sub_1", 2, result(APPROVE_SOFT), now=NOW)
    prior = s.prior_claim("tiktok", "700")
    check(prior is not None and prior["submitter_id"] == "diner_1",
          "the claim is found afterwards, with the original submitter")

    # A second diner claiming the same post must collide, not create a row.
    s.record("clm_b", "tiktok", "700", "diner_2", "sub_2", 2, result(APPROVE_SOFT), now=NOW)
    check(len(s.claims()) == 1,
          "a second claim on the same post replaces rather than adds — the "
          "unique index makes a double payout impossible even under a race")

    check(s.prior_claim("tiktok", "701") is None,
          "a different post on the same platform is unaffected")
    check(s.prior_claim("instagram", "700") is None,
          "and the same id on another platform is a different post")


def test_only_paid_claims_are_rechecked() -> None:
    print("\nrecheck scheduling")
    s = store()
    s.record("clm_ok", "tiktok", "801", "d1", None, 2, result(APPROVE), now=NOW)
    s.record("clm_soft", "tiktok", "802", "d2", None, 2, result(APPROVE_SOFT), now=NOW)
    s.record("clm_hold", "tiktok", "803", "d3", None, 2, result(HOLD), now=NOW)
    s.record("clm_rej", "tiktok", "804", "d4", None, 2, result(REJECT), now=NOW)

    counts = s.counts()
    check(counts["claims"] == 4, "all four claims are recorded")
    check(counts["awaiting_recheck"] == 2,
          "only the two PAID claims are scheduled for a re-check — there is "
          "nothing to claw back from a claim that never paid")

    due_now = s.due_for_recheck(now=NOW)
    check(due_now == [], "and nothing is due immediately")
    due_later = s.due_for_recheck(now=NOW + timedelta(days=8))
    check(len(due_later) == 2, "both become due after seven days")


def test_recheck_claws_back_deleted_posts() -> None:
    print("\nT+7 re-check")
    s = store()
    # Real-length snowflake ids: the resolver requires 6-25 digits, so short
    # placeholders never reach the fetch at all.
    LIVE_ID, GONE_ID = "7300000000000000901", "7300000000000000902"
    s.record("clm_live", "tiktok", LIVE_ID, "d1", None, 2, result(APPROVE), now=NOW)
    s.record("clm_gone", "tiktok", GONE_ID, "d2", None, 2, result(APPROVE), now=NOW)

    live = {LIVE_ID: True, GONE_ID: False}

    import services.verify.links as L
    real_fetch = L.fetch

    def fake_fetch(link, **kw):
        return PostMetadata(platform="tiktok", video_id=link.video_id,
                            handle="diner", live=live[link.video_id])

    L.fetch = fake_fetch
    try:
        out = run_rechecks(store=s, now=NOW + timedelta(days=8))
    finally:
        L.fetch = real_fetch

    by_id = {o["claim_id"]: o["status"] for o in out}
    check(by_id.get("clm_live") == "ok", "a post still up passes its re-check")
    check(by_id.get("clm_gone") == "clawed_back",
          "a deleted post is clawed back — this is what stops paying for "
          "posts that live ninety seconds")
    check(s.counts()["awaiting_recheck"] == 0,
          "and both are marked, so neither is re-checked forever")


def test_outage_defers_rather_than_clawing_back() -> None:
    """The same rule as the gates: our downtime is not their fraud. Failing to
    reach TikTok is not evidence a post was deleted."""
    print("\nre-check outages")
    s = store()
    s.record("clm_x", "tiktok", "7300000000000000950", "d1", None, 2,
             result(APPROVE), now=NOW)

    import services.verify.links as L
    from services.verify.links import LinkError
    real_fetch = L.fetch

    def broken(link, **kw):
        raise LinkError("oembed returned 503")

    L.fetch = broken
    try:
        out = run_rechecks(store=s, now=NOW + timedelta(days=8))
    finally:
        L.fetch = real_fetch

    check(out and out[0]["status"] == "deferred",
          "an unreachable platform defers the re-check")
    check(s.counts()["awaiting_recheck"] == 1,
          "the claim stays due, so it is retried rather than silently clawed "
          "back on our own outage")


def main() -> int:
    for t in (test_post_id_is_claimed_once, test_only_paid_claims_are_rechecked,
              test_recheck_claws_back_deleted_posts,
              test_outage_defers_rather_than_clawing_back):
        t()
    print()
    if _failures:
        print(f"FAILED: {len(_failures)}")
        for f in _failures:
            print(f"  - {f}")
        return 1
    print("all tests passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
