#!/usr/bin/env python3
"""Emit seed SQL for the top-ranked slice of the roster.

The full seed is ~750KB, which cannot be pushed through a tool-call channel
that truncates large payloads. This selects the highest Brand Health cafes and
everything attached to them, so the dashboard renders *real* data end to end on
a slice rather than fake data on all of it. Selection is by rank, so the slice
is the part of the roster a sales conversation would open with.

Emission is delegated to seed_dashboard.statements()/emit_parts() — the SQL
quoting, the snapshot special-case and the idempotent ON CONFLICT clauses are
already correct there and must not be reimplemented.

    python3 scripts/seed_subset.py --top 25 --chunk 25 --out data/seed/subset
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import seed_dashboard as S


def build_subset(top: int, latest_only: bool = True) -> dict[str, list[dict]]:
    rows = S.build_rows()

    latest: dict[str, dict] = {}
    for snap in rows["brand_health_snapshots"]:
        bid = snap["business_id"]
        prev = latest.get(bid)
        if prev is None or (snap.get("captured_at") or "") >= (prev.get("captured_at") or ""):
            latest[bid] = snap

    ranked = sorted(
        (s for s in latest.values()
         if s.get("rankable") and s.get("score") is not None),
        key=lambda s: s["score"], reverse=True)
    keep = {s["business_id"] for s in ranked[:top]}
    if not keep:
        raise SystemExit("no rankable cafes to seed")

    snapshots = ([latest[b] for b in keep if b in latest] if latest_only
                 else [s for s in rows["brand_health_snapshots"]
                       if s["business_id"] in keep])

    picked = {
        "businesses": [b for b in rows["businesses"] if b["id"] in keep],
        "venue_signals": [v for v in rows["venue_signals"]
                          if v["business_id"] in keep],
        "brand_health_snapshots": snapshots,
        "discovered_videos": [d for d in rows["discovered_videos"]
                              if d.get("business_id") in keep],
    }
    # Only creators those videos reference — an unreferenced creator row is
    # dead weight in a size-constrained seed.
    wanted = {d.get("creator_id") for d in picked["discovered_videos"]
              if d.get("creator_id")}
    picked["creators"] = [c for c in rows["creators"] if c["id"] in wanted]
    return picked


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--top", type=int, default=25)
    ap.add_argument("--chunk", type=int, default=25)
    ap.add_argument("--out", default="data/seed/subset")
    ap.add_argument("--full-history", action="store_true",
                    help="every snapshot, not just the latest per cafe")
    args = ap.parse_args()

    picked = build_subset(args.top, latest_only=not args.full_history)
    S.emit_parts(picked, Path(args.out), args.chunk, lean=True)

    print(f"\n{len(picked['businesses'])} cafes, "
          f"{len(picked['venue_signals'])} signals, "
          f"{len(picked['brand_health_snapshots'])} snapshots, "
          f"{len(picked['discovered_videos'])} videos, "
          f"{len(picked['creators'])} creators", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
