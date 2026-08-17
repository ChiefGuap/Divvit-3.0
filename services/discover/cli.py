#!/usr/bin/env python3
"""Divvit Discover CLI.

    # trending cafe UGC in a city
    python -m services.discover.cli harvest trend --city "San Diego" --limit 15

    # everything posted about one partner business
    python -m services.discover.cli harvest business --name "La Bora" \
        --city "San Diego" --cuisine "Korean cafe"

    # what's in the corpus
    python -m services.discover.cli stats
    python -m services.discover.cli list --intent trend --limit 10

    # which formats work, and what a campaign would return
    python -m services.discover.cli roi --videos 10 --reward-cost 15

    # push the best harvested videos through TwelveLabs screening
    python -m services.discover.cli screen --limit 5 --minute-budget 30
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

# Allow `python services/discover/cli.py` as well as `-m`.
_REPO_ROOT = Path(__file__).resolve().parents[2]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from services.discover.connectors import build_connector          # noqa: E402
from services.discover.connectors.base import ConnectorError      # noqa: E402
from services.discover.formats import FORMAT_ARCHETYPES           # noqa: E402
from services.discover.harvest import Harvester, HarvestFilters   # noqa: E402
from services.discover.models import (                            # noqa: E402
    INTENT_BUSINESS, INTENT_CATEGORY, INTENT_TREND)
from services.discover.queries import (                           # noqa: E402
    BusinessTarget, business_queries, category_queries, creator_queries,
    trend_queries)
from services.discover.roi import rank_formats, score_corpus      # noqa: E402
from services.discover.store import CorpusStore, DEFAULT_DB       # noqa: E402


def load_dotenv(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())


def _fmt_int(n) -> str:
    if n is None:
        return "-"
    for unit, div in (("M", 1_000_000), ("K", 1_000)):
        if n >= div:
            return f"{n / div:.1f}{unit}"
    return str(int(n))


# --------------------------------------------------------------- commands

def cmd_harvest(args) -> int:
    store = CorpusStore(args.db)
    kwargs = {}
    if args.connector == "ytdlp":
        kwargs["short_form_only"] = not args.allow_long_form
        if args.cookies_from_browser:
            kwargs["cookies_from_browser"] = args.cookies_from_browser
    try:
        connector = build_connector(args.connector, **kwargs)
    except ConnectorError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    ok, why = connector.available()
    if not ok:
        print(f"error: connector {args.connector} unavailable: {why}", file=sys.stderr)
        return 2
    print(f"[discover] connector: {connector.name} ({why})")

    platforms = [p.strip() for p in args.platforms.split(",") if p.strip()]

    if args.job == "creators":
        handles = [h.strip() for h in (args.handles or "").split(",") if h.strip()]
        if not handles:
            print("error: --handles is required for the creators job "
                  "(e.g. --handles '@eattryunbox,@thehangryrider')", file=sys.stderr)
            return 2
        queries = creator_queries(handles, platforms, limit=args.limit)
    elif args.job == INTENT_TREND:
        queries = trend_queries(city=args.city, cuisine=args.cuisine,
                                platforms=platforms, limit=args.limit,
                                archetypes=args.archetypes)
    else:
        if not args.name:
            print("error: --name is required for business/category jobs", file=sys.stderr)
            return 2
        target = BusinessTarget(
            name=args.name, business_id=args.business_id, city=args.city,
            cuisine=args.cuisine,
            competitors=[c.strip() for c in (args.competitors or "").split(",") if c.strip()],
        )
        queries = (business_queries(target, platforms, limit=args.limit)
                   if args.job == INTENT_BUSINESS
                   else category_queries(target, platforms, limit=args.limit))

    if args.max_queries:
        queries = queries[:args.max_queries]
    if not queries:
        print("no queries generated — check --city/--cuisine/--name", file=sys.stderr)
        return 1

    print(f"[discover] {len(queries)} queries planned")
    if args.connector == "youtube_api":
        from services.discover.connectors.youtube_api import YouTubeDataConnector
        print(f"[discover] estimated quota: "
              f"{YouTubeDataConnector.estimate_quota(len(queries), args.limit)} units "
              f"of 10,000/day")
    if args.dry_run:
        for q in queries:
            print(f"  {q.platform:10s} {q.intent:9s} {q.text}")
        return 0

    harvester = Harvester(
        connector, store,
        filters=HarvestFilters(max_duration_seconds=args.max_duration,
                               min_views=args.min_views,
                               require_vertical=not args.allow_landscape),
        enrich=not args.no_enrich,
        enrich_limit=args.enrich_limit,
        pause_seconds=args.pause,
    )
    report = harvester.run(queries)
    print(f"\n[discover] {report.summary()}")
    if report.errors:
        print(f"[discover] {len(report.errors)} errors; first: {report.errors[0][:200]}")
    return 0


def cmd_stats(args) -> int:
    counts = CorpusStore(args.db).counts()
    print(json.dumps(counts, indent=2))
    return 0


def cmd_list(args) -> int:
    videos = CorpusStore(args.db).query(
        intent=args.intent, business_id=args.business_id, platform=args.platform,
        limit=args.limit, order_by_views=True)
    if not videos:
        print("corpus empty for that filter")
        return 0
    scores = score_corpus(videos)
    print(f"{'score':>6} {'views':>8} {'lev':>6} {'archetype':<15} title")
    print("-" * 100)
    for v in videos:
        s = scores[v.canonical_id]
        print(f"{(s.format_score if s.format_score is not None else 0):6.1f} "
              f"{_fmt_int(v.metrics.view_count):>8} "
              f"{(f'{s.audience_leverage:.1f}' if s.audience_leverage else '-'):>6} "
              f"{s.archetype:<15} {(v.title or '')[:55]}")
    return 0


def cmd_roi(args) -> int:
    videos = CorpusStore(args.db).query(intent=args.intent, business_id=args.business_id)
    if not videos:
        print("corpus empty — run a harvest first", file=sys.stderr)
        return 1

    ranked = rank_formats(videos, videos_planned=args.videos,
                          reward_cost_usd=args.reward_cost,
                          creator_followers=args.creator_followers,
                          cpm_usd=args.cpm)
    if args.json:
        print(json.dumps([{"stats": s.to_dict(), "projection": p.to_dict()}
                          for s, p in ranked], indent=2))
        return 0

    print(f"\nFormat performance  (corpus: {len(videos)} videos)")
    print(f"{'format':<26} {'n':>4} {'score':>6} {'med views':>10} {'lev':>6} "
          f"{'eng':>6} {'breakout':>9} {'conf':>7}")
    print("-" * 90)
    for s, _ in ranked:
        print(f"{s.label[:25]:<26} {s.sample_size:>4} "
              f"{(s.mean_format_score or 0):>6.1f} "
              f"{_fmt_int(s.median_views):>10} "
              f"{(f'{s.median_leverage:.1f}' if s.median_leverage else '-'):>6} "
              f"{(f'{s.median_engagement_rate:.1%}' if s.median_engagement_rate else '-'):>6} "
              f"{(f'{s.breakout_rate:.0%}' if s.breakout_rate is not None else '-'):>9} "
              f"{s.confidence:>7}")

    print(f"\nProjected campaign  ({args.videos} videos x ${args.reward_cost:.0f} reward, "
          f"creator ~{args.creator_followers} followers, ${args.cpm:.0f} CPM)")
    print(f"{'format':<26} {'views/vid':>10} {'impressions':>12} {'EMV':>10} "
          f"{'cost':>8} {'ROI':>7} {'CPM eff':>9}")
    print("-" * 90)
    for _, p in ranked:
        print(f"{p.label[:25]:<26} "
              f"{_fmt_int(p.projected_views_per_video):>10} "
              f"{_fmt_int(p.projected_impressions):>12} "
              f"{(f'${p.projected_emv_usd:,.0f}' if p.projected_emv_usd else '-'):>10} "
              f"{f'${p.campaign_cost_usd:,.0f}':>8} "
              f"{(f'{p.roi_multiple:.1f}x' if p.roi_multiple else '-'):>7} "
              f"{(f'${p.cost_per_1k_impressions_usd:.2f}' if p.cost_per_1k_impressions_usd else '-'):>9}")
    print("\nProjections are modeled from scraped public metrics, not measured "
          "campaign outcomes.")
    return 0


def cmd_screen(args) -> int:
    load_dotenv(_REPO_ROOT / ".env")
    from services.discover.screen_bridge import (
        ScreeningBridge, business_profile_from, estimate_minutes)

    store = CorpusStore(args.db)
    try:
        bridge = ScreeningBridge(store, media_dir=args.media_dir,
                                 index_name=args.index_name)
    except (RuntimeError, ValueError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    batch = bridge.select_batch(limit=args.limit, intent=args.intent,
                                business_id=args.business_id,
                                platform=args.platform)
    if not batch:
        print("nothing unscreened in the corpus matching that filter")
        return 0

    print(f"[screen] {len(batch)} videos, ~{estimate_minutes(batch):.1f} indexed minutes")
    for v in batch:
        print(f"  - {(v.title or v.url)[:70]}")
    if args.dry_run:
        return 0

    business = business_profile_from(args.business, city=args.city,
                                     cuisine=args.cuisine) if args.business else None
    try:
        report = bridge.screen_batch(batch, business=business,
                                     minute_budget=args.minute_budget)
    except ValueError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    print(f"\n[screen] {report.summary()}")
    for err in report.errors[:5]:
        print(f"  ! {err[:200]}")
    if args.purge_media:
        print(f"[screen] purged {bridge.purge_media()} evaluation media files")
    return 0


def cmd_style(args) -> int:
    """Extract craft/style signals from screened videos, then show profiles.

    Only touches videos already indexed by screening — this is a second
    analyze call on an existing index entry, so it costs no indexing minutes.
    """
    load_dotenv(_REPO_ROOT / ".env")
    from services.discover.style import (
        StyleError, StyleExtractor, build_profiles, measure_pacing)

    store = CorpusStore(args.db)
    if not args.profiles_only:
        try:
            extractor = StyleExtractor(os.environ.get("TWELVELABS_API_KEY", ""))
        except StyleError as exc:
            print(f"error: {exc}", file=sys.stderr)
            return 2

        pending = [v for v in store.query(screened_only=True)
                   if (args.redo or not v.style)
                   and (v.screening or {}).get("video_id")
                   and (v.screening or {}).get("verdict") == "approved_for_collection"]
        pending = pending[:args.limit]
        if not pending:
            print("nothing to extract — all approved videos already have style data")
        connector = None
        if args.measure_pacing:
            from services.discover.connectors.ytdlp import YtDlpConnector
            connector = YtDlpConnector()

        for video in pending:
            title = (video.title or video.url)[:60]
            try:
                style = extractor.analyze(video.screening["video_id"])
            except StyleError as exc:
                print(f"[style] {title}\n    ! {exc}")
                continue

            # Cut rhythm needs the file. Screening purges media after use, so
            # re-fetch here — this is the measurement that sets slot durations,
            # and a model saying "fast" is not a number we can cut to.
            path = Path(video.local_path) if video.local_path else None
            temporary = False
            if connector and (not path or not path.exists()):
                try:
                    path = connector.download(video, Path(args.media_dir))
                    temporary = True
                except Exception:
                    path = None
            if path and path.exists():
                style["pacing_measured"] = measure_pacing(path).to_dict()
                if temporary:
                    path.unlink(missing_ok=True)   # eval copy, not ours to keep

            store.set_fields(video.canonical_id, style=style)
            measured = style.get("pacing_measured") or {}
            print(f"[style] {title}")
            print(f"    hook: {style.get('hook_text') or '(none)'!r}")
            print(f"    audio: {style.get('audio_style')} / "
                  f"{style.get('narration_style')}  pace: {style.get('pacing')}"
                  + (f"  cuts: {measured.get('cut_count')} "
                     f"(shot {measured.get('median_shot_seconds')}s)"
                     if measured.get("cut_count") is not None else ""))

    profiles = build_profiles(store.query())
    if not profiles:
        print("\nno style profiles yet")
        return 0

    print(f"\n=== style profiles ({len(profiles)} archetypes) ===")
    for archetype, p in sorted(profiles.items(),
                               key=lambda kv: -kv[1].sample_size):
        print(f"\n{archetype}  (n={p.sample_size}, confidence {p.confidence})")
        print(f"  text on screen : {p.pct_with_text:.0%} of videos, "
              f"median {p.median_overlay_count} overlays")
        if p.hook_templates:
            print("  hook patterns  :")
            for h in p.hook_templates[:5]:
                print(f"      {h!r}")
        if p.common_caption_style:
            print(f"  caption style  : {p.common_caption_style[:70]}")
        print(f"  audio          : {p.dominant_audio_style} "
              f"(energy {p.dominant_music_energy}), narration {p.dominant_narration}")
        if p.music_genre_hints:
            print(f"  music hints    : {', '.join(p.music_genre_hints[:3])}")
        print(f"  editing        : pace {p.dominant_pacing}, "
              f"median {p.median_cuts} cuts, shot {p.median_shot_seconds}s, "
              f"length {p.median_duration_seconds}s")
        if p.common_opening_shots:
            print(f"  opens with     : {p.common_opening_shots[0][:66]}")
        if p.common_closing_shots:
            print(f"  ends with      : {p.common_closing_shots[0][:66]}")
        if p.tone_words:
            print(f"  tone           : {', '.join(p.tone_words[:5])}")

    if args.json_out:
        Path(args.json_out).parent.mkdir(parents=True, exist_ok=True)
        Path(args.json_out).write_text(json.dumps(
            {a: p.to_dict() for a, p in profiles.items()}, indent=2))
        print(f"\nwrote {args.json_out}")
    return 0


def cmd_creators(args) -> int:
    """Inspect and manage the creator supply list."""
    store = CorpusStore(args.db)
    if args.block:
        store.set_creator_status(args.block, "blocked")
        print(f"blocked {args.block}")
        return 0
    if args.unblock:
        store.set_creator_status(args.unblock, "candidate")
        print(f"unblocked {args.unblock}")
        return 0

    tallies = store.refresh_creators()
    rows = store.creator_rows()
    print(f"{tallies['tracked']} creators tracked, {tallies['blocked']} newly blocked\n")
    print(f"{'handle':<32} {'seen':>5} {'appr':>5} {'rej':>4} {'followers':>10}  status")
    print("-" * 78)
    for r in rows[:args.limit]:
        print(f"{r['handle'][:31]:<32} {r['videos_seen']:>5} {r['videos_approved']:>5} "
              f"{r['videos_rejected']:>4} {_fmt_int(r['follower_count']):>10}  {r['status']}")
    return 0


def cmd_prune(args) -> int:
    """Drop corpus rows that no longer meet the collection definition.

    Needed when the definition tightens (e.g. short-form only): re-harvesting
    adds conforming videos but never removes the ones already stored.
    """
    store = CorpusStore(args.db)
    doomed, reasons = [], {}
    for v in store.query():
        why = None
        if args.max_duration and (v.duration_seconds or 0) > args.max_duration:
            why = f"over {args.max_duration:.0f}s"
        elif args.require_vertical and v.width and v.height and v.height <= v.width:
            why = "landscape"
        elif args.require_vertical and not v.height:
            why = "unknown orientation"
        if not why:
            continue
        # Screened videos cost real TwelveLabs minutes; don't discard that
        # unless explicitly asked.
        if v.screening and not args.include_screened:
            continue
        doomed.append(v)
        reasons[why] = reasons.get(why, 0) + 1

    total = len(store.query())
    print(f"corpus: {total} videos; {len(doomed)} do not meet the definition")
    for why, count in sorted(reasons.items(), key=lambda kv: -kv[1]):
        print(f"  {count:>4}  {why}")
    if args.dry_run:
        print("\ndry run — nothing deleted (drop --dry-run to apply)")
        return 0
    removed = store.delete([v.canonical_id for v in doomed])
    print(f"\ndeleted {removed}; {total - removed} remain")
    return 0


def cmd_export(args) -> int:
    rows = CorpusStore(args.db).export_rows()
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w") as fh:
        for row in rows:
            fh.write(json.dumps(row, ensure_ascii=False) + "\n")
    print(f"wrote {len(rows)} records to {out}")
    return 0


# ----------------------------------------------------------------- parser

def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="divvit-discover",
                                description="Divvit Discover — harvest and analyze cafe/restaurant UGC")
    p.add_argument("--db", default=str(DEFAULT_DB), help="corpus SQLite path")
    sub = p.add_subparsers(dest="command", required=True)

    h = sub.add_parser("harvest", help="search platforms and store results")
    h.add_argument("job", choices=[INTENT_TREND, INTENT_BUSINESS, INTENT_CATEGORY,
                                   "creators"])
    h.add_argument("--handles", help="comma-separated creator handles (creators job)")
    h.add_argument("--connector", default="ytdlp", choices=["ytdlp", "youtube_api"])
    h.add_argument("--platforms", default="youtube",
                   help="comma-separated: youtube,tiktok,instagram")
    h.add_argument("--city", default="")
    h.add_argument("--cuisine", default="")
    h.add_argument("--name", help="business name (business/category jobs)")
    h.add_argument("--business-id")
    h.add_argument("--competitors", help="comma-separated competitor names")
    h.add_argument("--archetypes", nargs="*", choices=list(FORMAT_ARCHETYPES),
                   help="limit trend harvest to these formats")
    h.add_argument("--limit", type=int, default=20, help="results per query")
    h.add_argument("--max-queries", type=int, help="cap queries per run")
    h.add_argument("--max-duration", type=float, default=90.0)
    h.add_argument("--allow-landscape", action="store_true",
                   help="keep non-vertical videos (default: Shorts/Reels/TikTok only)")
    h.add_argument("--min-views", type=int)
    h.add_argument("--no-enrich", action="store_true",
                   help="skip per-video metric lookups (fast, fewer metrics)")
    h.add_argument("--enrich-limit", type=int, help="cap enrich calls per run")
    h.add_argument("--pause", type=float, default=0.0, help="seconds between queries")
    h.add_argument("--cookies-from-browser", help="e.g. chrome — needed for instagram")
    h.add_argument("--allow-long-form", action="store_true",
                   help="drop the under-4-minute search filter (default is short-form only)")
    h.add_argument("--dry-run", action="store_true", help="print queries and exit")
    h.set_defaults(func=cmd_harvest)

    s = sub.add_parser("stats", help="corpus counts")
    s.set_defaults(func=cmd_stats)

    l = sub.add_parser("list", help="list corpus videos by score")
    l.add_argument("--intent", choices=[INTENT_TREND, INTENT_BUSINESS, INTENT_CATEGORY])
    l.add_argument("--business-id")
    l.add_argument("--platform")
    l.add_argument("--limit", type=int, default=25)
    l.set_defaults(func=cmd_list)

    r = sub.add_parser("roi", help="format performance and projected campaign ROI")
    r.add_argument("--intent", choices=[INTENT_TREND, INTENT_BUSINESS, INTENT_CATEGORY])
    r.add_argument("--business-id")
    r.add_argument("--videos", type=int, default=10, help="videos in the planned campaign")
    r.add_argument("--reward-cost", type=float, default=15.0, help="reward cost per video ($)")
    r.add_argument("--creator-followers", type=int, default=800,
                   help="follower count of a typical Divvit creator")
    r.add_argument("--cpm", type=float, default=12.0, help="assumed CPM ($ per 1k views)")
    r.add_argument("--json", action="store_true")
    r.set_defaults(func=cmd_roi)

    sc = sub.add_parser("screen", help="run harvested videos through TwelveLabs screening")
    sc.add_argument("--limit", type=int, default=5)
    sc.add_argument("--intent", choices=[INTENT_TREND, INTENT_BUSINESS, INTENT_CATEGORY])
    sc.add_argument("--business-id")
    sc.add_argument("--platform", help="restrict the batch to one platform")
    sc.add_argument("--business", help="verify against this business (omit for catalog mode)")
    sc.add_argument("--city", default="")
    sc.add_argument("--cuisine", default="")
    sc.add_argument("--index-name", default="divvit-discover")
    sc.add_argument("--media-dir", default="data/media")
    sc.add_argument("--minute-budget", type=float, default=30.0,
                    help="refuse the batch if it would exceed this many indexed minutes")
    sc.add_argument("--purge-media", action="store_true",
                    help="delete downloaded evaluation copies afterwards")
    sc.add_argument("--dry-run", action="store_true")
    sc.set_defaults(func=cmd_screen)

    st = sub.add_parser("style", help="extract craft signals and show style profiles")
    st.add_argument("--limit", type=int, default=15, help="videos to extract this run")
    st.add_argument("--profiles-only", action="store_true",
                    help="skip extraction, just print profiles from stored data")
    st.add_argument("--json-out", help="write profiles to this JSON path")
    st.add_argument("--media-dir", default="data/media")
    st.add_argument("--no-measure-pacing", dest="measure_pacing",
                    action="store_false",
                    help="skip re-downloading media to measure cut rhythm")
    st.add_argument("--redo", action="store_true",
                    help="re-extract videos that already have style data")
    st.set_defaults(func=cmd_style)

    cr = sub.add_parser("creators", help="inspect / manage the creator supply list")
    cr.add_argument("--limit", type=int, default=30)
    cr.add_argument("--block", metavar="HANDLE", help="stop harvesting this creator")
    cr.add_argument("--unblock", metavar="HANDLE")
    cr.set_defaults(func=cmd_creators)

    pr = sub.add_parser("prune", help="drop corpus videos that are not short-form")
    pr.add_argument("--max-duration", type=float, default=90.0)
    pr.add_argument("--require-vertical", action="store_true", default=True)
    pr.add_argument("--keep-landscape", dest="require_vertical", action="store_false")
    pr.add_argument("--include-screened", action="store_true",
                    help="also drop videos we already paid to screen")
    pr.add_argument("--dry-run", action="store_true")
    pr.set_defaults(func=cmd_prune)

    e = sub.add_parser("export", help="dump corpus to JSONL")
    e.add_argument("--out", default="data/corpus.jsonl")
    e.set_defaults(func=cmd_export)

    return p


def main() -> int:
    args = build_parser().parse_args()
    try:
        return args.func(args)
    except KeyboardInterrupt:
        print("\ninterrupted", file=sys.stderr)
        return 130


if __name__ == "__main__":
    sys.exit(main())
