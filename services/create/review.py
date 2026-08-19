"""The editor review loop — Create grades its own output against the market.

Create learns its style from measured profiles; this module closes the loop by
checking, on every run, that what the editor PLANS still matches what the
profiles SAY. It is the difference between "we refreshed the style data" and
"the editor demonstrably builds to the refreshed style". Run it after every
profile refresh, and on a schedule, so drift is caught by a failing criterion
instead of by a business asking why their video feels dated.

The loop is deliberately cheap: plans are built with the heuristic moment
finder (no TwelveLabs, no network), against the licensed sample clips, and
scored against an explicit checklist derived from the trend data. One real
ffmpeg render proves the pipeline end-to-end — a plan that scores well but
cannot render is a lie with good posture.

Checklist criteria come in two layers:

  * recipe conformance — did the learned recipe actually adopt the profile's
    numbers (slot count from cut rhythm, windows from shot length, target from
    median duration, audio hint from the dominant treatment)?
  * plan safety — is the concrete cut shippable (durations inside slot bounds,
    hook present and entity-clean, every overlay entity-clean, no clip reused,
    rights-clean library)?

Everything is pass/fail with the observed value written next to the expected
one, because "FAIL: total 96s, allowed 8-42s" is actionable and a score of
0.73 is not.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Optional

from services.discover.style import StyleProfile
from services.create.assemble import AssemblyError, EditPlan, plan_edit, render
from services.create.library import ClipLibrary
from services.create.moments import MomentFinder
from services.create.recipes import (
    HOOK, RECIPES, Recipe, _mentions_other_entity, recipe_for,
    recipe_from_profile)

# Bounds a short-form video must live inside regardless of what any profile
# says — the platform reality the trend data sits within.
MIN_TOTAL_SECONDS = 8.0
MAX_TOTAL_SECONDS = 90.0

# Above the profile target by more than this, the edit has stopped following
# the market's attention span; the floor is looser because a thin clip library
# legitimately shortens a cut (missing slots shrink the edit by design).
TARGET_CEILING_RATIO = 1.35
TARGET_FLOOR_RATIO = 0.30


@dataclass
class Criterion:
    key: str
    passed: bool
    expected: str
    observed: str

    def line(self) -> str:
        mark = "pass" if self.passed else "FAIL"
        return f"  {mark}  {self.key:<28} expected {self.expected}; got {self.observed}"


@dataclass
class ArchetypeReview:
    archetype: str
    criteria: list[Criterion] = field(default_factory=list)
    error: str = ""
    plan_total_seconds: Optional[float] = None
    segments: int = 0
    render_path: str = ""

    @property
    def passed(self) -> bool:
        return not self.error and all(c.passed for c in self.criteria)

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["passed"] = self.passed
        return d


@dataclass
class ReviewReport:
    generated_at: str = ""
    profiles_path: str = ""
    reviews: list[ArchetypeReview] = field(default_factory=list)

    @property
    def passed(self) -> bool:
        return bool(self.reviews) and all(r.passed for r in self.reviews)

    def to_dict(self) -> dict[str, Any]:
        return {"generated_at": self.generated_at,
                "profiles_path": self.profiles_path,
                "passed": self.passed,
                "reviews": [r.to_dict() for r in self.reviews]}


# ------------------------------------------------------------------ loading

def load_profiles(path: Path | str) -> dict[str, StyleProfile]:
    """style_profiles.json -> StyleProfile objects.

    Tolerates extra keys (`pacing_sample_size` and whatever future refreshes
    add) by filtering to the dataclass's fields — the profiles file is a
    contract with more writers than readers.
    """
    raw = json.loads(Path(path).read_text())
    known = set(StyleProfile.__dataclass_fields__)
    out = {}
    for archetype, p in raw.items():
        out[archetype] = StyleProfile(
            **{k: v for k, v in p.items() if k in known})
    return out


# ------------------------------------------------------------------ scoring

def _clamped_slot_count(median_cuts: Optional[float], fallback: int) -> int:
    if not median_cuts:
        return fallback
    return max(3, min(int(round(median_cuts)), 6))


def score_recipe(recipe: Recipe, profile: StyleProfile,
                 base: Optional[Recipe] = None) -> list[Criterion]:
    """Did the learned recipe adopt the profile's measurements?"""
    base = base or recipe_for(profile.archetype)
    out: list[Criterion] = []

    expected_slots = _clamped_slot_count(profile.median_cuts, len(base.slots))
    out.append(Criterion(
        "slot_count_follows_cuts", len(recipe.slots) == expected_slots,
        f"{expected_slots} (median_cuts={profile.median_cuts})",
        str(len(recipe.slots))))

    shot = profile.median_shot_seconds
    if shot:
        lo, hi = max(1.0, round(shot * 0.7, 2)), round(shot * 1.6, 2)
        ok = all(abs(s.min_seconds - lo) < 0.02 and abs(s.max_seconds - max(lo + 0.5, hi)) < 0.02
                 for s in recipe.slots)
        out.append(Criterion("slot_windows_from_shot_length", ok,
                             f"{lo}-{hi}s from {shot}s shots",
                             f"{recipe.slots[0].min_seconds}-{recipe.slots[0].max_seconds}s"))

    target_src = profile.median_duration_seconds or base.target_seconds
    out.append(Criterion(
        "target_length_from_profile",
        abs(recipe.target_seconds - round(float(target_src), 1)) < 0.06,
        f"{round(float(target_src), 1)}s", f"{recipe.target_seconds}s"))

    if profile.dominant_audio_style:
        out.append(Criterion(
            "audio_hint_from_profile",
            recipe.music_hint.startswith(profile.dominant_audio_style),
            profile.dominant_audio_style, recipe.music_hint or "(empty)"))

    style = recipe.caption_style
    legible = (style.color != style.border_color.split("@")[0]
               and 34 <= style.fontsize <= 96
               and 0.0 <= style.y_fraction <= 1.0)
    out.append(Criterion(
        "caption_style_legible", legible,
        "text != outline colour, size 34-96",
        f"{style.color} on {style.border_color}, {style.fontsize}px"))
    return out


def score_plan(plan: EditPlan, recipe: Recipe,
               business: str, city: str, cuisine: str,
               publishable: bool) -> list[Criterion]:
    """Is the concrete cut shippable?"""
    out: list[Criterion] = []
    fill = {"business": business, "city": city or "your city",
            "cuisine": cuisine or "food"}

    out.append(Criterion("min_segments", len(plan.segments) >= 2,
                         ">= 2", str(len(plan.segments))))

    lo = min(s.min_seconds for s in recipe.slots)
    hi = max(s.max_seconds for s in recipe.slots)
    bad = [round(s.end - s.start, 2) for s in plan.segments
           if not (lo - 0.05 <= s.end - s.start <= hi + 0.05)]
    out.append(Criterion("segment_durations_in_bounds", not bad,
                         f"{lo}-{hi}s each", f"out of bounds: {bad}" if bad else "all in"))

    total = plan.total_seconds()
    floor = max(MIN_TOTAL_SECONDS, recipe.target_seconds * TARGET_FLOOR_RATIO)
    ceiling = min(MAX_TOTAL_SECONDS, recipe.target_seconds * TARGET_CEILING_RATIO)
    out.append(Criterion("total_length_in_range",
                         floor <= total <= ceiling,
                         f"{floor:.1f}-{ceiling:.1f}s (target {recipe.target_seconds}s)",
                         f"{total:.1f}s"))

    hook_segments = [s for s in plan.segments if s.slot_role == HOOK]
    hook_ok = bool(hook_segments) and plan.segments[0].slot_role == HOOK
    out.append(Criterion("hook_present_first", hook_ok, "hook fills slot 1",
                         plan.segments[0].slot_role if plan.segments else "(none)"))

    dirty = [s.overlay for s in plan.segments
             if s.overlay and (_mentions_other_entity(s.overlay, fill)
                               or not (3 <= len(s.overlay) <= 60))]
    out.append(Criterion("overlays_entity_clean", not dirty,
                         "no foreign entities, 3-60 chars",
                         f"rejected: {dirty}" if dirty else "all clean"))

    ids = [s.clip_id for s in plan.segments]
    out.append(Criterion("no_clip_reuse", len(ids) == len(set(ids)),
                         "each clip at most once", ", ".join(ids)))

    out.append(Criterion("rights_clean_library", publishable,
                         "owned/licensed clips only",
                         "publishable" if publishable else "internal_eval poisoned"))
    return out


# ---------------------------------------------------------------- the loop

def run_review(profiles_path: Path | str,
               clips_dir: Path | str,
               manifest: Optional[Path | str] = None,
               business: str = "Review Test Cafe",
               city: str = "San Diego",
               cuisine: str = "cafe",
               archetypes: Optional[list[str]] = None,
               render_one: bool = True,
               render_dir: Path | str = "data/create_out/review",
               library_builder: Optional[Callable[..., ClipLibrary]] = None,
               on_status: Callable[[str], None] = print) -> ReviewReport:
    """Plan against every refreshed profile, score, optionally render one.

    Plans use the heuristic moment fallback (no index id is ever passed), so
    the loop is runnable with no network and no API key. The single render is
    the exception — ffmpeg, local, free — and renders the first PASSING plan,
    because proving the pipeline on a failing plan proves the wrong thing.
    """
    from services.create.cli import _library_from_dir  # shared manifest logic

    profiles = load_profiles(profiles_path)
    clips_dir = Path(clips_dir)
    manifest = Path(manifest) if manifest else clips_dir / "manifest.json"
    builder = library_builder or (lambda: _library_from_dir(
        clips_dir, manifest if manifest.exists() else None, internal_eval=False))

    report = ReviewReport(
        generated_at=datetime.now(timezone.utc).isoformat(),
        profiles_path=str(profiles_path))

    # Default to archetypes with an actual sample behind them (n >= 2). The
    # n=1 profiles carried from July would fail on fixture thinness — a
    # 4-clip test library cannot hit a 69s vlog target — and that failure
    # would say nothing about the editor. Reviewing them stays one
    # --archetypes flag away.
    wanted = archetypes or [a for a in profiles
                            if (profiles[a].sample_size or 0) >= 2]
    finder = MomentFinder(api_key="", index_id=None)  # heuristic fallback only
    rendered = False

    for archetype in wanted:
        profile = profiles.get(archetype)
        review = ArchetypeReview(archetype=archetype)
        report.reviews.append(review)
        if profile is None or not profile.sample_size:
            review.error = "no profile data for this archetype"
            continue

        base = recipe_for(archetype)
        recipe = recipe_from_profile(profile, base=base, city=city,
                                     cuisine=cuisine)
        review.criteria.extend(score_recipe(recipe, profile, base=base))

        library = builder()
        try:
            plan = plan_edit(recipe, library, finder, business=business,
                             on_status=lambda m: None)
        except AssemblyError as exc:
            review.error = f"plan failed: {exc}"
            on_status(f"[review] {archetype}: PLAN FAILED — {exc}")
            continue

        review.plan_total_seconds = round(plan.total_seconds(), 2)
        review.segments = len(plan.segments)
        review.criteria.extend(score_plan(plan, recipe, business, city,
                                          cuisine, library.publishable))

        on_status(f"[review] {archetype}: "
                  f"{'PASS' if review.passed else 'FAIL'} "
                  f"({review.segments} segments, {review.plan_total_seconds}s)")
        for c in review.criteria:
            if not c.passed:
                on_status(c.line())

        if render_one and not rendered and review.passed:
            out = Path(render_dir) / f"review-{archetype}.mp4"
            try:
                # Speech captions stay off: they need a Whisper model and the
                # loop must run anywhere. Overlay burning still exercises the
                # learned caption styling.
                path = render(plan, out, captions=False,
                              on_status=lambda m: None)
                review.render_path = str(path)
                rendered = True
                size_mb = path.stat().st_size / 1e6
                on_status(f"[review] rendered {path} ({size_mb:.1f} MB)")
            except AssemblyError as exc:
                review.error = f"render failed: {exc}"
                on_status(f"[review] {archetype}: RENDER FAILED — {exc}")

    return report


# --------------------------------------------------------------- reporting

def write_report(report: ReviewReport, out_dir: Path | str) -> tuple[Path, Path]:
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    stamp = report.generated_at[:10]
    json_path = out_dir / f"create-review-{stamp}.json"
    md_path = out_dir / f"create-review-{stamp}.md"

    json_path.write_text(json.dumps(report.to_dict(), indent=2))

    lines = [f"# Create editor review — {stamp}",
             "",
             f"Profiles: `{report.profiles_path}`  ",
             f"Overall: **{'PASS' if report.passed else 'FAIL'}**",
             ""]
    for r in report.reviews:
        status = "PASS" if r.passed else "FAIL"
        lines.append(f"## {r.archetype} — {status}")
        if r.error:
            lines += ["", f"error: {r.error}", ""]
            continue
        lines += ["",
                  f"{r.segments} segments, {r.plan_total_seconds}s planned"
                  + (f", rendered `{r.render_path}`" if r.render_path else ""),
                  "",
                  "| criterion | result | expected | observed |",
                  "|---|---|---|---|"]
        for c in r.criteria:
            lines.append(f"| {c.key} | {'pass' if c.passed else '**FAIL**'} "
                         f"| {c.expected} | {c.observed} |")
        lines.append("")
    md_path.write_text("\n".join(lines))
    return md_path, json_path
