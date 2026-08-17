#!/usr/bin/env python3
"""Divvit venue roster CLI — cafe-first Discover.

    # build the county roster from Overpass (cached; free; no key)
    python -m services.venues.cli roster --county "Orange County"

    # measure public signal for pending cafes (resumes automatically)
    python -m services.venues.cli metrics --limit 40

    # compute Brand Health, print the ranked table, write the dated report
    python -m services.venues.cli health

    # harvest one cafe's videos through the full Discover pipeline
    python -m services.venues.cli harvest --cafe "Hidden House Coffee"

    # roster + signals + scores as JSON
    python -m services.venues.cli export --json data/roster_export.json
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

# Allow `python services/venues/cli.py` as well as `-m`.
_REPO_ROOT = Path(__file__).resolve().parents[2]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from services.discover.connectors.base import ConnectorError       # noqa: E402
from services.discover.connectors.ytdlp import YtDlpConnector      # noqa: E402
from services.discover.harvest import Harvester, HarvestFilters    # noqa: E402
from services.discover.queries import business_queries             # noqa: E402
from services.discover.store import CorpusStore                    # noqa: E402
from services.discover.store import DEFAULT_DB as CORPUS_DB        # noqa: E402
from services.venues.brand_health import score_roster              # noqa: E402
from services.venues.overpass import (                             # noqa: E402
    DEFAULT_CACHE_DIR, OverpassError, fetch_county_cafes)
from services.venues.roster import parse_overpass                  # noqa: E402
from services.venues.social import (                               # noqa: E402
    cafe_business_target, run_metrics_pass)
from services.venues.store import DEFAULT_DB, RosterStore          # noqa: E402

REPORTS_DIR = Path("data/reports")


def _fmt(value, width: int = 6) -> str:
    return "-".rjust(width) if value is None else f"{value:>{width}}"


# --------------------------------------------------------------- commands

def cmd_roster(args) -> int:
    store = RosterStore(args.db)
    try:
        payload = fetch_county_cafes(args.county, state=args.state,
                                     cache_dir=args.cache_dir,
                                     force_refresh=args.force_refresh)
    except OverpassError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    cafes, tally = parse_overpass(payload, county=args.county)
    total, new = store.upsert_many(cafes)
    print(f"[roster] {tally['elements']} OSM elements -> "
          f"{tally['independent']} independent + {tally['chain']} chain "
          f"({tally['nameless']} nameless, {tally['duplicates']} duplicate)")
    print(f"[roster] stored {total} cafes ({new} new) in {store.path}")

    counts = store.counts()
    print(f"[roster] roster now: {counts['independent']} independents, "
          f"{counts['chains']} chains excluded, "
          f"{counts['with_website']} with website, "
          f"{counts['with_instagram']} with instagram handle")
    top = ", ".join(f"{city} ({n})" for city, n in
                    list(counts["top_cities"].items())[:8])
    print(f"[roster] top cities: {top}")
    return 0


def cmd_metrics(args) -> int:
    store = RosterStore(args.db)
    corpus = CorpusStore(args.corpus_db)
    try:
        tally = run_metrics_pass(
            store, corpus=corpus,
            connector=YtDlpConnector(short_form_only=False),
            limit=args.limit, skip_yelp=args.skip_yelp,
            pause_seconds=args.pause)
    except ConnectorError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    remaining = len(store.pending_cafes())
    print(f"[metrics] attempted {tally['attempted']} cafes: "
          f"{tally['youtube_measured']} measured on youtube "
          f"({tally['videos_found']} relevant videos), "
          f"{tally['yelp_measured']} with yelp signal, "
          f"{tally['yelp_absent']} yelp-absent")
    print(f"[metrics] {remaining} cafes still pending — re-run to continue")
    return 0


def cmd_health(args) -> int:
    store = RosterStore(args.db)
    cafes = store.cafes()
    results = score_roster(cafes, store.all_signals())
    if not results:
        print("no measured cafes yet — run `metrics` first", file=sys.stderr)
        return 1

    for health in results:
        store.record_snapshot(health.cafe_id, health.score, health.confidence,
                              health.components, health.assumptions)

    scored = [h for h in results if h.score is not None]
    print(f"\nBrand Health — {len(scored)} scored of {len(cafes)} independent "
          f"cafes ({len(cafes) - len(results)} unmeasured, no score)\n")
    print(f"{'#':>3}  {'score':>5}  conf    {'vids':>4}  {'eng%':>5}  "
          f"{'yelp':>9}  name / city")
    for i, h in enumerate(scored[:args.top], 1):
        c = h.components
        vids = c["social_volume"].get("raw")
        eng = c["engagement_quality"].get("raw")
        yelp_raw = c["review_signal"].get("raw")
        print(f"{i:>3}  {h.score:>5.1f}  {h.confidence:<6}  "
              f"{_fmt(None if vids is None else int(vids), 4)}  "
              f"{'-'.rjust(5) if eng is None else f'{100 * eng:>4.1f}%'}  "
              f"{'-'.rjust(9) if yelp_raw is None else f'{yelp_raw:>9.2f}'}  "
              f"{h.name} / {h.city or '?'}")

    if not args.no_report:
        path = _write_report(store, results)
        print(f"\n[health] report written: {path}")
    return 0


def cmd_harvest(args) -> int:
    """Full Discover pipeline for one roster cafe — business_queries through
    the Harvester into the corpus. Metadata only; media is never downloaded."""
    store = RosterStore(args.db)
    cafe = store.find_cafe(args.cafe)
    if cafe is None:
        print(f"error: no roster cafe matching {args.cafe!r}", file=sys.stderr)
        return 2

    target = cafe_business_target(cafe)
    queries = business_queries(target, ["youtube"], limit=args.limit)
    print(f"[harvest] {cafe.name} ({cafe.cafe_id}) — {len(queries)} queries")
    if args.dry_run:
        for q in queries:
            print(f"  {q.platform}: {q.text!r}")
        return 0

    connector = YtDlpConnector(short_form_only=not args.allow_long_form)
    filters = HarvestFilters() if not args.allow_long_form else HarvestFilters(
        max_duration_seconds=None, require_vertical=False)
    harvester = Harvester(connector, CorpusStore(args.corpus_db),
                          filters=filters, enrich_limit=args.enrich_limit)
    report = harvester.run(queries)
    print(f"[harvest] {report.summary()}")
    return 0


def cmd_export(args) -> int:
    store = RosterStore(args.db)
    rows = store.export_rows()
    payload = {"generated_at": datetime.now(timezone.utc).isoformat(),
               "counts": store.counts(), "cafes": rows}
    out = Path(args.json)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, indent=2, ensure_ascii=False))
    print(f"[export] {len(rows)} cafes -> {out}")
    return 0


# ----------------------------------------------------------------- report

def _write_report(store: RosterStore, results) -> Path:
    """Dated, immutable JSON report — the venue-side sibling of
    data/reports/discover-<date>-<run>.xml. One file per run; diff two days
    to see what moved."""
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    run = 1
    while (path := REPORTS_DIR / f"brand-health-{date}-run{run}.json").exists():
        run += 1

    counts = store.counts()
    payload = {
        "report": "brand-health",
        "schema_version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "roster": counts,
        "scored": sum(1 for h in results if h.score is not None),
        "measured": len(results),
        "rankings": [h.to_dict() for h in results],
    }
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False))
    return path


# ------------------------------------------------------------------- main

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="services.venues.cli",
                                     description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    def common(p):
        p.add_argument("--db", default=str(DEFAULT_DB),
                       help="roster SQLite path")

    p = sub.add_parser("roster", help="build the county cafe roster from Overpass")
    common(p)
    p.add_argument("--county", required=True)
    p.add_argument("--state", default="California")
    p.add_argument("--cache-dir", default=str(DEFAULT_CACHE_DIR))
    p.add_argument("--force-refresh", action="store_true",
                   help="re-fetch from Overpass even when cached")
    p.set_defaults(func=cmd_roster)

    p = sub.add_parser("metrics", help="collect public signal for pending cafes")
    common(p)
    p.add_argument("--corpus-db", default=str(CORPUS_DB))
    p.add_argument("--limit", type=int, default=None,
                   help="max cafes this run (resumes next run)")
    p.add_argument("--skip-yelp", action="store_true")
    p.add_argument("--pause", type=float, default=1.5,
                   help="seconds between cafes")
    p.set_defaults(func=cmd_metrics)

    p = sub.add_parser("health", help="score + rank measured cafes")
    common(p)
    p.add_argument("--top", type=int, default=25)
    p.add_argument("--no-report", action="store_true")
    p.set_defaults(func=cmd_health)

    p = sub.add_parser("harvest", help="full video harvest for one cafe")
    common(p)
    p.add_argument("--cafe", required=True, help="cafe_id or name fragment")
    p.add_argument("--corpus-db", default=str(CORPUS_DB))
    p.add_argument("--limit", type=int, default=15, help="results per query")
    p.add_argument("--enrich-limit", type=int, default=20)
    p.add_argument("--allow-long-form", action="store_true")
    p.add_argument("--dry-run", action="store_true")
    p.set_defaults(func=cmd_harvest)

    p = sub.add_parser("export", help="roster + signals + scores as JSON")
    common(p)
    p.add_argument("--json", default="data/roster_export.json")
    p.set_defaults(func=cmd_export)

    return parser


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
