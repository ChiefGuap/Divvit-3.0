"""Tests for Create — no network, no API keys, no rendering.

Focus is the places where a silent wrong answer ships a bad video to a
business's audience: the rights gate, hook templating (a wrong city on screen),
caption legibility, and slot allocation.

    .venv/bin/python -m services.create.tests.test_create
"""

from __future__ import annotations

import sys
import tempfile
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[3]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from services.create.assemble import _fit_caption, plan_edit, AssemblyError  # noqa: E402
from services.create.library import Clip, ClipLibrary                        # noqa: E402
from services.create.moments import MomentFinder                             # noqa: E402
from services.create.recipes import (                                        # noqa: E402
    CaptionStyle, recipe_for, recipe_from_profile)
from services.discover.style import (                                        # noqa: E402
    StyleProfile, is_reusable_hook, templatize)

_failures: list[str] = []


def check(condition: bool, label: str) -> None:
    if condition:
        print(f"  ok   {label}")
    else:
        print(f"  FAIL {label}")
        _failures.append(label)


def _clip(tmp: Path, name: str, content_type: str,
          rights: str = "owned", tl_id: str | None = None) -> Clip:
    path = tmp / f"{name}.mp4"
    path.write_bytes(b"stub")
    return Clip(clip_id=name, local_path=path, content_type=content_type,
                duration_seconds=15.0, rights_status=rights,
                twelvelabs_video_id=tl_id)


def test_rights_gate() -> None:
    print("rights gate")
    with tempfile.TemporaryDirectory() as t:
        tmp = Path(t)
        clips = [
            _clip(tmp, "owned1", "menu_item", "owned"),
            _clip(tmp, "licensed1", "review", "creator_licensed"),
            _clip(tmp, "harvested1", "review", "internal_eval"),
            _clip(tmp, "reference1", "interior", "unlicensed_reference"),
        ]
        lib = ClipLibrary(clips)
        ids = {c.clip_id for c in lib.clips}
        check(ids == {"owned1", "licensed1"},
              "only owned/licensed clips reach the assembler")
        check(lib.publishable, "a clean library is publishable")

        loose = ClipLibrary(clips, allow_internal_eval=True)
        check("harvested1" in {c.clip_id for c in loose.clips},
              "internal_eval admitted only when explicitly allowed")
        check("reference1" not in {c.clip_id for c in loose.clips},
              "unlicensed_reference is never admitted, even in eval mode")
        check(not loose.publishable,
              "an eval library is marked unpublishable")

        missing = ClipLibrary([Clip(clip_id="gone",
                                    local_path=tmp / "nope.mp4",
                                    content_type="review")])
        check(len(missing) == 0, "clip with a missing file is dropped")


def test_hook_templating() -> None:
    print("hook templating")
    check(templatize("Best Pizza Spots in San Diego") == "Best {cuisine} in {city}",
          "city and cuisine both templatized")
    check(is_reusable_hook("Best {cuisine} in {city}"), "clean template is reusable")
    check(not is_reusable_hook(templatize("ALOHA POKE & GRILL")),
          "business name rejected as a reusable hook")
    check(not is_reusable_hook(templatize("Meet Isaiah, the pizza guy!")),
          "personal name rejected as a reusable hook")
    check(not is_reusable_hook("{cuisine} {city}"),
          "placeholders-only template carries no pattern")
    check(is_reusable_hook("you need to try this"),
          "generic lowercase hook is reusable")
    check(not is_reusable_hook("x" * 90), "over-long hook rejected")


def test_caption_style() -> None:
    print("caption style")
    c = CaptionStyle.from_description(
        "Large white text with black outline, centered at the bottom of the screen")
    check(c.color == "white", "text colour parsed, not the outline colour")
    check(c.border_color.startswith("black"), "outline colour parsed separately")
    check(c.fontsize > 64 and c.y_fraction > 0.5, "size and position parsed")

    top = CaptionStyle.from_description("small yellow text with black outline at the top")
    check(top.color == "yellow" and top.y_fraction < 0.3, "top-positioned yellow parsed")

    same = CaptionStyle.from_description("white text with white outline")
    check(same.border_color.split("@")[0] != same.color,
          "text and outline are never the same colour")

    default = CaptionStyle.from_description("")
    check(default.color == "white" and default.source == "default",
          "empty description falls back to a legible default")


def test_caption_fitting() -> None:
    print("caption fitting")
    wrapped, size = _fit_caption("TOP 5 Korean cafe IN San Diego", 76)
    check("\n" in wrapped, "long hook wraps rather than clipping off-frame")
    check(all(len(line) * size * 0.52 <= 1080 for line in wrapped.split("\n")),
          "every wrapped line fits inside the frame")
    short, short_size = _fit_caption("La Bora", 76)
    check("\n" not in short and short_size == 76, "short text is left alone")
    huge, huge_size = _fit_caption("word " * 30, 76)
    check(huge_size < 76, "text too long even wrapped gets shrunk")


def test_recipe_from_profile() -> None:
    print("learned recipes")
    profile = StyleProfile(
        archetype="menu_review", sample_size=7, confidence="medium",
        median_cuts=13.0, median_shot_seconds=2.75, median_duration_seconds=68.3,
        hook_templates=["TOP 5 {cuisine} IN {city}"],
        common_caption_style="Large white text with black outline at the bottom",
        dominant_audio_style="voiceover_only", dominant_music_energy="none",
        tone_words=["engaging", "casual"])
    r = recipe_from_profile(profile, city="San Diego", cuisine="Korean cafe")

    check(r.is_learned, "recipe reports that it was learned")
    check(len(r.slots) == 6, "slot count follows the observed cut count")
    check(abs(r.target_seconds - 68.3) < 0.01, "target length follows observed duration")
    check(all(s.min_seconds < s.max_seconds for s in r.slots),
          "every slot has a valid duration window")
    check(abs(r.slots[0].max_seconds - 4.4) < 0.01,
          "slot durations scale from the measured shot length")
    check(r.slots[0].overlay == "TOP 5 Korean cafe IN San Diego",
          "hook template refilled with this business's city and cuisine")
    check(r.caption_style.color == "white", "caption style carried onto the recipe")
    check("voiceover_only" in r.music_hint, "audio treatment carried onto the recipe")
    check(r.derived_from["sample_size"] == 7, "evidence retained for the dashboard")

    # A hook naming someone else's city must never survive to the screen.
    bad = StyleProfile(archetype="menu_review", sample_size=5,
                       hook_templates=["TOP 5 in LONDON"], median_cuts=4.0)
    r2 = recipe_from_profile(bad, city="San Diego", cuisine="Korean cafe")
    check(r2.slots[0].overlay != "TOP 5 in LONDON",
          "hook naming another city is rejected before rendering")

    # A profile with nothing measured must not produce a degenerate recipe.
    thin = StyleProfile(archetype="menu_review", sample_size=1)
    r3 = recipe_from_profile(thin)
    base = recipe_for("menu_review")
    check(len(r3.slots) == len(base.slots),
          "empty profile falls back to the scaffold slot count")
    check(r3.target_seconds == base.target_seconds,
          "empty profile falls back to the scaffold length")


def test_slot_allocation() -> None:
    print("slot allocation")
    with tempfile.TemporaryDirectory() as t:
        tmp = Path(t)
        # 4 menu_item clips but only 1 review clip: the payoff slot needs the
        # review clip, and a permissive body slot must not take it first.
        lib = ClipLibrary([
            _clip(tmp, "m1", "menu_item"), _clip(tmp, "m2", "menu_item"),
            _clip(tmp, "m3", "menu_item"), _clip(tmp, "only_review", "review"),
        ])
        finder = MomentFinder(api_key="", index_id=None)  # forces fallback
        plan = plan_edit(recipe_for("menu_review"), lib, finder,
                         business="Test Cafe", on_status=lambda m: None)
        payoff = [s for s in plan.segments if s.slot_role == "payoff"]
        check(payoff and payoff[0].clip_id == "only_review",
              "scarce review clip is reserved for the payoff slot")
        ids = [s.clip_id for s in plan.segments]
        check(len(ids) == len(set(ids)), "no clip is used twice")
        check(all(s.moment_source == "fallback" for s in plan.segments),
              "unindexed clips fall back instead of erroring")

        thin = ClipLibrary([_clip(tmp, "solo", "menu_item")])
        try:
            plan_edit(recipe_for("menu_review"), thin, finder, business="X",
                      on_status=lambda m: None)
            check(False, "one-clip library should refuse to build")
        except AssemblyError:
            check(True, "one-clip library refuses to build")


def main() -> int:
    for test in (test_rights_gate, test_hook_templating, test_caption_style,
                 test_caption_fitting, test_recipe_from_profile,
                 test_slot_allocation):
        test()
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
