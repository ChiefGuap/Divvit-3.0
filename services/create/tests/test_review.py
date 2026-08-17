"""Tests for the trend-refresh path and the editor review loop — no network.

The places a silent wrong answer costs real money or real trust: style tokens
spent on junk video, a budget that doesn't stop, a refresh that erases July's
evidence or lets an entity-bearing hook back in, and a review checklist that
grades a bad plan as shippable.

    .venv/bin/python -m services.create.tests.test_review
"""

from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[3]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from services.create.assemble import EditPlan, PlannedSegment          # noqa: E402
from services.create.recipes import recipe_for, recipe_from_profile    # noqa: E402
from services.create.review import (                                   # noqa: E402
    load_profiles, run_review, score_plan, score_recipe, write_report)
from services.discover.models import DiscoveredVideo, VideoMetrics     # noqa: E402
from services.discover.style import StyleProfile                       # noqa: E402
from services.discover.trend_style import (                            # noqa: E402
    DirectStyleExtractor, TokenBudget, TrendStylePipeline,
    build_direct_profiles, estimate_call_tokens, is_cafe_genuine,
    merge_profile, refresh_profiles)

_failures: list[str] = []


def check(condition: bool, label: str) -> None:
    if condition:
        print(f"  ok   {label}")
    else:
        print(f"  FAIL {label}")
        _failures.append(label)


# ------------------------------------------------------------------ fakes

class FakeResponse:
    def __init__(self, payload: dict, status: int = 200):
        self.payload = payload
        self.status_code = status
        self.text = json.dumps(payload)

    def json(self):
        return self.payload


class FakeSession:
    """Stands in for requests.Session; replays canned /analyze responses."""

    def __init__(self, responses: list[dict]):
        self.responses = list(responses)
        self.calls: list[dict] = []

    def post(self, url, **kwargs):
        self.calls.append(kwargs.get("json") or {})
        if not self.responses:
            raise AssertionError("more calls than canned responses")
        return FakeResponse(self.responses.pop(0))


class FakeStore:
    def __init__(self, videos):
        self.videos = list(videos)
        self.updates: list[tuple[str, dict]] = []

    def query(self, **kwargs):
        return list(self.videos)

    def set_fields(self, canonical_id, **fields):
        self.updates.append((canonical_id, fields))
        for v in self.videos:
            if v.canonical_id == canonical_id:
                for k, val in fields.items():
                    setattr(v, k, val)


class ExplodingStyler:
    """A style extractor that must never be reached."""

    def analyze_file(self, path, budget=None):
        raise AssertionError("style call made on a video that never "
                             "cleared the junk gate")


class OfflineConnector:
    """Refuses to touch the network, loudly."""

    def download(self, video, media_dir):
        from services.discover.connectors.base import ConnectorError
        raise ConnectorError("offline test — no downloads")


class CountingTeacher:
    def __init__(self):
        self.calls = 0
        self.last_usage: dict = {}

    def classify_file(self, path):
        self.calls += 1
        raise AssertionError("gate call made despite exhausted budget")


def _video(vid: str, category: str | None = None, style=None,
           duration: float = 20.0, views: int = 1000) -> DiscoveredVideo:
    v = DiscoveredVideo(platform="tiktok", platform_video_id=vid,
                        url=f"https://example.test/{vid}",
                        title=f"video {vid}", duration_seconds=duration)
    v.metrics = VideoMetrics(view_count=views)
    if category:
        v.classification = {"category": category, "confidence": "high"}
    v.style = style
    return v


# ------------------------------------------------------------------ tests

def test_direct_style_parsing() -> None:
    print("direct style parsing (fake responses)")
    visual = {"has_on_screen_text": True, "hook_text": "you need this",
              "all_on_screen_text": ["you need this"], "caption_style": "big",
              "pacing": "fast", "shot_sequence": ["close-up"],
              "opens_with": "food", "ends_with": "smile", "tone": ["fun"]}
    audio = {"audio_style": "voiceover_with_music", "music_energy": "high",
             "music_genre_hint": "pop", "narration_style": "voiceover"}
    session = FakeSession([
        {"data": visual, "usage": {"input_tokens": 5000, "output_tokens": 100}},
        {"data": "```json\n" + json.dumps(audio) + "\n```",
         "usage": {"input_tokens": 4000, "output_tokens": 50}},
    ])
    styler = DirectStyleExtractor(api_key="test", session=session)
    budget = TokenBudget(cap=100_000)

    with tempfile.TemporaryDirectory() as t:
        clip = Path(t) / "clip.mp4"
        clip.write_bytes(b"fake video bytes")
        style = styler.analyze_file(clip, budget=budget)

    check(style["hook_text"] == "you need this", "visual fields parsed")
    check(style["audio_style"] == "voiceover_with_music",
          "audio fields merged from fenced-JSON response")
    check(style["style_source"] == "pegasus-direct", "provenance recorded")
    check(len(session.calls) == 2, "exactly two calls — split schemas")
    check(session.calls[0]["video"]["type"] == "base64_string",
          "video sourced inline, never an index id")
    check(all(c["max_tokens"] >= 512 for c in session.calls),
          "direct-path minimum max_tokens respected")
    check(budget.spent_input == 9000 and budget.calls == 2,
          "both calls recorded against the budget from usage")

    # Audio failure loses the audio fields, not the record.
    session2 = FakeSession([
        {"data": visual, "usage": {"input_tokens": 5000}},
        {"error": "boom"},  # no data -> StyleError inside
    ])
    styler2 = DirectStyleExtractor(api_key="test", session=session2)
    with tempfile.TemporaryDirectory() as t:
        clip = Path(t) / "clip.mp4"
        clip.write_bytes(b"fake video bytes")
        style2 = styler2.analyze_file(clip)
    check(style2["hook_text"] == "you need this" and "audio_error" in style2,
          "audio-call failure degrades the record instead of losing it")

    with tempfile.TemporaryDirectory() as t:
        big = Path(t) / "big.mp4"
        big.write_bytes(b"x" * (23 * 1024 * 1024))
        try:
            DirectStyleExtractor(api_key="test",
                                 session=FakeSession([])).analyze_file(big)
            check(False, "oversize file rejected before any call")
        except Exception:
            check(True, "oversize file rejected before any call")


def test_junk_gating_order() -> None:
    print("junk gating order")
    videos = [
        _video("junk1", "not_cafe"),
        _video("junk2", "unclassifiable"),
        _video("ungated"),                       # no classification at all
        _video("good", "review"),
    ]
    check(not is_cafe_genuine(videos[0]), "not_cafe is not style-eligible")
    check(not is_cafe_genuine(videos[2]), "ungated video is not style-eligible")
    check(is_cafe_genuine(videos[3]), "gated cafe video is style-eligible")

    store = FakeStore(videos)
    pipe = TrendStylePipeline(store=store, budget=TokenBudget(cap=10**6),
                              styler=ExplodingStyler(),
                              connector=OfflineConnector())
    names = {v.canonical_id for v in pipe.style_candidates(limit=10)}
    check(names == {"tiktok:good"},
          "only the gated cafe video reaches the style queue")

    # Junk and ungated videos never trigger a style call even if the run is
    # driven directly: ExplodingStyler raises on contact, and the only
    # candidate is 'good' — which will fail at download (connector=None) but
    # must be the only one attempted.
    report = pipe.run_extract(limit=10)
    check(report.attempted == 1 and report.styled == 0,
          "style spend attempted only on the gated cafe video")


def test_budget_stop() -> None:
    print("budget stop")
    teacher = CountingTeacher()
    store = FakeStore([_video("v1", duration=30.0)])
    spent = TokenBudget(cap=1000)
    spent.record({"input_tokens": 990})
    pipe = TrendStylePipeline(store=store, budget=spent, teacher=teacher)
    report = pipe.run_gate(limit=5)
    check(teacher.calls == 0, "no gate call once the cap is reached")
    check(report.stopped_for_budget, "the stop is reported, not silent")

    styler = ExplodingStyler()
    store2 = FakeStore([_video("v2", "review", duration=30.0)])
    pipe2 = TrendStylePipeline(store=store2, budget=spent, styler=styler)
    report2 = pipe2.run_extract(limit=5)
    check(report2.stopped_for_budget and report2.styled == 0,
          "no style call once the cap is reached")

    est = estimate_call_tokens(30.0)
    check(est > 10_000, "estimator reflects the measured ~300 tok/s + overhead")

    with tempfile.TemporaryDirectory() as t:
        ledger = Path(t) / "ledger.json"
        b1 = TokenBudget(cap=50_000, ledger_path=ledger)
        b1.record({"input_tokens": 12_345, "output_tokens": 67})
        b2 = TokenBudget(cap=50_000, ledger_path=ledger)
        check(b2.spent_input == 12_345 and b2.calls == 1,
              "spend survives a process restart via the ledger")


def test_profile_refresh() -> None:
    print("profile refresh")
    old = {"archetype": "menu_review", "sample_size": 7, "confidence": "medium",
           "pct_with_text": 0.71, "median_cuts": 13.0,
           "dominant_audio_style": "voiceover_only",
           "common_caption_style": "Large white text",
           "music_genre_hints": ["lofi"],
           "hook_templates": ["ALOHA POKE & GRILL",
                              "TOP 5 INDIAN RESTAURANTS IN LONDON",
                              "Seattleite you should know"]}
    new = {"archetype": "menu_review", "sample_size": 4, "confidence": "low",
           "pct_with_text": 0.0, "median_cuts": 5.0,
           "dominant_audio_style": "voiceover_only",
           "common_caption_style": "",     # unmeasured this run
           "music_genre_hints": [],        # unmeasured this run
           "hook_templates": []}

    merged = merge_profile(old, new)
    check(merged["median_cuts"] == 5.0, "fresh measurement wins")
    check(merged["pct_with_text"] == 0.0,
          "a measured zero beats the stale value — 0.0 is a finding")
    check(merged["common_caption_style"] == "Large white text",
          "unmeasured field keeps the old evidence")
    check(merged["music_genre_hints"] == ["lofi"],
          "unmeasured list keeps the old evidence")
    check(merged["sample_size"] == 4 and merged["confidence"] == "low",
          "sample size and confidence describe this measurement")

    refreshed = refresh_profiles({"menu_review": old}, {"menu_review": new})
    hooks = refreshed["menu_review"]["hook_templates"]
    check(hooks == ["TOP 5 {cuisine} IN {city}"],
          "carried hooks are templatized and entity-screened on the way through")
    check("ALOHA POKE & GRILL" not in json.dumps(refreshed),
          "no business name survives a refresh in templates")

    carried = refresh_profiles({"aesthetic": {"archetype": "aesthetic",
                                              "sample_size": 1,
                                              "hook_templates": ["Seattleite you should know"]}},
                               {})
    check(carried["aesthetic"]["sample_size"] == 1,
          "unsampled archetype carried forward")
    check(carried["aesthetic"]["hook_templates"] == [],
          "first-word demonym hook rejected even when merely carried")


def test_pacing_only_aggregation() -> None:
    print("pacing-only aggregation")
    full_style = {
        "has_on_screen_text": False, "hook_text": "",
        "all_on_screen_text": [], "caption_style": "none",
        "pacing": "fast", "shot_sequence": [], "opens_with": "food",
        "ends_with": "bite", "tone": ["casual"],
        "audio_style": "voiceover_only", "music_energy": "none",
        "music_genre_hint": "", "narration_style": "voiceover",
        "pacing_measured": {"duration_seconds": 20.0, "cut_count": 4,
                            "median_shot_seconds": 4.0},
    }
    pacing_only = {"style_scope": "pacing_only",
                   "pacing_measured": {"duration_seconds": 40.0,
                                       "cut_count": 30,
                                       "median_shot_seconds": 1.0}}
    videos = [_video("f1", "review", style=dict(full_style)),
              _video("f2", "review", style=dict(full_style)),
              _video("p1", "review", style=pacing_only)]
    profiles = build_direct_profiles(videos)
    p = profiles["menu_review"]
    check(p["sample_size"] == 2,
          "pacing-only records do not inflate the analyzed sample")
    check(p["pacing_sample_size"] == 3, "but they widen the rhythm sample")
    check(p["median_cuts"] == 4 and p["median_duration_seconds"] == 20.0,
          "rhythm medians computed over the widened sample")
    check(p["dominant_audio_style"] == "voiceover_only",
          "audio stats come only from fully analyzed videos")


def _passing_profile() -> StyleProfile:
    return StyleProfile(
        archetype="menu_review", sample_size=4, confidence="low",
        median_cuts=5.0, median_shot_seconds=3.0,
        median_duration_seconds=30.0,
        dominant_audio_style="voiceover_only",
        common_caption_style="large white text with black outline at the bottom")


def test_review_checklist() -> None:
    print("review checklist scoring")
    profile = _passing_profile()
    base = recipe_for("menu_review")
    recipe = recipe_from_profile(profile, base=base, city="San Diego",
                                 cuisine="Korean cafe")
    criteria = score_recipe(recipe, profile, base=base)
    check(all(c.passed for c in criteria),
          "a faithfully learned recipe passes recipe conformance")

    def seg(role, clip, dur, overlay=None, start=1.0):
        return PlannedSegment(slot_role=role, clip_id=clip,
                              source_path=f"/tmp/{clip}.mp4", start=start,
                              end=start + dur, moment_source="fallback",
                              overlay=overlay)

    lo = recipe.slots[0].min_seconds
    good = EditPlan(archetype="menu_review", business="Test Cafe", segments=[
        seg("hook", "c1", lo + 0.5, overlay="you need to try this"),
        seg("body", "c2", lo + 0.5),
        seg("body", "c3", lo + 0.5),
        seg("payoff", "c4", lo + 0.5, overlay="Test Cafe"),
    ])
    criteria = score_plan(good, recipe, "Test Cafe", "San Diego",
                          "Korean cafe", publishable=True)
    check(all(c.passed for c in criteria), "a clean plan passes every criterion")

    bad = EditPlan(archetype="menu_review", business="Test Cafe", segments=[
        seg("body", "c1", 25.0),                              # no hook, too long
        seg("payoff", "c1", lo + 0.5,
            overlay="TOP 5 INDIAN RESTAURANTS IN LONDON"),    # reuse + entity
    ])
    results = {c.key: c.passed for c in
               score_plan(bad, recipe, "Test Cafe", "San Diego",
                          "Korean cafe", publishable=False)}
    check(not results["hook_present_first"], "missing hook is caught")
    check(not results["segment_durations_in_bounds"],
          "out-of-bounds segment is caught")
    check(not results["overlays_entity_clean"],
          "an entity-bearing overlay is caught")
    check(not results["no_clip_reuse"], "clip reuse is caught")
    check(not results["rights_clean_library"],
          "an eval-poisoned library is caught")


def test_review_loop_end_to_end() -> None:
    print("review loop (plan-only, stub clips)")
    with tempfile.TemporaryDirectory() as t:
        tmp = Path(t)
        clips = tmp / "clips"
        clips.mkdir()
        manifest = {}
        for name, ctype in (("hook1", "menu_item"), ("body1", "menu_item"),
                            ("body2", "review"), ("pay1", "review")):
            (clips / f"{name}.mp4").write_bytes(b"stub")
            manifest[f"{name}.mp4"] = {"content_type": ctype,
                                       "rights_status": "owned",
                                       "duration_seconds": 12}
        (clips / "manifest.json").write_text(json.dumps(manifest))

        profiles_path = tmp / "profiles.json"
        profiles_path.write_text(json.dumps(
            {"menu_review": _passing_profile().to_dict()}))

        loaded = load_profiles(profiles_path)
        check(loaded["menu_review"].median_cuts == 5.0, "profiles load from JSON")

        extra = json.loads(profiles_path.read_text())
        extra["menu_review"]["pacing_sample_size"] = 6   # unknown key
        profiles_path.write_text(json.dumps(extra))
        check(load_profiles(profiles_path)["menu_review"].sample_size == 4,
              "unknown profile keys are tolerated, not fatal")

        report = run_review(profiles_path, clips, render_one=False,
                            on_status=lambda m: None)
        check(len(report.reviews) == 1 and report.reviews[0].archetype == "menu_review",
              "review covers exactly the refreshed archetypes")
        check(report.passed, "plan-only review passes on the stub library")

        md, js = write_report(report, tmp / "reports")
        check(md.exists() and js.exists(), "report written as md + json")
        check("menu_review" in md.read_text(), "report names the archetype")


def main() -> int:
    for test in (test_direct_style_parsing, test_junk_gating_order,
                 test_budget_stop, test_profile_refresh,
                 test_pacing_only_aggregation, test_review_checklist,
                 test_review_loop_end_to_end):
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
