"""Tests for linked accounts — the trust boundary around ownership.

The bug these exist to prevent: `connected` was read from the request body, so
a client could send {"connected": true} and turn its own soft-passed ownership
into a hard pass. That is the check standing between an asserted identity and
a free entrée.

    .venv/bin/python -m services.verify.tests.test_accounts
"""

from __future__ import annotations

import sys
import tempfile
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[3]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from services.verify.accounts import (AccountStore, METHOD_MANUAL,   # noqa: E402
                                      METHOD_OAUTH, METHOD_STAFF,
                                      PROVEN_METHODS, normalise)

_failures: list[str] = []


def check(cond: bool, label: str) -> None:
    print(f"  {'ok  ' if cond else 'FAIL'} {label}")
    if not cond:
        _failures.append(label)


def store() -> AccountStore:
    return AccountStore(tempfile.mktemp(suffix=".db"))


def test_only_oauth_proves_anything() -> None:
    print("\nwhat counts as proof")
    check(PROVEN_METHODS == (METHOD_OAUTH,),
          "OAuth is the ONLY method that can hard-pass ownership")

    s = store()
    s.link("d1", "tiktok", "foodie", method=METHOD_MANUAL)
    ok, why = s.ownership_proof("d1", "tiktok", "foodie")
    check(not ok, "a handle typed into a profile proves nothing")
    check("not confirmed by tiktok" in why, "and says why")

    s.link("d1", "tiktok", "foodie", method=METHOD_STAFF)
    ok, _ = s.ownership_proof("d1", "tiktok", "foodie")
    check(not ok, "a staff vouch does not prove it either")

    s.link("d1", "tiktok", "foodie", method=METHOD_OAUTH, platform_user_id="tt_1")
    ok, why = s.ownership_proof("d1", "tiktok", "foodie")
    check(ok, "an OAuth link does")
    check("confirmed by tiktok" in why, "and records who confirmed it")


def test_impersonation_is_refused() -> None:
    print("\nimpersonation")
    s = store()
    s.link("d1", "tiktok", "foodie", method=METHOD_OAUTH)

    ok, why = s.ownership_proof("d2", "tiktok", "foodie")
    check(not ok, "a second creator cannot claim an account someone else proved")
    check("different creator" in why,
          "and the reason distinguishes impersonation from a missing link — "
          "they are different problems")

    ok, why = s.ownership_proof("d1", "tiktok", "never_linked")
    check(not ok and "no linked account" in why,
          "an unlinked handle is reported as unlinked, not as impersonation")


def test_handles_normalise() -> None:
    print("\nhandle normalisation")
    s = store()
    s.link("d1", "tiktok", "  @FoodieOne ", method=METHOD_OAUTH)
    for variant in ("foodieone", "@foodieone", "FoodieOne", " @FOODIEONE "):
        ok, _ = s.ownership_proof("d1", "tiktok", variant)
        check(ok, f"{variant!r} resolves to the same account")
    check(normalise("@Abc") == "abc", "normalise strips @ and lowercases")


def test_one_owner_per_handle() -> None:
    print("\none owner per handle")
    s = store()
    s.link("d1", "tiktok", "shared", method=METHOD_OAUTH)
    s.link("d2", "tiktok", "shared", method=METHOD_OAUTH)
    # The unique index means the later link replaces the earlier one rather
    # than both existing — two creators can never both hold a live claim on it.
    check(len(s.for_submitter("d1")) == 0 and len(s.for_submitter("d2")) == 1,
          "a re-link moves the account rather than duplicating it")

    check(s.find("tiktok", "shared").submitter_id == "d2",
          "and the store has exactly one owner for the handle")


def test_revocation() -> None:
    print("\nrevocation")
    s = store()
    s.link("d1", "tiktok", "gone", method=METHOD_OAUTH)
    check(s.ownership_proof("d1", "tiktok", "gone")[0], "linked and proven")
    check(s.revoke("tiktok", "gone"), "revoke reports success")
    ok, why = s.ownership_proof("d1", "tiktok", "gone")
    check(not ok, "a revoked link stops proving ownership immediately")
    check("no linked account" in why, "and reads as unlinked")
    check(not s.revoke("tiktok", "gone"), "revoking twice is a no-op")


def test_platforms_are_separate() -> None:
    print("\nplatforms")
    s = store()
    s.link("d1", "tiktok", "same", method=METHOD_OAUTH)
    check(not s.ownership_proof("d1", "instagram", "same")[0],
          "proving a TikTok handle proves nothing about the same name on "
          "Instagram — they are different accounts owned by different people")


def main() -> int:
    for t in (test_only_oauth_proves_anything, test_impersonation_is_refused,
              test_handles_normalise, test_one_owner_per_handle,
              test_revocation, test_platforms_are_separate):
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
