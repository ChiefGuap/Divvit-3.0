"""Tests for the engine's HTTP contract.

The contract is what the app will be built against, so the things worth
pinning are the ones that would silently break a client:

  * identity must come from the token, never the body
  * an unconfigured service must refuse, not default to open
  * every exit from /v1/claims must return the same keys

    .venv/bin/python -m services.api.tests.test_api
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[3]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

_failures: list[str] = []

CLAIM_KEYS = {"verdict", "tier", "user_message", "gates", "post", "soft_passes",
              "submission_id", "screened", "ownership_proof", "claim_id"}


def check(cond: bool, label: str) -> None:
    print(f"  {'ok  ' if cond else 'FAIL'} {label}")
    if not cond:
        _failures.append(label)


def client(tokens: str = "devtok:creator_test"):
    os.environ["DIVVIT_DEV_TOKENS"] = tokens
    from fastapi.testclient import TestClient
    import services.api.app as mod
    return TestClient(mod.app)


def test_auth_is_required() -> None:
    print("\nauthentication")
    c = client()
    check(c.get("/v1/health").status_code == 200, "health needs no token")

    check(c.get("/v1/accounts").status_code == 401, "no token is refused")
    check(c.get("/v1/accounts", headers={"Authorization": "Bearer wrong"}
                ).status_code == 401, "an unknown token is refused")
    check(c.get("/v1/accounts", headers={"Authorization": "devtok"}
                ).status_code == 401, "a token without the Bearer scheme is refused")
    check(c.get("/v1/accounts", headers={"Authorization": "Bearer devtok"}
                ).status_code == 200, "a known bearer token is accepted")


def test_unconfigured_service_refuses() -> None:
    """The failure mode that matters: no auth configured must not mean no auth
    required."""
    print("\nunconfigured")
    os.environ.pop("DIVVIT_DEV_TOKENS", None)
    from fastapi.testclient import TestClient
    import services.api.app as mod
    c = TestClient(mod.app)
    r = c.get("/v1/accounts", headers={"Authorization": "Bearer anything"})
    check(r.status_code == 503,
          "with no tokens configured the service refuses rather than opening up")
    check("authentication" in r.json()["detail"],
          "and says what is missing")


def test_identity_is_not_a_request_field() -> None:
    print("\nidentity")
    c = client("tok_a:creator_a,tok_b:creator_b")

    # Linking as creator_a, then reading as creator_b, must not leak.
    c.post("/v1/accounts/link", json={"platform": "tiktok", "handle": "handle_a"},
           headers={"Authorization": "Bearer tok_a"})
    a = c.get("/v1/accounts", headers={"Authorization": "Bearer tok_a"}).json()
    b = c.get("/v1/accounts", headers={"Authorization": "Bearer tok_b"}).json()
    check(len(a["accounts"]) >= 1, "creator_a sees the account it linked")
    check(all(x["handle"] != "handle_a" for x in b["accounts"]),
          "creator_b does not see creator_a's account")

    # A body that tries to name a different creator must be ignored.
    r = c.post("/v1/accounts/link",
               json={"platform": "tiktok", "handle": "handle_c",
                     "creator_id": "creator_b", "submitter_id": "creator_b"},
               headers={"Authorization": "Bearer tok_a"})
    check(r.status_code == 200, "an extra creator_id field does not error")
    check(r.json()["submitter_id"] == "creator_a",
          "and is IGNORED — the token decides who the caller is, not the body")


def test_oauth_cannot_be_asserted_by_a_client() -> None:
    print("\nownership proof")
    c = client()
    r = c.post("/v1/accounts/link",
               json={"platform": "tiktok", "handle": "asserted"},
               headers={"Authorization": "Bearer devtok"}).json()
    check(r["method"] == "manual" and r["proven"] is False,
          "a plain link request is recorded as unproven")


def test_claim_shape_is_stable() -> None:
    """Every exit returns the same keys, so a client never has to branch on
    which code path answered it."""
    print("\nclaim contract")
    c = client()
    H = {"Authorization": "Bearer devtok"}

    bad = c.post("/v1/claims", json={"url": "not-a-link", "handle": "x", "tier": 1},
                 headers=H)
    check(bad.status_code == 200, "an unresolvable link is a verdict, not an HTTP error")
    check(CLAIM_KEYS <= set(bad.json()), "and carries the full claim shape")
    check(bad.json()["verdict"] == "reject", "with a reject verdict")

    check(c.post("/v1/claims", json={"url": "x", "handle": "y", "tier": 9},
                 headers=H).status_code == 422,
          "an out-of-range tier is rejected by validation")
    check(c.post("/v1/claims", json={"handle": "y"}, headers=H).status_code == 422,
          "a missing url is rejected by validation")


def test_link_preview_reports_unsupported_platforms() -> None:
    print("\nlink preview")
    c = client()
    H = {"Authorization": "Bearer devtok"}
    r = c.get("/v1/links/preview",
              params={"url": "https://www.instagram.com/reel/Cabc123/"}, headers=H)
    check(r.status_code == 200, "an Instagram link resolves")
    check(r.json()["link"]["supported"] is False,
          "but is reported unsupported, so the app can say so BEFORE the "
          "creator commits a claim to it")
    check(c.get("/v1/links/preview", params={"url": "http://example.com"},
                headers=H).status_code == 400,
          "a non-post URL is a 400")


def main() -> int:
    for t in (test_auth_is_required, test_unconfigured_service_refuses,
              test_identity_is_not_a_request_field,
              test_oauth_cannot_be_asserted_by_a_client,
              test_claim_shape_is_stable,
              test_link_preview_reports_unsupported_platforms):
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
