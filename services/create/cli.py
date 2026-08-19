#!/usr/bin/env python3
"""Divvit Create CLI.

    # what would the edit look like? (no rendering, no API calls beyond search)
    python -m services.create.cli plan --business "La Bora" --clips-dir data/create_clips

    # build the video
    python -m services.create.cli build --business "La Bora" --clips-dir data/create_clips \
        --out data/create_out/labora.mp4

    # publish (dry-run unless --live; --live requires IG env vars)
    python -m services.create.cli publish --video-url https://... --caption "..."
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[2]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from services.create.assemble import (                            # noqa: E402
    AssemblyError, plan_edit, render, write_plan)
from services.create.library import Clip, ClipLibrary             # noqa: E402
from services.create.moments import MomentFinder                  # noqa: E402
from services.create.recipes import (                             # noqa: E402
    RECIPES, Recipe, recipe_for, recipe_from_profile,
    pick_archetype_from_discover)


def load_dotenv(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())


def _library_from_dir(clips_dir: Path, manifest: Path | None,
                      internal_eval: bool) -> ClipLibrary:
    """Build a library from a directory of mp4s + a manifest JSON.

    Manifest maps filename -> {content_type, rights_status, twelvelabs_video_id,
    duration_seconds}. Files not in the manifest default to content_type
    'other' and rights 'owned' — the manifest is where honesty lives, so keep
    it accurate.
    """
    entries = {}
    if manifest and manifest.exists():
        entries = json.loads(manifest.read_text())
    clips = []
    for path in sorted(clips_dir.glob("*.mp4")):
        meta = entries.get(path.name) or {}
        clips.append(Clip(
            clip_id=path.stem,
            local_path=path,
            content_type=meta.get("content_type", "other"),
            duration_seconds=meta.get("duration_seconds"),
            rights_status=meta.get("rights_status", "owned"),
            twelvelabs_video_id=meta.get("twelvelabs_video_id"),
            has_burned_captions=bool(meta.get("has_burned_captions")),
        ))
    return ClipLibrary(clips, allow_internal_eval=internal_eval)


def _pick_recipe(args) -> Recipe:
    """Choose the format from Discover's ROI ranking, then shape it with
    Discover's observed style profile for that format."""
    archetype = args.archetype
    profile = None
    try:
        from services.discover.store import CorpusStore
        from services.discover.roi import rank_formats
        from services.discover.style import build_profiles

        videos = CorpusStore(args.discover_db).query()
        if videos:
            if not archetype:
                archetype = pick_archetype_from_discover(rank_formats(videos))
                print(f"[create] Discover's best-performing format: {archetype}")
            if not args.no_style:
                profile = build_profiles(videos).get(archetype)
    except Exception as exc:
        print(f"[create] could not consult Discover ({exc}); using scaffold recipe")

    base = recipe_for(archetype or "")
    if profile is None or not profile.sample_size:
        print("[create] no style profile for this format — using scaffold recipe "
              "(run: discover.cli style)")
        return base

    recipe = recipe_from_profile(profile, base=base,
                                 city=args.city, cuisine=args.cuisine)
    d = recipe.derived_from
    print(f"[create] style learned from {d['sample_size']} real videos "
          f"(confidence {d['confidence']}):")
    print(f"    cut rhythm : {d['median_cuts']} cuts, "
          f"{d['median_shot_seconds']}s shots -> {len(recipe.slots)} slots "
          f"@ {recipe.slots[0].min_seconds}-{recipe.slots[0].max_seconds}s")
    print(f"    length     : {recipe.target_seconds}s")
    print(f"    audio      : {recipe.music_hint}")
    if d.get("hook_source"):
        print(f"    hook text  : {d['hook_source']!r}  (from real hooks)")
    if d.get("caption_style"):
        print(f"    captions   : {d['caption_style'][:66]}")
    if d.get("tone"):
        print(f"    tone       : {', '.join(d['tone'])}")
    return recipe


def _make_finder(index_name: str) -> MomentFinder:
    api_key = os.environ.get("TWELVELABS_API_KEY", "")
    index_id = None
    if api_key:
        try:
            import requests
            resp = requests.get("https://api.twelvelabs.io/v1.3/indexes",
                                headers={"x-api-key": api_key},
                                params={"index_name": index_name}, timeout=30)
            data = resp.json().get("data") or []
            index_id = data[0]["_id"] if data else None
        except Exception:
            index_id = None
    if not index_id:
        print("[create] no TwelveLabs index available — moment picking will "
              "use the heuristic fallback")
    return MomentFinder(api_key=api_key, index_id=index_id)


def cmd_plan(args) -> int:
    library = _library_from_dir(Path(args.clips_dir),
                                Path(args.manifest) if args.manifest else None,
                                args.internal_eval)
    if not len(library):
        print("error: no usable clips in the library", file=sys.stderr)
        return 1
    print(f"[create] library: {len(library)} clips, coverage {library.coverage()}")
    recipe = _pick_recipe(args)
    print(f"[create] recipe: {recipe.label} ({len(recipe.slots)} slots, "
          f"target ~{recipe.target_seconds:.0f}s)")
    try:
        plan = plan_edit(recipe, library, _make_finder(args.index_name),
                         business=args.business)
    except AssemblyError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    for w in plan.warnings:
        print(f"  warning: {w}")
    out = Path(args.plan_out or "data/create_out/plan.json")
    write_plan(plan, out)
    print(f"[create] plan: {plan.total_seconds():.1f}s across "
          f"{len(plan.segments)} segments -> {out}")
    return 0


def cmd_build(args) -> int:
    library = _library_from_dir(Path(args.clips_dir),
                                Path(args.manifest) if args.manifest else None,
                                args.internal_eval)
    if not len(library):
        print("error: no usable clips in the library", file=sys.stderr)
        return 1
    recipe = _pick_recipe(args)
    print(f"[create] recipe: {recipe.label}; library {len(library)} clips "
          f"{library.coverage()}")
    try:
        plan = plan_edit(recipe, library, _make_finder(args.index_name),
                         business=args.business)
        out = render(plan, args.out,
                     captions=not args.no_captions,
                     motion=not args.no_motion,
                     normalize=not args.no_grade,
                     caption_model=args.caption_model,
                     music=args.music)
    except AssemblyError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    write_plan(plan, Path(args.out).with_suffix(".plan.json"))
    size_mb = Path(out).stat().st_size / 1e6
    print(f"[create] done: {out} ({size_mb:.1f} MB, {plan.total_seconds():.1f}s)")
    if not library.publishable:
        print("[create] INTERNAL EVAL — this output contains harvested footage "
              "and must not be posted anywhere")
    return 0


def cmd_review(args) -> int:
    """The repeatable editor-eval loop: plan against every refreshed profile,
    score against the trend-derived checklist, render one passing plan.

    No TwelveLabs calls — plans use the heuristic moment fallback, so this can
    run on a schedule with no API key and no budget implications.
    """
    from services.create.review import run_review, write_report

    if not Path(args.profiles).exists():
        print(f"error: no profiles at {args.profiles} — run "
              "`python -m services.discover.trend_style profiles --json-out "
              f"{args.profiles}` first", file=sys.stderr)
        return 2
    report = run_review(
        profiles_path=args.profiles,
        clips_dir=Path(args.clips_dir),
        manifest=Path(args.manifest) if args.manifest else None,
        business=args.business, city=args.city, cuisine=args.cuisine,
        archetypes=args.archetypes,
        render_one=not args.no_render,
        render_dir=args.render_dir)
    md_path, json_path = write_report(report, args.out_dir)
    print(f"\n[review] {'PASS' if report.passed else 'FAIL'} — "
          f"{sum(r.passed for r in report.reviews)}/{len(report.reviews)} "
          f"archetypes clean")
    print(f"[review] report: {md_path} (+ {json_path.name})")
    return 0 if report.passed else 1


def cmd_publish(args) -> int:
    from services.create.publish import InstagramPublisher, PublishError
    token = os.environ.get("IG_ACCESS_TOKEN", "")
    user_id = os.environ.get("IG_USER_ID", "")
    if not token or not user_id:
        print("error: set IG_ACCESS_TOKEN and IG_USER_ID (Instagram Business "
              "account linked to a Facebook Page, app with "
              "instagram_content_publish)", file=sys.stderr)
        return 2
    publisher = InstagramPublisher(token, user_id)
    try:
        if args.check:
            print(json.dumps(publisher.account_check(), indent=2))
            return 0
        result = publisher.publish_reel(args.video_url, args.caption,
                                        dry_run=not args.live)
    except PublishError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    print(result.detail)
    if result.media_id:
        print(f"media id: {result.media_id}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="divvit-create",
                                description="Divvit Create — assemble postable videos from Collection clips")
    sub = p.add_subparsers(dest="command", required=True)

    def common(sp):
        sp.add_argument("--business", required=True)
        sp.add_argument("--clips-dir", required=True)
        sp.add_argument("--manifest", help="JSON: filename -> {content_type, rights_status, ...}")
        sp.add_argument("--archetype", choices=list(RECIPES),
                        help="force a recipe (default: ask Discover)")
        sp.add_argument("--discover-db", default="data/discover.db")
        sp.add_argument("--index-name", default="divvit-discover")
        sp.add_argument("--internal-eval", action="store_true",
                        help="admit internal_eval clips; output is unpublishable")
        sp.add_argument("--city", default="", help="fills {city} in learned hook text")
        sp.add_argument("--cuisine", default="", help="fills {cuisine} in learned hook text")
        sp.add_argument("--no-style", action="store_true",
                        help="ignore learned style profiles; use scaffold recipes")

    pl = sub.add_parser("plan", help="plan the edit without rendering")
    common(pl)
    pl.add_argument("--plan-out")
    pl.set_defaults(func=cmd_plan)

    b = sub.add_parser("build", help="plan and render the video")
    common(b)
    b.add_argument("--out", default="data/create_out/create.mp4")
    b.add_argument("--music", help="path to a licensed music bed (ducked under speech)")
    b.add_argument("--music-gain-db", type=float, default=-18.0)
    b.add_argument("--caption-model", default="small",
                   choices=["tiny", "base", "small", "medium"],
                   help="Whisper size for speech captions (bigger = better, slower)")
    b.add_argument("--no-captions", action="store_true",
                   help="skip burned-in speech captions")
    b.add_argument("--no-motion", action="store_true",
                   help="skip the slow push in/out on each segment")
    b.add_argument("--no-grade", action="store_true",
                   help="skip exposure matching across clips")
    b.set_defaults(func=cmd_build)

    rv = sub.add_parser("review", help="score the editor against the refreshed style profiles")
    rv.add_argument("--profiles", default="data/style_profiles.json")
    rv.add_argument("--clips-dir", default="data/create_clips_test",
                    help="licensed sample clips the eval plans cut from")
    rv.add_argument("--manifest", help="defaults to <clips-dir>/manifest.json")
    rv.add_argument("--business", default="Review Test Cafe")
    rv.add_argument("--city", default="San Diego")
    rv.add_argument("--cuisine", default="cafe")
    rv.add_argument("--archetypes", nargs="*",
                    help="restrict the review (default: every profile with n >= 2)")
    rv.add_argument("--out-dir", default="data/reports")
    rv.add_argument("--render-dir", default="data/create_out/review")
    rv.add_argument("--no-render", action="store_true",
                    help="skip the proving render (plans + scoring only)")
    rv.set_defaults(func=cmd_review)

    pub = sub.add_parser("publish", help="publish a rendered video to Instagram Reels")
    pub.add_argument("--video-url", help="public HTTPS URL of the rendered mp4")
    pub.add_argument("--caption", default="")
    pub.add_argument("--live", action="store_true",
                     help="actually publish (default is dry run)")
    pub.add_argument("--check", action="store_true",
                     help="only validate the token/account and exit")
    pub.set_defaults(func=cmd_publish)
    return p


def main() -> int:
    load_dotenv(_REPO_ROOT / ".env")
    args = build_parser().parse_args()
    try:
        return args.func(args)
    except KeyboardInterrupt:
        print("\ninterrupted", file=sys.stderr)
        return 130


if __name__ == "__main__":
    sys.exit(main())
