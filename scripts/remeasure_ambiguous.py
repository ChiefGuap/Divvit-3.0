#!/usr/bin/env python3
"""One-shot cleanup: purge signals + corpus rows for ambiguous-named cafes
measured before the tier-2 geo gate existed, so the next metrics run
re-measures them with the fixed relevance filter.

    .venv/bin/python scripts/remeasure_ambiguous.py
"""

from __future__ import annotations

import sqlite3
import sys
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[1]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from services.venues.resolver import normalize  # noqa: E402


def ambiguous(name: str) -> bool:
    return len([t for t in normalize(name).split() if len(t) >= 2]) < 2


def main() -> int:
    venues = sqlite3.connect("data/venues.db")
    venues.row_factory = sqlite3.Row
    measured = venues.execute(
        "SELECT c.cafe_id, c.name FROM cafes c"
        " JOIN cafe_signals s ON s.cafe_id = c.cafe_id").fetchall()
    targets = [r["cafe_id"] for r in measured if ambiguous(r["name"])]
    print(f"{len(measured)} measured cafes, {len(targets)} ambiguous-named:")
    for r in measured:
        if r["cafe_id"] in targets:
            print(f"  {r['cafe_id']}  {r['name']}")
    if not targets:
        return 0

    marks = ",".join("?" * len(targets))
    n = venues.execute(
        f"DELETE FROM cafe_signals WHERE cafe_id IN ({marks})",
        targets).rowcount
    venues.commit()
    corpus = sqlite3.connect("data/discover.db")
    m = corpus.execute(
        f"DELETE FROM discovered_videos WHERE business_id IN ({marks})",
        targets).rowcount
    corpus.commit()
    print(f"purged {n} signal rows and {m} corpus rows; "
          "next metrics run re-measures them")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
