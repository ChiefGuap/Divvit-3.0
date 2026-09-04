"""Command line for link verification.

    .venv/bin/python -m services.verify.cli claim <url> --submitter <id> --handle <handle>
    .venv/bin/python -m services.verify.cli inspect <url>
    .venv/bin/python -m services.verify.cli rechecks [--run]
    .venv/bin/python -m services.verify.cli history
    .venv/bin/python -m services.verify.cli stats

stdout carries JSON; progress goes to stderr, so it stays pipeable and can be
driven by the dashboard's API route without parsing prose.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[2]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from services.intake.store import IntakeStore                      # noqa: E402
from services.verify.accounts import (AccountStore, METHOD_MANUAL,  # noqa: E402
                                      METHOD_OAUTH)
from services.verify.claims import (ClaimStore, process_claim,     # noqa: E402
                                    run_rechecks)
from services.verify.links import (LinkError, fetch as fetch_post,  # noqa: E402
                                   resolve as resolve_link,
                                   snowflake_created_at)


def cmd_claim(args) -> int:
    payload = process_claim(
        args.url, submitter_id=args.submitter, handle_on_file=args.handle,
        tier=args.tier, submission_id=args.submission,
        intake=IntakeStore(args.intake_db), store=ClaimStore(args.db),
        accounts=AccountStore(args.accounts_db))
    print(json.dumps(payload, indent=2))
    return 0 if payload["verdict"] != "reject" else 1


def cmd_inspect(args) -> int:
    """What a link resolves to and what the platform will tell us — no claim
    recorded, no gate run. Useful for seeing exactly how little comes back."""
    link = resolve_link(args.url)
    out = {"link": link.to_dict(),
           "snowflake_created_at": None, "post": None}
    if link.video_id and link.platform == "tiktok":
        dt = snowflake_created_at(link.video_id)
        out["snowflake_created_at"] = dt.isoformat() if dt else None
    if link.supported and not link.needs_redirect:
        try:
            out["post"] = fetch_post(link).to_dict()
        except LinkError as exc:
            out["error"] = str(exc)
    print(json.dumps(out, indent=2))
    return 0


def cmd_rechecks(args) -> int:
    store = ClaimStore(args.db)
    if args.run:
        print(json.dumps(run_rechecks(store=store), indent=2))
    else:
        print(json.dumps(store.due_for_recheck(), indent=2, default=str))
    return 0


def cmd_history(args) -> int:
    print(json.dumps(ClaimStore(args.db).claims(args.limit), indent=2, default=str))
    return 0


def cmd_stats(args) -> int:
    print(json.dumps(ClaimStore(args.db).counts(), indent=2))
    return 0


def cmd_link(args) -> int:
    store = AccountStore(args.accounts_db)
    row = store.link(args.submitter, args.platform, args.handle,
                     method=METHOD_OAUTH if args.oauth else METHOD_MANUAL)
    print(json.dumps(row.to_dict(), indent=2))
    return 0


def cmd_accounts(args) -> int:
    store = AccountStore(args.accounts_db)
    print(json.dumps([a.to_dict() for a in store.for_submitter(args.submitter)],
                     indent=2))
    return 0


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(prog="verify")
    ap.add_argument("--db", default="data/claims.db")
    sub = ap.add_subparsers(dest="cmd", required=True)

    c = sub.add_parser("claim", help="run a pasted link through the five gates")
    c.add_argument("url")
    c.add_argument("--submitter", required=True)
    c.add_argument("--handle", required=True,
                   help="the platform handle on file for this creator")
    c.add_argument("--tier", type=int, default=1, choices=[1, 2, 3, 4])
    c.add_argument("--submission", help="screening id to match against")
    c.add_argument("--intake-db", default="data/intake.db")
    c.add_argument("--accounts-db", default="data/accounts.db")
    c.set_defaults(func=cmd_claim)

    i = sub.add_parser("inspect", help="resolve a link and show what the platform returns")
    i.add_argument("url")
    i.set_defaults(func=cmd_inspect)

    r = sub.add_parser("rechecks", help="claims due for the T+7 liveness re-check")
    r.add_argument("--run", action="store_true", help="actually re-check them")
    r.set_defaults(func=cmd_rechecks)

    h = sub.add_parser("history", help="recent claims")
    h.add_argument("--limit", type=int, default=50)
    h.set_defaults(func=cmd_history)

    s = sub.add_parser("stats", help="claim totals")
    s.set_defaults(func=cmd_stats)

    la = sub.add_parser("link", help="link a platform account to a creator")
    la.add_argument("--submitter", required=True)
    la.add_argument("--platform", required=True, choices=["tiktok", "youtube", "instagram"])
    la.add_argument("--handle", required=True)
    la.add_argument("--oauth", action="store_true",
                    help="the platform confirmed this link (OAuth callback only)")
    la.add_argument("--accounts-db", default="data/accounts.db")
    la.set_defaults(func=cmd_link)

    ls = sub.add_parser("accounts", help="linked accounts for a creator")
    ls.add_argument("--submitter", required=True)
    ls.add_argument("--accounts-db", default="data/accounts.db")
    ls.set_defaults(func=cmd_accounts)
    return ap


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    try:
        return args.func(args)
    except LinkError as exc:
        print(json.dumps({"error": str(exc)}, indent=2))
        return 2


if __name__ == "__main__":
    sys.exit(main())
