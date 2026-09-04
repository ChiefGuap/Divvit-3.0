"""Linked platform accounts — the only thing that can prove ownership.

## Why this exists

A pasted link proves a post exists, not who pasted it. Comparing the post's
author handle to a handle typed into a profile proves even less: both sides
are supplied by the same person. That is why gate 2 soft-passes a pasted link,
and why expensive rewards hold instead of paying on one.

OAuth is what turns the assertion into proof. TikTok's `/v2/video/query/`
only ever returns videos belonging to the authorized user, so ownership is
*refused* by the endpoint rather than inferred by us.

## The bug this closes

The claim API took `connected` from the request body. A client could send
`{"connected": true}` and upgrade its own ownership check from a soft pass to
a hard pass — defeating exactly the tier rule that stops a free entrée being
paid out on an asserted identity.

Trust boundary, stated plainly: **`connected` is never an input.** It is
derived here, server-side, from a stored link that this service created. The
request may say who is claiming; it may not say what has been proven about
them.

## What a link can and cannot do

Linking proves *identity*. It does not unlock media:

  * **TikTok** — Login Kit works on ordinary personal accounts. Full win.
  * **YouTube** — Google sign-in, same shape.
  * **Instagram** — OAuth covers Business/Creator accounts only, which most
    creators do not have, and even a linked account exposes posts and reels via
    `/me/media`, **never stories**. No API returns story content to a third
    party, linked or not.

So linking fixes impersonation. It does not fix stories, and nothing in this
module should be read as implying otherwise.
"""

from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator, Optional

DEFAULT_DB = Path("data/accounts.db")

# How a link was established. Only OAUTH is proof; the others are records of
# something a person told us, kept so the difference stays visible.
METHOD_OAUTH = "oauth"          # the platform confirmed it to us
METHOD_MANUAL = "manual"        # a handle typed into a profile
METHOD_STAFF = "staff"          # a human vouched for it

# Methods that let gate 2 hard-pass. Deliberately a one-element tuple: adding
# to it is a decision about fraud exposure, not a configuration tweak.
PROVEN_METHODS = (METHOD_OAUTH,)

_SCHEMA = """
CREATE TABLE IF NOT EXISTS linked_accounts (
    link_id          TEXT PRIMARY KEY,
    submitter_id     TEXT NOT NULL,
    platform         TEXT NOT NULL,
    handle           TEXT NOT NULL,          -- lowercased, no leading @
    platform_user_id TEXT,                   -- the platform's own id, when OAuth gave us one
    method           TEXT NOT NULL,
    scopes           TEXT,
    linked_at        TEXT NOT NULL,
    revoked_at       TEXT
);
-- One live link per (platform, handle): two creators cannot both own an account.
CREATE UNIQUE INDEX IF NOT EXISTS idx_link_handle
    ON linked_accounts(platform, handle) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_link_submitter ON linked_accounts(submitter_id);
"""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def normalise(handle: str) -> str:
    return (handle or "").strip().lstrip("@").lower()


@dataclass
class LinkedAccount:
    link_id: str
    submitter_id: str
    platform: str
    handle: str
    method: str
    platform_user_id: Optional[str] = None
    scopes: Optional[str] = None
    linked_at: str = ""
    revoked_at: Optional[str] = None

    @property
    def proven(self) -> bool:
        """Whether this link may hard-pass gate 2."""
        return self.method in PROVEN_METHODS and not self.revoked_at

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["proven"] = self.proven
        return d


class AccountStore:
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

    def link(self, submitter_id: str, platform: str, handle: str,
             method: str = METHOD_MANUAL, platform_user_id: Optional[str] = None,
             scopes: Optional[str] = None) -> LinkedAccount:
        """Record a link. `method` decides whether it can ever prove anything —
        callers cannot pass a method the platform did not actually confirm,
        because only the OAuth callback should ever pass METHOD_OAUTH."""
        h = normalise(handle)
        if not submitter_id or not h:
            raise ValueError("submitter_id and handle are both required")
        link_id = f"lnk_{platform}_{h}"[:64]
        row = LinkedAccount(link_id=link_id, submitter_id=submitter_id,
                            platform=platform, handle=h, method=method,
                            platform_user_id=platform_user_id, scopes=scopes,
                            linked_at=_now())
        with self._conn() as conn:
            conn.execute(
                "INSERT OR REPLACE INTO linked_accounts (link_id, submitter_id,"
                " platform, handle, platform_user_id, method, scopes, linked_at,"
                " revoked_at) VALUES (?,?,?,?,?,?,?,?,NULL)",
                (row.link_id, submitter_id, platform, h, platform_user_id,
                 method, scopes, row.linked_at))
        return row

    def revoke(self, platform: str, handle: str) -> bool:
        with self._conn() as conn:
            cur = conn.execute(
                "UPDATE linked_accounts SET revoked_at=? WHERE platform=?"
                " AND handle=? AND revoked_at IS NULL",
                (_now(), platform, normalise(handle)))
            return cur.rowcount > 0

    def find(self, platform: str, handle: str) -> Optional[LinkedAccount]:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT * FROM linked_accounts WHERE platform=? AND handle=?"
                " AND revoked_at IS NULL", (platform, normalise(handle))).fetchone()
        return LinkedAccount(**dict(row)) if row else None

    def for_submitter(self, submitter_id: str) -> list[LinkedAccount]:
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT * FROM linked_accounts WHERE submitter_id=?"
                " AND revoked_at IS NULL ORDER BY linked_at DESC",
                (submitter_id,)).fetchall()
        return [LinkedAccount(**dict(r)) for r in rows]

    def ownership_proof(self, submitter_id: str, platform: str,
                        handle: str) -> tuple[bool, str]:
        """Server-side answer to "is this account proven to be theirs?"

        Returns (proven, why). Three ways to be unproven, and they are worth
        distinguishing because they are different problems:

          * no link at all          — they never connected anything
          * a link owned by someone else — this is the impersonation case
          * a link that exists but was never confirmed by the platform
        """
        found = self.find(platform, handle)
        if not found:
            return False, "no linked account for that handle"
        if found.submitter_id != submitter_id:
            # Someone else already proved they own this handle.
            return False, "that account is linked to a different creator"
        if not found.proven:
            return False, f"link exists but was recorded as '{found.method}', not confirmed by {platform}"
        return True, f"confirmed by {platform} at {found.linked_at[:10]}"

    def counts(self) -> dict[str, Any]:
        with self._conn() as conn:
            total = conn.execute(
                "SELECT COUNT(*) FROM linked_accounts WHERE revoked_at IS NULL").fetchone()[0]
            by = conn.execute(
                "SELECT platform, method, COUNT(*) c FROM linked_accounts"
                " WHERE revoked_at IS NULL GROUP BY platform, method").fetchall()
        return {"links": total,
                "by": [{"platform": r["platform"], "method": r["method"],
                        "count": r["c"]} for r in by]}
