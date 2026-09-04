"""Tests for link verification — no network.

The expensive mistakes here are asymmetric, and the tests are weighted to match:

  * **Rejecting a genuine claim over our own outage** loses that creator
    permanently. A 5xx must never become a rejection.
  * **Paying a soft pass on an expensive reward** is the fraud the tier table
    exists to prevent.
  * **Screening a post that was already rejected** wastes the one costly call
    in the chain.
  * A **wrong timestamp** silently approving a stale post is worse than having
    no timestamp at all.

    .venv/bin/python -m services.verify.tests.test_verify
"""

from __future__ import annotations

import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[3]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from services.verify.gates import (                                    # noqa: E402
    APPROVE, APPROVE_SOFT, HOLD, REJECT, RETRY_LATER, FAIL, NODATA, PASS,
    SKIPPED, SOFT, TIERS, gate_ownership, gate_window, gate_content_match,
    verify_claim)
from services.verify.links import (                                    # noqa: E402
    LinkError, PostMetadata, resolve, snowflake_created_at)

_failures: list[str] = []
NOW = datetime(2026, 9, 1, 12, 0, tzinfo=timezone.utc)


def check(condition: bool, label: str) -> None:
    if condition:
        print(f"  ok   {label}")
    else:
        print(f"  FAIL {label}")
        _failures.append(label)


def oembed(handle="creator", vid="7300000000000000000", title="lunch"):
    """A canned oEmbed body, shaped exactly like the live one."""
    return 200, {"author_unique_id": handle, "author_name": handle,
                 "title": title, "thumbnail_url": "https://cdn/t.jpg",
                 "html": "<blockquote/>", "embed_product_id": vid}


def fetcher_for(status=200, body=None):
    def _f(url: str):
        return (status, body) if body is not None else (status, None)
    return _f


def recent_id(now=NOW, hours_ago=2.0) -> str:
    """A TikTok id whose snowflake decodes to `hours_ago` before `now`."""
    ts = int((now - timedelta(hours=hours_ago)).timestamp())
    return str(ts << 32)


# ------------------------------------------------------------------ links

def test_resolve() -> None:
    print("\nlink resolution")
    l = resolve("https://www.tiktok.com/@Foodie/video/6749744869880663302?is_copy_url=1")
    check(l.platform == "tiktok" and l.video_id == "6749744869880663302",
          "a full TikTok URL yields platform and id")
    check(l.handle == "foodie", "handle is lowercased for comparison")
    check("?" not in l.canonical_url, "tracking query is dropped from the canonical URL")

    check(resolve("tiktok.com/@a/video/123456789").platform == "tiktok",
          "a scheme-less paste still resolves")

    short = resolve("https://vm.tiktok.com/ZMabc123/")
    check(short.needs_redirect and not short.video_id,
          "a short share link is recognised but carries no id until followed")

    ig = resolve("https://www.instagram.com/reel/Cabc123/")
    check(ig.platform == "instagram" and not ig.supported,
          "Instagram resolves but is marked unsupported — its pasted link has no "
          "timestamp, so the window rule cannot be checked at all")

    for bad in ("", "https://youtube.com/watch?v=x", "not a url"):
        try:
            resolve(bad)
            check(False, f"{bad!r} is refused")
        except LinkError:
            check(True, f"{bad!r} is refused")


def test_snowflake() -> None:
    print("\nsnowflake decoding")
    # Measured against three real posts: the decode lands 5-7s before the
    # published time, because the id is minted when the upload starts.
    dt = snowflake_created_at("6749744869880663302")
    check(dt is not None and dt.year == 2019 and dt.month == 10,
          "a real 2019 video id decodes to October 2019")

    ts = int(NOW.timestamp())
    check(snowflake_created_at(str(ts << 32)) == NOW.replace(microsecond=0),
          "a synthesised id round-trips exactly")

    check(snowflake_created_at("123") is None,
          "an implausibly small id returns None rather than 1970")
    check(snowflake_created_at("") is None, "an empty id returns None")
    check(snowflake_created_at("not-a-number") is None, "a non-numeric id returns None")
    far_future = str((int(NOW.timestamp()) + 90 * 86400) << 32)
    check(snowflake_created_at(far_future) is None,
          "a future timestamp returns None — a wrong time that approves a stale "
          "post is worse than no time")


# ------------------------------------------------------------------ gates

def test_ownership() -> None:
    print("\nownership")
    post = PostMetadata(platform="tiktok", handle="creator")
    check(gate_ownership(post, "creator").status == SOFT,
          "a pasted link only ever ASSERTS ownership, so it soft-passes")
    check(gate_ownership(post, "@Creator").status == SOFT,
          "the @ and casing are normalised before comparing")
    check(gate_ownership(post, "creator", connected=True).status == PASS,
          "a connected account is enforced by the endpoint, so it hard-passes")
    check(gate_ownership(post, "someone_else").status == FAIL,
          "a different author fails outright")
    check(gate_ownership(post, "").status == NODATA,
          "no handle on file is missing data, not fraud")
    check(gate_ownership(PostMetadata(platform="tiktok"), "creator").status == NODATA,
          "a post with no author handle is missing data too")


def test_window() -> None:
    print("\n24-hour window")
    fresh = PostMetadata(platform="tiktok",
                         created_at=(NOW - timedelta(hours=2)).isoformat(),
                         created_at_source="snowflake")
    check(gate_window(fresh, now=NOW).status == PASS, "two hours old passes")

    stale = PostMetadata(platform="tiktok",
                         created_at=(NOW - timedelta(hours=25)).isoformat(),
                         created_at_source="snowflake")
    out = gate_window(stale, now=NOW)
    check(out.status == FAIL, "twenty-five hours old fails")
    check("24 hours" in out.user_message and "Post something new" in out.user_message,
          "and the rejection names the fix rather than the failure")

    check(gate_window(PostMetadata(platform="instagram"), now=NOW).status == NODATA,
          "no timestamp holds for review — it never silently approves")

    edge = PostMetadata(platform="tiktok",
                        created_at=(NOW - timedelta(hours=23, minutes=59)).isoformat())
    check(gate_window(edge, now=NOW).status == PASS, "just inside the window passes")


def test_content_match() -> None:
    print("\ncontent match")
    class M:
        def __init__(self, matched, distance):
            self.matched, self.distance, self.similarity, self.best_frame = (
                matched, distance, round(1 - distance / 64, 3), 4)

    check(gate_content_match(M(True, 2)).status == PASS,
          "a cover that appears in the screened video passes")
    bad = gate_content_match(M(False, 23))
    check(bad.status == FAIL, "a cover from a different video fails")
    check("video we reviewed" in bad.user_message,
          "and the message tells them to post the clip they submitted")
    check(gate_content_match(None).status == NODATA,
          "nothing to compare holds for review rather than passing by default — "
          "this gate exists because screening and posting are separate acts")


# ---------------------------------------------------------------- routing

def test_shadow_mode_holds_everything() -> None:
    """The current, deliberate state: no claim auto-approves.

    The pass mark is unanswerable until shadow mode produces a distribution,
    so gate 5 returns no data and routing holds. A verdict issued off an
    arbitrary threshold would be a guess dressed as a rule.
    """
    print("\nshadow mode")
    import services.verify.gates as G
    check(G.SHADOW_MODE is True, "shadow mode is on")

    class M:
        matched, distance, similarity, best_frame = True, 2, 0.97, 3

    vid = recent_id()
    r = verify_claim(f"https://www.tiktok.com/@creator/video/{vid}", "creator", tier=1,
                     cover_result=M(), connected=True, now=NOW,
                     fetcher=fetcher_for(*oembed(vid=vid)))
    check(r.verdict == HOLD,
          "even a perfect tier-1 claim with enforced ownership holds, because "
          "the screener cannot yet score it")
    check({g.gate: g.status for g in r.gates}["screening"] == NODATA,
          "and gate 5 reports no data rather than inventing a pass")


def test_routing_and_tiers() -> None:
    """What the tiers do once calibration has happened. Shadow mode is turned
    off for the duration so the tier logic itself is under test."""
    print("\nrouting")
    import services.verify.gates as G

    class M:
        matched, distance, similarity, best_frame = True, 2, 0.97, 3

    def claim(tier, connected=False, **kw):
        vid = recent_id()
        return verify_claim(
            f"https://www.tiktok.com/@creator/video/{vid}", "creator", tier=tier,
            cover_result=M(), connected=connected, now=NOW,
            fetcher=fetcher_for(*oembed(vid=vid)), **kw)

    was_shadow = G.SHADOW_MODE
    G.SHADOW_MODE = False
    try:
        _run_tier_checks(claim)
    finally:
        G.SHADOW_MODE = was_shadow


def _run_tier_checks(claim) -> None:
    r1 = claim(2, scores={"quality": 90, "originality": 95, "safety": 92, "venue": 88})
    check(r1.verdict == APPROVE_SOFT,
          "a soft-passed ownership on a coffee auto-approves — being wrong "
          "costs about a dollar")
    check(r1.soft_passes == ["ownership"], "and the soft pass is named")

    good = {"quality": 90, "originality": 95, "safety": 92, "venue": 88}
    r4 = claim(4, scores=good)
    check(r4.verdict == HOLD,
          "the same soft pass on a free entrée goes to review instead")
    check(TIERS[4]["mark_delta"] == 10,
          "and tier 4 also raises the screening mark")

    connected4 = claim(4, connected=True, scores=good)
    check(connected4.verdict == APPROVE,
          "a connected account on tier 4 auto-approves — ownership is proven "
          "by the endpoint, so there is no soft link left in the chain")

    # The pass mark itself is deliberately 0 until shadow mode produces a
    # distribution, so a score cannot fail through the pipeline yet. The rule
    # it will enforce is tested directly instead.
    import services.verify.gates as G
    was_mark = G.BASE_PASS_MARK
    G.BASE_PASS_MARK = 70
    try:
        good = {"quality": 90, "originality": 95, "safety": 92, "venue": 88}
        check(G.gate_screening(good, tier=1).status == PASS,
              "every dimension over the mark passes")
        weak = G.gate_screening({**good, "venue": 41}, tier=1)
        check(weak.status == FAIL,
              "one dimension under the mark fails, however good the rest are — "
              "the dimensions are scored independently, not averaged")
        check("venue" in weak.reason, "and the failing dimension is named internally")
        check("41" not in weak.user_message and "70" not in weak.user_message,
              "while no score or pass mark leaks to the creator — those are what a "
              "fraudster would calibrate against")
        check("show the space" in weak.user_message,
              "and the message names the fix: what to film, not what failed")
        check(G.gate_screening({**good, "venue": 75}, tier=4).status == FAIL,
              "tier 4 raises the mark by 10, so 75 passes at tier 1 and fails here")
    finally:
        G.BASE_PASS_MARK = was_mark


def test_outage_is_never_a_rejection() -> None:
    """The single easiest thing to get wrong: a rate limit that rejects a real
    claim costs a creator permanently."""
    print("\noutages")
    vid = recent_id()
    url = f"https://www.tiktok.com/@creator/video/{vid}"

    r = verify_claim(url, "creator", tier=2, now=NOW, fetcher=fetcher_for(503))
    check(r.verdict == RETRY_LATER, "a 5xx is a retry, NOT a rejection")
    check("keep trying" in r.user_message.lower(),
          "and the creator is told we will keep trying")
    check("try again" not in r.user_message.lower(),
          "with no call to action — they did nothing wrong, and asking them to "
          "retry implies they did")

    gone = verify_claim(url, "creator", tier=2, now=NOW, fetcher=fetcher_for(404))
    check(gone.verdict == REJECT,
          "a 404 IS a rejection — the post is genuinely not public")
    check("publicly visible" in gone.user_message,
          "and says so in terms the creator can act on")


def test_short_circuit_saves_the_expensive_call() -> None:
    print("\nshort-circuit")
    vid = recent_id(hours_ago=200)      # outside the window
    r = verify_claim(f"https://www.tiktok.com/@creator/video/{vid}", "creator", tier=2,
                     now=NOW, fetcher=fetcher_for(*oembed(vid=vid)))
    check(r.verdict == REJECT, "a stale post is rejected")
    by_gate = {g.gate: g for g in r.gates}
    check(by_gate["window"].status == FAIL, "on the window gate")
    check(by_gate["content_match"].status == SKIPPED
          and by_gate["screening"].status == SKIPPED,
          "and the two expensive gates are never reached")
    check(all(g.gate in by_gate for g in r.gates) and len(r.gates) == 5,
          "but every gate is still reported, so the audit trail shows what was "
          "skipped rather than omitting it")

    private = verify_claim("https://www.tiktok.com/@creator/video/7300000000000000000",
                           "creator", tier=2, now=NOW, fetcher=fetcher_for(404))
    skipped = [g.gate for g in private.gates if g.status == SKIPPED]
    check(len(skipped) == 4,
          "a private post costs one HTTP call and skips the other four gates")


def test_creator_copy_hides_the_machinery() -> None:
    print("\nwhat the creator sees")
    vid = recent_id()
    r = verify_claim(f"https://www.tiktok.com/@someone_else/video/{vid}", "creator",
                     tier=2, now=NOW, fetcher=fetcher_for(*oembed(handle="someone_else", vid=vid)))
    check(r.verdict == REJECT, "a mismatched author is rejected")
    msg = r.user_message.lower()
    check("ownership" not in msg and "gate" not in msg,
          "the message names no gate — 'ownership' reads as an accusation")
    check("%" not in r.user_message and "score" not in msg,
          "and no score, which is exactly the feedback a fraudster would "
          "calibrate against")


def main() -> int:
    for t in (test_resolve, test_snowflake, test_ownership, test_window,
              test_content_match, test_routing_and_tiers,
              test_outage_is_never_a_rejection,
              test_short_circuit_saves_the_expensive_call,
              test_creator_copy_hides_the_machinery):
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
