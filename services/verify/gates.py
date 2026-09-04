"""The five gates between "claim" and "reward unlocked".

Ordering is a cost decision, not a style one: four of the five are cheap and
deterministic, and they short-circuit. A private post costs one HTTP call, not
a screening run. Screening is last because it is the only expensive step.

    1 resolve     is the post live and public?
    2 ownership   does the author match the handle on file?
    3 window      was it posted inside 24 hours?
    4 content     is it the video we screened?
    5 screening   does it pass the four scored dimensions?

Two rules that matter more than the gates themselves:

**Infrastructure failure is not fraud.** A timeout, a 5xx, or a rate limit
returns RETRY. It must never be reported as a rejection: rejecting a genuine
claim over our own downtime loses that diner permanently, and it is the
easiest thing in this system to get wrong.

**A soft pass is not a pass.** Where a link is *asserted* rather than *proven*
— a pasted URL proves a post exists, not who pasted it — the gate soft-passes,
and the reward tier decides whether that is good enough to pay instantly.
"""

from __future__ import annotations

from dataclasses import dataclass, asdict, field
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Optional

from .links import (LinkError, PLATFORM_TIKTOK, PostMetadata, ResolvedLink,
                    fetch as fetch_post, resolve as resolve_link)

# Gate outcomes. `soft` is the whole reason tiers exist.
PASS, SOFT, FAIL, NODATA, RETRY, SKIPPED = "pass", "soft", "fail", "no_data", "retry", "skipped"

# Verdicts.
APPROVE, APPROVE_SOFT, HOLD, REJECT, RETRY_LATER = (
    "auto_approve", "auto_approve_soft", "hold_for_review", "reject", "retry")

CLAIM_WINDOW = timedelta(hours=24)

# Approved claims are re-examined a week later. Without this we pay for posts
# that live ninety seconds, which is the cheapest attack in the whole system.
RECHECK_AFTER_DAYS = 7

# Tier -> whether a soft pass may be paid instantly, and how much the screening
# pass mark moves. Straight from the spec's cost table: being wrong on a coffee
# costs a dollar; being wrong on an entrée costs twenty.
TIERS: dict[int, dict[str, Any]] = {
    1: {"reward": "500 points",           "soft_auto": True,  "mark_delta": 0},
    2: {"reward": "Free drip coffee",     "soft_auto": True,  "mark_delta": 0},
    3: {"reward": "Free pastry + drink",  "soft_auto": False, "mark_delta": 0},
    4: {"reward": "Free entrée",          "soft_auto": False, "mark_delta": 10},
}

# Deliberately not a tuned number. Shadow mode has not run, no claims are
# labelled, and any threshold set before that is a guess dressed as a rule.
# Kept at zero so every claim routes to review until the distribution exists.
SHADOW_MODE = True
BASE_PASS_MARK = 0


@dataclass
class GateOutcome:
    gate: str
    status: str
    reason: str = ""
    evidence: dict[str, Any] = field(default_factory=dict)
    # What the diner is shown. Never the gate name, never a score: "Ownership"
    # reads as an accusation, and a similarity percentage is exactly the
    # feedback someone calibrating against us would want.
    diner_message: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class ClaimResult:
    verdict: str
    tier: int
    gates: list[GateOutcome] = field(default_factory=list)
    post: Optional[dict[str, Any]] = None
    soft_passes: list[str] = field(default_factory=list)
    diner_message: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {"verdict": self.verdict, "tier": self.tier,
                "gates": [g.to_dict() for g in self.gates],
                "post": self.post, "soft_passes": self.soft_passes,
                "diner_message": self.diner_message}


# ------------------------------------------------------------------- gates

def gate_resolve(url: str, fetcher: Optional[Callable] = None
                 ) -> tuple[GateOutcome, Optional[ResolvedLink], Optional[PostMetadata]]:
    try:
        link = resolve_link(url)
    except LinkError as exc:
        return GateOutcome("resolve", FAIL, str(exc), diner_message=(
            "That link doesn't look like a TikTok or Instagram post.")), None, None

    if not link.supported:
        return GateOutcome("resolve", NODATA, link.note, {"platform": link.platform},
                           diner_message=(
                               "We can't check Instagram links yet. Connect your "
                               "account, or post on TikTok and paste that link.")
                           ), link, None
    if link.needs_redirect:
        return GateOutcome("resolve", NODATA, link.note, {"platform": link.platform},
                           diner_message=(
                               "Open the post and copy the full link from the address "
                               "bar, then paste that.")), link, None

    try:
        post = fetch_post(link, fetch=fetcher) if fetcher else fetch_post(link)
    except LinkError as exc:
        # 5xx / transport. Never a reject.
        return GateOutcome("resolve", RETRY, str(exc), diner_message=(
            "We're having trouble reaching TikTok. We'll keep trying.")), link, None

    if not post.live:
        return GateOutcome("resolve", FAIL, "post is not publicly visible",
                           {"video_id": link.video_id}, diner_message=(
                               "That post isn't publicly visible. Make sure it's live "
                               "and your account isn't private, then try again.")
                           ), link, post

    return GateOutcome("resolve", PASS, "", {"video_id": post.video_id,
                                             "platform": post.platform}), link, post


def gate_ownership(post: PostMetadata, handle_on_file: str,
                   connected: bool = False) -> GateOutcome:
    """Connected accounts are *enforced upstream* — TikTok's query endpoint only
    returns the authorized user's own videos, so ownership is refused rather
    than inferred. A pasted link can only ever assert it."""
    claimed = (handle_on_file or "").lstrip("@").lower()
    actual = (post.handle or "").lstrip("@").lower()
    if not claimed:
        return GateOutcome("ownership", NODATA, "no handle on file",
                           diner_message="Add your TikTok username to your profile first.")
    if not actual:
        return GateOutcome("ownership", NODATA, "post returned no author handle")
    if actual != claimed:
        return GateOutcome("ownership", FAIL,
                           f"post author @{actual} != @{claimed} on file",
                           {"author": actual, "on_file": claimed},
                           diner_message="That post was made by a different account.")
    if connected:
        return GateOutcome("ownership", PASS, "enforced by the connected account",
                           {"author": actual, "proof": "platform_enforced"})
    return GateOutcome("ownership", SOFT,
                       "handles match, but a pasted link asserts ownership rather "
                       "than proving it",
                       {"author": actual, "proof": "asserted"})


def gate_window(post: PostMetadata, now: Optional[datetime] = None) -> GateOutcome:
    now = now or datetime.now(timezone.utc)
    if not post.created_at:
        return GateOutcome("window", NODATA, "no timestamp available for this platform",
                           {"source": post.created_at_source}, diner_message=(
                               "We couldn't tell when this was posted. Connect your "
                               "account and we can check it automatically."))
    created = datetime.fromisoformat(post.created_at)
    age = now - created
    evidence = {"created_at": post.created_at, "age_hours": round(age.total_seconds() / 3600, 2),
                "source": post.created_at_source}
    if age > CLAIM_WINDOW:
        return GateOutcome("window", FAIL, f"posted {age.total_seconds()/3600:.1f}h ago",
                           evidence, diner_message=(
                               "Claims close 24 hours after posting. Post something new "
                               "and claim it the same day."))
    if age.total_seconds() < 0:
        return GateOutcome("window", NODATA, "decoded timestamp is in the future", evidence)
    return GateOutcome("window", PASS, "", evidence)


def gate_content_match(cover_result: Optional[Any]) -> GateOutcome:
    """Gate 4 — the hole in the model, and the reason it is worth building.

    Screening and posting are separate acts, so without this a diner can get a
    clean screening on one clip and post a different video entirely. Nothing
    else in the chain is looking at what actually went up.
    """
    if cover_result is None:
        return GateOutcome("content_match", NODATA,
                           "no cover frame to compare, or nothing screened for this claim",
                           diner_message=("We couldn't check the video. We'll take a look "
                                          "and get back to you."))
    if getattr(cover_result, "matched", False):
        return GateOutcome("content_match", PASS, "",
                           {"distance_bits": cover_result.distance,
                            "similarity": cover_result.similarity,
                            "matched_frame": cover_result.best_frame})
    return GateOutcome("content_match", FAIL,
                       f"cover does not appear in the screened video "
                       f"({cover_result.distance} bits)",
                       {"distance_bits": cover_result.distance,
                        "similarity": cover_result.similarity},
                       diner_message=("That's not the video we reviewed. Post the clip you "
                                      "submitted in the app, then claim again."))


def gate_screening(scores: Optional[dict[str, float]], tier: int) -> GateOutcome:
    """Gate 5 — four scored dimensions. **No model exists.**

    Until shadow mode produces a labelled distribution there is no defensible
    pass mark, so this holds rather than judging. Returning a confident verdict
    off an arbitrary threshold would be worse than admitting we cannot score
    it yet.
    """
    mark = BASE_PASS_MARK + TIERS.get(tier, TIERS[1])["mark_delta"]
    if SHADOW_MODE:
        return GateOutcome("screening", NODATA,
                           "shadow mode — scores are logged, not enforced",
                           {"pass_mark": mark, "scores": scores or {}, "shadow": True},
                           diner_message="")
    if not scores:
        return GateOutcome("screening", NODATA, "no scores returned", {"pass_mark": mark})
    weakest = min(scores.items(), key=lambda kv: kv[1])
    if weakest[1] < mark:
        return GateOutcome("screening", FAIL,
                           f"{weakest[0]} scored {weakest[1]:.0f}, below {mark}",
                           {"scores": scores, "pass_mark": mark},
                           diner_message=("We couldn't see the venue — show the space, the "
                                          "sign, or the food, then post again."))
    return GateOutcome("screening", PASS, "", {"scores": scores, "pass_mark": mark})


# ------------------------------------------------------------------ routing

def route(gates: list[GateOutcome], tier: int) -> tuple[str, str]:
    """Gate outcomes -> a verdict and the one line the diner sees."""
    if any(g.status == RETRY for g in gates):
        return RETRY_LATER, "We're having trouble checking your post. We'll keep trying."
    failed = next((g for g in gates if g.status == FAIL), None)
    if failed:
        return REJECT, failed.diner_message or "We couldn't verify this claim."
    if any(g.status == NODATA for g in gates):
        return HOLD, "We're taking a closer look at this one. You'll hear from us shortly."

    softs = [g.gate for g in gates if g.status == SOFT]
    if softs:
        if TIERS.get(tier, TIERS[1])["soft_auto"]:
            return APPROVE_SOFT, "Reward unlocked."
        return HOLD, "We're taking a closer look at this one. You'll hear from us shortly."
    return APPROVE, "Reward unlocked."


def verify_claim(url: str, handle_on_file: str, tier: int = 1,
                 cover_result: Optional[Any] = None,
                 scores: Optional[dict[str, float]] = None,
                 connected: bool = False,
                 now: Optional[datetime] = None,
                 fetcher: Optional[Callable] = None) -> ClaimResult:
    """Run the gates in cost order, short-circuiting on the first hard failure.

    Gates after a hard fail are recorded as `skipped` rather than omitted, so
    the audit trail shows what was never reached — and shows that we did not
    pay to screen a post that was already rejected for being private.
    """
    gates: list[GateOutcome] = []
    order = ["resolve", "ownership", "window", "content_match", "screening"]

    g1, link, post = gate_resolve(url, fetcher)
    gates.append(g1)

    def finish() -> ClaimResult:
        for name in order[len(gates):]:
            gates.append(GateOutcome(name, SKIPPED, "not reached — an earlier gate decided"))
        verdict, message = route(gates, tier)
        return ClaimResult(verdict=verdict, tier=tier, gates=gates,
                           post=post.to_dict() if post else None,
                           soft_passes=[g.gate for g in gates if g.status == SOFT],
                           diner_message=message)

    if g1.status in (FAIL, RETRY, NODATA) or post is None:
        return finish()

    gates.append(gate_ownership(post, handle_on_file, connected=connected))
    if gates[-1].status in (FAIL, RETRY):
        return finish()

    gates.append(gate_window(post, now=now))
    if gates[-1].status in (FAIL, RETRY):
        return finish()

    gates.append(gate_content_match(cover_result))
    if gates[-1].status in (FAIL, RETRY):
        return finish()

    gates.append(gate_screening(scores, tier))
    verdict, message = route(gates, tier)
    return ClaimResult(verdict=verdict, tier=tier, gates=gates,
                       post=post.to_dict() if post else None,
                       soft_passes=[g.gate for g in gates if g.status == SOFT],
                       diner_message=message)
