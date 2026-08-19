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
import os
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
from services.venues.brand_health import (                          # noqa: E402
    MIN_COVERAGE_TO_RANK, score_roster)
from services.venues.overpass import (                             # noqa: E402
    DEFAULT_CACHE_DIR, OverpassError, fetch_county_cafes)
from services.venues.roster import (                               # noqa: E402
    flag_local_chains, parse_overpass)
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
    local_chains = flag_local_chains(cafes)
    if local_chains:
        tally["independent"] -= local_chains
        tally["chain"] += local_chains
        print(f"[roster] {local_chains} multi-location brands flagged "
              "beyond tag/blocklist exclusion")
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
    from .places import PlacesClient

    store = RosterStore(args.db)
    corpus = CorpusStore(args.corpus_db)

    # Use Places when a key is present so one pass fills every component.
    # Without this the video pass re-attempts Yelp per cafe and collects 130
    # identical 403s, which is neither polite nor informative.
    places = PlacesClient()
    if not places.available()[0] or args.no_places:
        places = None
        print("[metrics] no Places key — review component will stay dark")

    if args.only_reviewed:
        print("[metrics] selecting cafes that already carry a review signal — "
              "the video pass makes those rankable immediately")

    try:
        tally = run_metrics_pass(
            store, corpus=corpus,
            connector=YtDlpConnector(short_form_only=False),
            limit=args.limit, skip_yelp=args.skip_yelp,
            places_client=places, pause_seconds=args.pause,
            with_review_signal=args.only_reviewed)
    except ConnectorError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    remaining = len(store.pending_cafes(
        with_review_signal=args.only_reviewed))
    print(f"[metrics] attempted {tally['attempted']} cafes: "
          f"{tally['youtube_measured']} measured on youtube "
          f"({tally['videos_found']} relevant videos), "
          f"{tally['google_measured']} with a review signal, "
          f"{tally['google_absent']} review-absent")
    if places is not None:
        print(f"[metrics] places: {places.billed_calls} billed calls, "
              f"{places.cache_hits} served from cache")
    print(f"[metrics] {remaining} cafes still pending — re-run to continue")
    return 0


def cmd_reviews(args) -> int:
    """Backfill the review component over cafes already measured elsewhere."""
    from .places import PlacesClient
    from .social import collect_places, _utcnow

    store = RosterStore(args.db)
    client = PlacesClient(cache_dir=args.cache_dir)
    ok, why = client.available()
    if not ok:
        print(f"error: {why}", file=sys.stderr)
        return 2

    pending = store.pending_reviews(limit=args.limit)
    print(f"[reviews] {len(pending)} cafes with no review signal\n")

    measured = absent = 0
    for i, cafe in enumerate(pending, 1):
        signal, error = collect_places(cafe, client)
        now = _utcnow()
        if signal is not None:
            measured += 1
            store.set_signals(cafe.cafe_id, google=signal,
                              reviews_checked_at=now, collected_at=now)
            print(f"  {i:>3}. {signal['rating']:>3} stars "
                  f"{signal['review_count']:>6} reviews  {cafe.name}")
        else:
            absent += 1
            # Record the attempt and the reason. Without this a permanently
            # closed cafe is "pending" forever, and nobody can audit why a
            # cafe has no review signal.
            store.set_signals(cafe.cafe_id, reviews_checked_at=now,
                              errors=[error or "places: absent"],
                              collected_at=now)
            print(f"  {i:>3}. {'—':>3}                     {cafe.name}"
                  f"   ({error})")

    print(f"\n[reviews] {measured} measured, {absent} absent")
    print(f"[reviews] {client.billed_calls} billed calls, "
          f"{client.cache_hits} served from cache")
    print(f"[reviews] {len(store.pending_reviews())} still without a review "
          "signal — re-run to continue")
    return 0


def cmd_health(args) -> int:
    store = RosterStore(args.db)
    # Active independents only. A cafe Google says is closed must never reach
    # a prospect ranking, and it must not sit in the percentile cohort either.
    cafes = store.cafes(include_inactive=args.include_inactive)
    results = score_roster(cafes, store.all_signals(),
                           include_inactive=args.include_inactive)
    if not results:
        print("no measured cafes yet — run `metrics` first", file=sys.stderr)
        return 1

    for health in results:
        store.record_snapshot(health.cafe_id, health.score, health.confidence,
                              health.components, health.assumptions)

    scored = [h for h in results if h.score is not None]
    ranked = [h for h in scored if h.rankable]
    thin = len(scored) - len(ranked)

    retired = store.status_counts()
    retired_n = sum(v for k, v in retired.items() if k != "active")
    print(f"\nBrand Health — {len(ranked)} ranked of {len(cafes)} active "
          f"independent cafes ({len(cafes) - len(results)} unmeasured, {thin} "
          "measured too thinly to compare)")
    if retired_n and not args.include_inactive:
        print(f"  {retired_n} retired records held out of the roster "
              f"({', '.join(f'{v} {k}' for k, v in retired.items() if k != 'active' and v)})"
              " — see `lifecycle`, or pass --include-inactive")
    print()
    print(f"{'#':>3}  {'score':>5}  conf    {'vids':>4}  {'eng%':>5}  "
          f"{'reviews':>9}  name / city")
    for i, h in enumerate(ranked[:args.top], 1):
        c = h.components
        vids = c["social_volume"].get("raw")
        eng = c["engagement_quality"].get("raw")
        review_raw = c["review_signal"].get("raw")
        print(f"{i:>3}  {h.score:>5.1f}  {h.confidence:<6}  "
              f"{_fmt(None if vids is None else int(vids), 4)}  "
              f"{'-'.rjust(5) if eng is None else f'{100 * eng:>4.1f}%'}  "
              f"{'-'.rjust(9) if review_raw is None else f'{review_raw:>9.2f}'}  "
              f"{h.name} / {h.city or '?'}")

    if thin:
        print(f"\n  {thin} cafes scored below {int(100 * MIN_COVERAGE_TO_RANK)}% "
              "coverage are held out of the ranking — their score is real but "
              "built\n  on too little to compare against a fully-measured cafe. "
              "Run `metrics` to fill them in.")

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
    """Write the documented seed contract — see export.py's module docstring."""
    from .export import write_export

    store = RosterStore(args.db)
    out, payload = write_export(store, path=args.json,
                                corpus_db=args.corpus_db)
    counts = payload["counts"]
    print(f"[export] schema v{payload['schema_version']} -> {out}")
    print(f"[export] {counts['active']} active cafes "
          f"({counts['ranked']} ranked, {counts['with_review_signal']} with a "
          f"review signal, {counts['with_video_signal']} video-measured), "
          f"{counts['videos']} videos")
    print(f"[export] {counts['retired']} retired records kept as evidence: "
          + ", ".join(f"{v} {k}" for k, v in counts["by_status"].items()
                      if k != "active" and v))
    return 0


def cmd_lifecycle(args) -> int:
    """Assess which roster cafes are still real businesses.

    Reads the evidence already on `cafe_signals` first, so this normally
    costs nothing. A Places client is attached only when `--recheck` asks for
    it, and even then the on-disk query+bias cache serves anything a previous
    pass already looked up.
    """
    from .lifecycle import run_lifecycle_pass
    from .roster import STATUS_ACTIVE, STATUS_CLOSED, STATUS_UNVERIFIABLE

    store = RosterStore(args.db)
    client = None
    if args.recheck:
        from .places import PlacesClient
        client = PlacesClient(cache_dir=args.cache_dir)
        ok, why = client.available()
        if not ok:
            print(f"[lifecycle] {why} — assessing from stored evidence only")
            client = None

    before = store.status_counts()
    tally = run_lifecycle_pass(store, places_client=client, limit=args.limit,
                               dry_run=args.dry_run, on_status=print)

    print(f"\n[lifecycle] assessed {tally['assessed']} independents: "
          f"{tally[STATUS_ACTIVE]} active, {tally[STATUS_CLOSED]} closed, "
          f"{tally[STATUS_UNVERIFIABLE]} unverifiable")
    print(f"[lifecycle] before: {before}")
    print(f"[lifecycle] after:  {store.status_counts()}")
    if tally["transitions"]:
        print(f"[lifecycle] transitions: {tally['transitions']}")
    if client is not None:
        print(f"[lifecycle] {client.billed_calls} billed calls, "
              f"{client.cache_hits} served from cache")
    if args.dry_run:
        print("[lifecycle] dry run — nothing written")
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
    p.add_argument("--no-places", action="store_true",
                   help="skip the review lookup even when a key is present")
    p.add_argument("--only-reviewed", action="store_true",
                   help="only measure cafes that already have a review "
                        "signal — the cheapest path to a rankable cafe")
    p.add_argument("--pause", type=float, default=1.5,
                   help="seconds between cafes")
    p.set_defaults(func=cmd_metrics)

    p = sub.add_parser("reviews", help="backfill Google Places review signal")
    common(p)
    p.add_argument("--limit", type=int, default=None)
    p.add_argument("--cache-dir", default="data/places")
    p.set_defaults(func=cmd_reviews)

    p = sub.add_parser("health", help="score + rank measured cafes")
    common(p)
    p.add_argument("--top", type=int, default=25)
    p.add_argument("--no-report", action="store_true")
    p.add_argument("--include-inactive", action="store_true",
                   help="score closed/unverifiable cafes too (audit view; "
                        "they are excluded from prospect rankings by default)")
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

    p = sub.add_parser("lifecycle",
                       help="assess active/closed/unverifiable from evidence")
    common(p)
    p.add_argument("--limit", type=int, default=None)
    p.add_argument("--cache-dir", default="data/places")
    p.add_argument("--recheck", action="store_true",
                   help="query Places for cafes whose recorded reason is "
                        "missing (cache-served, normally 0 billed calls)")
    p.add_argument("--dry-run", action="store_true",
                   help="print the transitions without writing them")
    p.set_defaults(func=cmd_lifecycle)

    p = sub.add_parser("export", help="the dashboard seed contract as JSON")
    common(p)
    p.add_argument("--json", default="data/roster_export.json")
    p.add_argument("--corpus-db", default=str(CORPUS_DB))
    p.set_defaults(func=cmd_export)

    return parser


def load_dotenv(path: Path) -> None:
    """Same contract as the Discover CLI: real environment wins over the file."""
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip())


def main(argv=None) -> int:
    load_dotenv(_REPO_ROOT / ".env")
    args = build_parser().parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
