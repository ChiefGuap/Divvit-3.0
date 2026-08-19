"""Tests for the cafe roster and Brand Health — no network, no API keys.

The expensive silent failures here: a chain on the independents roster (we
pitch Starbucks a dashboard), a lost cafe (duplicate key collapse), a blocked
Yelp scrape read as a zero-star cafe (missing-vs-zero), and a metrics re-run
that restarts from cafe #1 instead of resuming.

    .venv/bin/python -m services.venues.tests.test_roster
"""

from __future__ import annotations

import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[3]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from services.discover.models import DiscoveredVideo, VideoMetrics  # noqa: E402
from services.venues.brand_health import (                          # noqa: E402
    WEIGHTS, raw_components, score_roster)
from services.venues.overpass import fetch_county_cafes             # noqa: E402
from services.venues.roster import (                                # noqa: E402
    CafeRecord, chain_reason, element_to_cafe, flag_local_chains,
    parse_overpass)
from services.venues.social import (                                # noqa: E402
    collect_yelp, video_mentions_cafe)
from services.venues.store import RosterStore                       # noqa: E402

_failures: list[str] = []


def check(condition: bool, label: str) -> None:
    if condition:
        print(f"  ok   {label}")
    else:
        print(f"  FAIL {label}")
        _failures.append(label)


def node(id_: int = 1, name: str = "Hidden House Coffee",
         tags: dict | None = None, **extra) -> dict:
    base_tags = {"amenity": "cafe", "name": name,
                 "addr:city": "San Juan Capistrano"}
    base_tags.update(tags or {})
    return {"type": "node", "id": id_, "lat": 33.5, "lon": -117.66,
            "tags": base_tags, **extra}


# --------------------------------------------------------------- exclusion

def test_chain_exclusion() -> None:
    print("chain exclusion")
    check(chain_reason({"name": "Starbucks"}) is not None,
          "blocklist name is excluded")
    check(chain_reason({"name": "Corner Coffee", "brand": "Corner Coffee"})
          is not None, "any brand tag excludes, even off-blocklist")
    check(chain_reason({"name": "Some Cafe", "brand:wikidata": "Q37158"})
          is not None, "brand:wikidata excludes")
    check(chain_reason({"name": "85°C Bakery Cafe"}) is not None,
          "85°C matches through unicode normalization")
    check(chain_reason({"name": "Daydream", "operator": "Dutch Bros"})
          is not None, "chain operator excludes")
    check(chain_reason({"name": "Hidden House Coffee"}) is None,
          "independent cafe passes")
    check(chain_reason({"name": "Scooterville Cafe"}) is None,
          "word-boundary matching: blocklist fragment inside a word is not a hit")
    check(chain_reason({"name": "Kean Coffee"}) is None,
          "local roaster with chain-ish name passes")

    trio = [element_to_cafe(node(i, name="Bodhi Leaf Coffee Traders"))
            for i in range(3)]
    pair = [element_to_cafe(node(i + 10, name="Neat Coffee"))
            for i in range(2)]
    flagged = flag_local_chains(trio + pair)
    check(flagged == 3 and all(c.is_chain for c in trio),
          "3+ same-name locations flagged as a multi-location brand")
    check(not any(c.is_chain for c in pair),
          "two locations is still an independent")


# ----------------------------------------------------------------- parsing

def test_parsing() -> None:
    print("overpass parsing")
    cafe = element_to_cafe(node(tags={
        "website": "https://hiddenhousecoffee.com",
        "contact:instagram": "https://www.instagram.com/hiddenhousecoffee/",
        "opening_hours": "Mo-Su 07:00-17:00", "cuisine": "coffee_shop"}))
    check(cafe.cafe_id == "osm:node:1", "stable osm key")
    check(cafe.instagram == "hiddenhousecoffee",
          "instagram handle extracted from URL form")
    check(cafe.lat == 33.5 and cafe.lon == -117.66, "node coordinates")
    check(cafe.city == "San Juan Capistrano", "addr:city captured")

    way = element_to_cafe({"type": "way", "id": 9, "center":
                           {"lat": 33.6, "lon": -117.9},
                           "tags": {"name": "Neat Coffee"}})
    check(way.lat == 33.6, "way uses computed center coordinates")

    check(element_to_cafe({"type": "node", "id": 2, "tags":
                           {"amenity": "cafe"}}) is None,
          "nameless element is dropped, not stored")

    payload = {"elements": [node(1), node(1), node(3, name="Starbucks"),
                            {"type": "node", "id": 4, "tags": {}}]}
    cafes, tally = parse_overpass(payload)
    check(len(cafes) == 2, "duplicate osm ids collapse to one record")
    check(tally["independent"] == 1 and tally["chain"] == 1
          and tally["duplicates"] == 1 and tally["nameless"] == 1,
          "tally accounts for every element")


# ------------------------------------------------------------------- store

def test_store() -> None:
    print("roster store")
    with tempfile.TemporaryDirectory() as tmp:
        store = RosterStore(Path(tmp) / "t.db")
        a = element_to_cafe(node(1))
        b = element_to_cafe(node(2, name="Neat Coffee"))
        chain = element_to_cafe(node(3, name="Starbucks"))
        total, new = store.upsert_many([a, b, chain])
        check((total, new) == (3, 3), "first insert reports new rows")
        check(store.upsert_cafe(a) is False, "re-upsert is a refresh")
        check(len(store.cafes(include_chains=True)) == 3, "dedupe on cafe_id")
        check(len(store.cafes()) == 2, "chains excluded from default listing")
        check(store.cafes()[0].cafe_id < store.cafes()[1].cafe_id,
              "deterministic cafe_id ordering")

        # resume contract
        check(len(store.pending_cafes()) == 2,
              "all independents pending before any metrics")
        store.set_signals(a.cafe_id, youtube={"video_count": 0, "videos": []},
                          yelp=None, errors=["yelp: HTTP 403"],
                          video_checked_at="2026-08-17T00:00:00Z")
        pending = store.pending_cafes()
        check(len(pending) == 1 and pending[0].cafe_id == b.cafe_id,
              "measured cafe leaves the pending queue — re-run resumes")
        store.set_signals(b.cafe_id, youtube=None, yelp=None,
                          video_checked_at="2026-08-17T00:00:00Z")
        check(store.pending_cafes() == [],
              "a failed attempt still counts as attempted (no retry loop)")

        sig = store.get_signals(a.cafe_id)
        check(sig["youtube"]["video_count"] == 0 and sig["yelp"] is None,
              "measured-zero youtube and absent yelp survive round-trip")

        store.record_snapshot(a.cafe_id, 61.5, "medium",
                              {"social_volume": {"raw": 0}}, {"coverage": 0.3})
        store.record_snapshot(a.cafe_id, 64.0, "medium", {}, {})
        latest = store.latest_snapshots()
        check(latest[a.cafe_id]["score"] == 64.0,
              "snapshots append; latest wins, history kept")


# ---------------------------------------------------------------- signals

def test_relevance() -> None:
    print("mention relevance")
    def vid(title: str, desc: str = "") -> DiscoveredVideo:
        return DiscoveredVideo(platform="youtube", platform_video_id="x",
                               url="u", title=title, description=desc)

    check(video_mentions_cafe("Hidden House Coffee",
                              vid("HIDDEN HOUSE COFFEE san juan vlog")),
          "exact name in title matches")
    check(video_mentions_cafe("Hidden House Coffee",
                              vid("Best cafes in OC",
                                  "stops: Hidden House Coffee, Daydream")),
          "name in description matches")
    check(not video_mentions_cafe("Hidden House Coffee",
                                  vid("Top 10 coffee shops in Orange County")),
          "generic county roundup without the name does not match")
    check(not video_mentions_cafe("Neat Coffee",
                                  vid("my neat little apartment tour")),
          "shared single word does not attach someone else's video")
    check(video_mentions_cafe("Sergio's",
                              vid("Breakfast at Sergio's!", "Anaheim, California"),
                              geo_terms=("Anaheim",)),
          "possessive-named cafe matches its own geo-tagged videos")
    check(video_mentions_cafe("Sergio's", vid("SERGIOS best spot in Anaheim"),
                              geo_terms=("Anaheim",)),
          "apostrophe-collapsed form with a city cue matches")
    check(not video_mentions_cafe("Sergio's",
                                  vid("Sergio's Cuban Restaurant croqueta day"),
                                  geo_terms=("Anaheim",)),
          "same-named business elsewhere is rejected without a geo cue")
    check(not video_mentions_cafe("Sergio's",
                                  vid("Sergio Ramos best moments in California")),
          "possessive name does not match via a stray single-char token")
    check(not video_mentions_cafe("Sergio's", vid("sergio santos vlog")),
          "phrase matching is word-bounded, not raw substring")


def test_yelp_degrades() -> None:
    print("yelp degradation")
    cafe = element_to_cafe(node())

    class FakeResponse:
        def __init__(self, status: int, text: str = ""):
            self.status_code, self.text = status, text

    blocked, err = collect_yelp(cafe, _get=lambda *a, **k: FakeResponse(403))
    check(blocked is None and "403" in err,
          "blocked scrape returns absent (None) with a reason, never zero")

    html = ('...<div>Hidden House Coffee</div>'
            '{"rating": 4.5, "reviewCount": 812}...')
    signal, err = collect_yelp(cafe, _get=lambda *a, **k: FakeResponse(200, html))
    check(signal == {"rating": 4.5, "review_count": 812,
                     "source_url": signal["source_url"],
                     "collected_at": signal["collected_at"]},
          "rating parsed from a page anchored on the cafe name")

    junk, err = collect_yelp(cafe, _get=lambda *a, **k: FakeResponse(200, "<html>"))
    check(junk is None, "unparseable page degrades to absent")

    homeless = CafeRecord(cafe_id="osm:node:9", name="No City Cafe")
    signal, err = collect_yelp(homeless, _get=lambda *a, **k: FakeResponse(200, html))
    check(signal is None and "city" in err, "no city on record -> no search")

    county_only = CafeRecord(cafe_id="osm:node:10", name="Hidden House Coffee",
                             county="Orange County")
    signal, err = collect_yelp(county_only,
                               _get=lambda *a, **k: FakeResponse(200, html))
    check(signal is not None and "Orange%20County" in signal["source_url"],
          "missing addr:city falls back to a county-level search")


# ------------------------------------------------------------ brand health

def _yt(count: int, views=None, likes=None, days_old=None) -> dict:
    videos = []
    for i in range(count):
        published = None
        if days_old is not None:
            published = (datetime.now(timezone.utc)
                         - timedelta(days=days_old)).isoformat()
        videos.append({"canonical_id": f"youtube:v{i}", "views": views,
                       "likes": likes, "comments": None,
                       "published_at": published})
    return {"video_count": count, "videos": videos}


def test_brand_health() -> None:
    print("brand health")
    cafes = [CafeRecord(cafe_id=f"osm:node:{i}", name=f"Cafe {i}", city="Irvine")
             for i in range(5)]
    signals = {
        # strong on every component
        "osm:node:0": {"youtube": _yt(8, views=20000, likes=900, days_old=10),
                       "yelp": {"rating": 4.5, "review_count": 900}},
        # measured, found nothing — a real zero, not missing
        "osm:node:1": {"youtube": _yt(0), "yelp": None},
        # videos but yelp blocked — renormalized over present components
        "osm:node:2": {"youtube": _yt(3, views=5000, likes=100, days_old=60),
                       "yelp": None},
        # attempted, every source failed — no evidence at all
        "osm:node:3": {"youtube": None, "yelp": None},
        # osm:node:4 never attempted — not in signals
    }

    results = score_roster(cafes, signals)
    by_id = {h.cafe_id: h for h in results}

    check("osm:node:4" not in by_id and "osm:node:3" not in by_id,
          "no measurement -> no score (absent from ranking, not zero)")
    check(len(results) == 3, "only measured cafes are scored")
    check(results[0].cafe_id == "osm:node:0",
          "full-signal cafe ranks first")

    zero = by_id["osm:node:1"]
    check(zero.score is not None,
          "a measured zero still gets a (low) score — that is data")
    check(zero.components["social_volume"]["raw"] == 0.0,
          "zero videos recorded as raw 0, not absent")
    check(zero.components["review_signal"].get("status") == "absent",
          "blocked yelp shows as absent component, not zero")

    partial = by_id["osm:node:2"]
    present_w = sum(c["weight"] for c in partial.components.values()
                    if "percentile" in c)
    check(partial.assumptions["coverage"] == round(present_w / sum(
        WEIGHTS.values()), 3), "coverage reflects renormalized weights")
    check(partial.score is not None and 0 <= partial.score <= 100,
          "renormalized score stays on the 0-100 scale")
    check(partial.confidence in ("low", "medium"),
          "thin coverage lowers stated confidence")
    check(by_id["osm:node:0"].assumptions["cohort_size"] == 3,
          "cohort is the measured cafes, and the score says so")

    raw = raw_components(signals["osm:node:2"])
    check(raw["engagement_quality"] is not None
          and abs(raw["engagement_quality"] - 100 / 5000) < 1e-9,
          "engagement is likes+comments over views")
    check(raw_components({"youtube": _yt(2, views=100), "yelp": None})
          ["engagement_quality"] is None,
          "views without engagement data -> engagement absent, not zero")
    check(raw_components(signals["osm:node:3"]) is None,
          "all-sources-failed attempt yields no components")
    check(raw_components(None) is None, "never-attempted yields no components")


# ---------------------------------------------------------------- overpass

def test_overpass_cache() -> None:
    print("overpass caching")
    calls = []

    class FakeResponse:
        status_code = 200
        def json(self):
            return {"elements": [node()]}

    def fake_post(*args, **kwargs):
        calls.append(args)
        return FakeResponse()

    with tempfile.TemporaryDirectory() as tmp:
        first = fetch_county_cafes("Orange County", cache_dir=tmp,
                                   _post=fake_post, on_status=lambda m: None)
        second = fetch_county_cafes("Orange County", cache_dir=tmp,
                                    _post=fake_post, on_status=lambda m: None)
        check(len(calls) == 1, "second run reads the cache, not Overpass")
        check(first == second, "cached payload identical to fetched")


def main() -> int:
    test_chain_exclusion()
    test_parsing()
    test_store()
    test_relevance()
    test_yelp_degrades()
    test_brand_health()
    test_overpass_cache()
    print()
    if _failures:
        print(f"{len(_failures)} FAILURES")
        return 1
    print("all checks passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
