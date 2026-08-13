"""Tests for Discover's pure logic — no network, no API keys.

Covers the parts where a silent wrong answer is expensive: the store's
preserve-on-refresh contract, the missing-vs-zero distinction in scoring, the
leverage guards the ROI projection rests on, and XML report shape.

    .venv/bin/python -m services.discover.tests.test_discover
"""

from __future__ import annotations

import sys
import tempfile
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[3]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from services.discover.formats import classify                          # noqa: E402
from services.discover.harvest import HarvestFilters, NOISE_KEYWORDS     # noqa: E402
from services.discover.models import (                                   # noqa: E402
    Creator, DiscoveredVideo, VideoMetrics, RIGHTS_INTERNAL_EVAL,
    RIGHTS_REFERENCE, RIGHTS_CREATOR_LICENSED)
from services.discover.report import build_report                        # noqa: E402
from services.discover.roi import (                                      # noqa: E402
    MIN_FOLLOWERS_FOR_LEVERAGE, format_stats, project_roi, score_corpus,
    score_video)
from services.discover.store import CorpusStore                          # noqa: E402

_failures: list[str] = []


def check(condition: bool, label: str) -> None:
    if condition:
        print(f"  ok   {label}")
    else:
        print(f"  FAIL {label}")
        _failures.append(label)


def make_video(vid: str = "v1", views: int = 1000, likes: int | None = 50,
               followers: int | None = 500, days_old: float = 10,
               title: str = "cafe vlog in san diego",
               duration: float = 60.0, **kwargs) -> DiscoveredVideo:
    published = (datetime.now(timezone.utc) - timedelta(days=days_old)).isoformat()
    return DiscoveredVideo(
        platform="youtube", platform_video_id=vid,
        url=f"https://www.youtube.com/watch?v={vid}",
        title=title, duration_seconds=duration, published_at=published,
        metrics=VideoMetrics(view_count=views, like_count=likes, comment_count=None),
        creator=Creator(handle="@someone", follower_count=followers),
        **kwargs)


# ------------------------------------------------------------------ models

def test_models() -> None:
    print("models")
    v = make_video(title="Best cafe #sandiego", views=1000)
    check("sandiego" in v.derive_hashtags(), "hashtags recovered from title text")
    check(v.canonical_id == "youtube:v1", "canonical id is platform:video_id")

    check(VideoMetrics(view_count=10).engagement_total() is None,
          "no engagement data reads as None, not zero")
    check(VideoMetrics(like_count=0, comment_count=0).engagement_total() == 0,
          "real zeros still read as zero")

    check(not make_video().is_publicly_displayable(),
          "harvested video is not publicly displayable by default")
    check(make_video(rights_status=RIGHTS_CREATOR_LICENSED).is_publicly_displayable(),
          "creator-licensed video is displayable")
    check(not make_video(rights_status=RIGHTS_INTERNAL_EVAL).is_publicly_displayable(),
          "internal eval copy is NOT displayable")

    check(make_video(width=320, height=240).meets_screening_resolution() is False,
          "320x240 fails the TwelveLabs resolution floor")
    check(make_video(width=1280, height=720).meets_screening_resolution() is True,
          "720p passes the resolution floor")
    check(make_video().meets_screening_resolution() is None,
          "unknown resolution is None, not False")


# ------------------------------------------------------------------- store

def test_store() -> None:
    print("store")
    with tempfile.TemporaryDirectory() as tmp:
        store = CorpusStore(Path(tmp) / "t.db")
        v = make_video()
        check(store.upsert(v) is True, "first upsert reports a new row")
        check(store.upsert(v) is False, "second upsert is a refresh, not a new row")
        check(len(store.query()) == 1, "dedupe on canonical_id")

        # earn some pipeline state, then re-harvest the same video
        store.set_fields(v.canonical_id, rights_status=RIGHTS_INTERNAL_EVAL,
                         local_path="/tmp/x.mp4",
                         screening={"verdict": "approved_for_collection"})
        fresh = make_video(views=9999)  # a scraper record: default rights, no state
        store.upsert(fresh)
        got = store.get(v.canonical_id)
        check(got.metrics.view_count == 9999, "refresh updates metrics")
        check(got.rights_status == RIGHTS_INTERNAL_EVAL, "refresh preserves rights status")
        check(got.local_path == "/tmp/x.mp4", "refresh preserves downloaded media path")
        check(got.screening["verdict"] == "approved_for_collection",
              "refresh preserves screening verdict")

        store.upsert(make_video(vid="v2", views=10))
        check(len(store.query(unscreened_only=True)) == 1, "unscreened filter")
        check(len(store.query(screened_only=True)) == 1, "screened filter")
        check(store.counts()["total"] == 2, "counts total")

        # round-trip through JSON columns
        check(store.get("youtube:v2").creator.follower_count == 500,
              "creator survives serialization round-trip")


# ------------------------------------------------------------------ filters

def test_creator_supply() -> None:
    print("creator supply")
    with tempfile.TemporaryDirectory() as tmp:
        store = CorpusStore(Path(tmp) / "c.db")

        def add(vid, handle, verdict=None):
            v = make_video(vid=vid)
            v.creator = Creator(handle=handle, follower_count=5000)
            if verdict:
                v.screening = {"verdict": verdict, "analysis": {}}
            store.upsert(v)

        # a good supplier, a bad one, and a creator seen only once
        add("g1", "@goodfood", "approved_for_collection")
        add("g2", "@goodfood", "approved_for_collection")
        add("g3", "@goodfood")
        add("b1", "@skitguy", "rejected")
        add("b2", "@skitguy", "rejected")
        add("b3", "@skitguy")
        add("o1", "@oneoff")
        add("n1", "no-at-sign")

        tallies = store.refresh_creators()
        check(tallies["blocked"] == 1, "creator with only rejections is auto-blocked")
        rows = {r["handle"]: r for r in store.creator_rows()}
        check(rows["@goodfood"]["videos_approved"] == 2, "approvals tallied")
        check(rows["@skitguy"]["status"] == "blocked", "bad supplier blocked")
        check(rows["@goodfood"]["status"] == "candidate", "good supplier stays active")
        check("no-at-sign" not in rows, "non-handle creator names are not tracked")

        top = store.top_creators(min_videos=2)
        check("@goodfood" in top, "good supplier is seeded")
        check("@skitguy" not in top, "blocked supplier is never seeded")
        check("@oneoff" not in top, "single-video creator is below the seeding floor")
        check(top[0] == "@goodfood", "most-approved supplier ranks first")

        # a manual block must survive a refresh
        store.set_creator_status("@goodfood", "blocked")
        store.refresh_creators()
        check(store.creator_rows()[0]["status"] == "blocked" or
              {r["handle"]: r for r in store.creator_rows()}["@goodfood"]["status"]
              == "blocked", "manual block survives refresh")


def test_filters() -> None:
    print("filters")
    f = HarvestFilters(max_age_days=30)
    check(f.passes(make_video())[0], "ordinary short video passes")
    check(not f.passes(make_video(duration=600))[0], "long-form rejected")
    check(not f.passes(make_video(duration=1))[0], "sub-5s stub rejected")
    check(not f.passes(make_video(days_old=400))[0], "stale video rejected by max_age_days")
    check(not f.passes(make_video(title="Coffee Shop COMMERCIAL 2024"))[0],
          "commercial rejected by noise filter")
    check(not f.passes(make_video(title="lofi jazz music to study to"))[0],
          "music playlist rejected by noise filter")
    check(not f.passes(make_video(followers=9_000_000))[0],
          "media-company-scale channel rejected")
    check(f.passes(make_video(title="honest review of this cafe"))[0],
          "the word 'review' is not treated as noise")
    check(not f.passes(make_video(duration=120))[0],
          "2-minute mini-vlog rejected (Shorts/Reels/TikTok only)")
    check(not f.passes(make_video(width=1920, height=1080))[0],
          "landscape 16:9 rejected by the vertical gate")
    check(f.passes(make_video(width=1080, height=1920))[0],
          "vertical 9:16 passes the vertical gate")
    check(f.passes(make_video())[0],
          "unknown orientation is not rejected pre-enrichment")
    check(HarvestFilters(require_vertical=False).passes(
        make_video(width=1920, height=1080))[0],
        "vertical gate is opt-out")
    check(all(k == k.lower() for k in NOISE_KEYWORDS),
          "noise keywords are lowercase (matching is lowercased)")


# ---------------------------------------------------------------- scoring

def test_scoring() -> None:
    print("scoring")
    s = score_video(make_video(views=1000, likes=50, followers=500, days_old=10))
    check(abs(s.engagement_rate - 0.05) < 1e-9, "engagement rate = engagement / views")
    check(abs(s.audience_leverage - 2.0) < 1e-9, "leverage = views / followers")
    check(abs(s.view_velocity - 100.0) < 1e-6, "velocity = views / days")

    check(score_video(make_video(likes=None)).engagement_rate is None,
          "unknown engagement stays None instead of scoring as 0%")
    check(score_video(make_video(followers=MIN_FOLLOWERS_FOR_LEVERAGE - 1)
                      ).audience_leverage is None,
          "leverage suppressed below the follower floor")
    check(score_video(make_video(followers=MIN_FOLLOWERS_FOR_LEVERAGE)
                      ).audience_leverage is not None,
          "leverage kept at the follower floor")

    # percentile composite: more leverage should outrank less, all else equal
    videos = [make_video(vid=f"v{i}", views=100 * i, likes=5 * i, followers=500)
              for i in range(1, 6)]
    scored = score_corpus(videos)
    ordered = sorted(videos, key=lambda v: scored[v.canonical_id].format_score)
    check(ordered[-1].platform_video_id == "v5", "highest-leverage video ranks top")
    check(all(scored[v.canonical_id].format_score is not None for v in videos),
          "every fully-populated video gets a score")

    # a video with nothing measurable must not fabricate a score
    bare = DiscoveredVideo(platform="youtube", platform_video_id="bare",
                           url="http://x", title="cafe")
    check(score_corpus([bare])["youtube:bare"].format_score is None,
          "video with no metrics gets no score")


def test_roi() -> None:
    print("roi")
    videos = [make_video(vid=f"v{i}", views=2000, likes=100, followers=1000,
                         title="cafe vlog day in my life") for i in range(12)]
    stats = format_stats(videos)
    top = stats[0]
    check(top.archetype == "cafe_vlog", "keyword classification groups the cohort")
    check(top.sample_size == 12, "sample size counted")
    check(top.confidence == "medium", "12 samples reads as medium confidence")
    check(abs(top.median_leverage - 2.0) < 1e-9, "median leverage")

    p = project_roi(top, videos_planned=10, reward_cost_usd=15.0,
                    creator_followers=800, cpm_usd=12.0)
    check(p.assumptions["basis"] == "leverage", "projection uses leverage basis")
    check(p.projected_views_per_video == 1600, "2.0 leverage x 800 followers = 1600")
    check(p.projected_impressions == 16000, "impressions = views x videos")
    check(abs(p.projected_emv_usd - 192.0) < 1e-6, "EMV = 16000/1000 x $12")
    check(abs(p.campaign_cost_usd - 150.0) < 1e-6, "cost = 10 x $15")
    check(p.assumptions.get("note"), "projection ships with its caveat attached")
    check(p.brief, "projection carries the creator brief for the format")

    # no follower data anywhere -> must fall back and say so
    no_followers = [make_video(vid=f"n{i}", followers=None) for i in range(5)]
    fb = project_roi(format_stats(no_followers)[0], creator_followers=800)
    check(fb.assumptions["basis"] == "median_views_fallback", "fallback basis flagged")
    check(fb.confidence == "low", "fallback is always low confidence")


def test_classification() -> None:
    print("classification")
    check(classify(make_video(title="best cafes in san diego ranked")) == "ranking_list",
          "ranking keywords")
    check(classify(make_video(title="hidden gem you need to try")) == "hidden_gem",
          "hidden gem keywords")
    check(classify(make_video(title="random unrelated clip")) == "unclassified",
          "no keyword match is unclassified, not a guess")

    # screening beats keywords, because it actually watched the video
    v = make_video(title="best cafes in san diego ranked")
    v.screening = {"analysis": {"content_type": "interior",
                                "content_type_confidence": "high"}}
    check(classify(v) == "aesthetic", "screening verdict overrides keyword guess")
    v.screening = {"analysis": {"content_type": "interior",
                                "content_type_confidence": "low"}}
    check(classify(v) == "ranking_list", "low-confidence screening does not override")


# ------------------------------------------------------------------ report

def test_report() -> None:
    print("report")
    videos = [make_video(vid=f"v{i}", title="cafe vlog") for i in range(3)]
    videos[0].screening = {
        "verdict": "approved_for_collection", "mode": "catalog",
        "reasons": ["venue n/a"], "video_id": "tl123", "index_id": "idx1",
        "analysis": {"is_food_beverage_content": True, "content_type": "vlog",
                     "content_type_confidence": "high", "venue_match": "n/a",
                     "detected_items": ["matcha latte"], "sentiment": "positive",
                     "quality_flags": [], "summary": "A cafe visit."},
    }
    scores = score_corpus(videos)
    tree = build_report(
        run_id="test", started_at="2026-01-01T00:00:00+00:00",
        finished_at="2026-01-01T00:05:00+00:00",
        config_summary={"connector": "ytdlp"},
        harvest_stats={"status": "completed", "new_videos": 3},
        screening_stats={"status": "completed", "screened": 1,
                         "verdicts": {"approved_for_collection": 1}},
        videos=videos, scores=scores,
        formats=[(s, project_roi(s)) for s in format_stats(videos, scores)],
        corpus_counts={"total": 3, "screened": 1, "by_platform": {"youtube": 3}},
        errors=["something went wrong"])

    xml = ET.tostring(tree.getroot(), encoding="unicode")
    root = ET.fromstring(xml)  # must be parseable, not just serializable
    check(root.tag == "divvit-discover-run", "root element")
    check(root.find("videos").get("count") == "3", "video count attribute")
    check(len(root.findall("videos/video/screening")) == 1, "screening nested under video")
    check(root.find("videos/video/screening/analysis").get(
        "food-beverage-content") == "true", "booleans render XML-style, not Python-style")
    check(root.find(".//detected-items/item").text == "matcha latte", "detected items")
    check(root.find("screening-summary/verdict").get("count") == "1", "verdict tally")
    check(len(root.findall("errors/error")) == 1, "errors included")
    check(root.find(".//format-roi/format/projection/note") is not None,
          "ROI caveat survives into the report")

    # absent values must be absent, not empty strings
    bare = DiscoveredVideo(platform="youtube", platform_video_id="b", url="http://x")
    el = ET.fromstring(ET.tostring(build_report(
        run_id="t", started_at="", finished_at="", config_summary={},
        harvest_stats={}, screening_stats={}, videos=[bare]).getroot(),
        encoding="unicode"))
    check("published-at" not in el.find("videos/video").attrib,
          "unknown fields are omitted rather than written empty")


def main() -> int:
    for test in (test_models, test_store, test_creator_supply, test_filters,
                 test_scoring, test_roi, test_classification, test_report):
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
