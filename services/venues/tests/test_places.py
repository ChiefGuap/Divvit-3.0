"""Tests for the Google Places review signal — no network, no API key.

Weighted toward the failure that costs the most: attaching the wrong
business's rating to a cafe. The YouTube relevance gate already hit this
(a "Sergio's" in OC matched a Cuban restaurant in Miami), and a confident
4.8 on the wrong venue is worse in a sales conversation than a blank.

    .venv/bin/python -m services.venues.tests.test_places
"""

from __future__ import annotations

import sys
import tempfile
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[3]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from services.venues.brand_health import raw_components, score_roster   # noqa: E402
from services.venues.places import (                                    # noqa: E402
    MAX_LOCATION_DRIFT_M, PlacesClient, haversine_m, name_overlap,
    review_signal_from)
from services.venues.roster import CafeRecord                           # noqa: E402
from services.venues.social import collect_places                       # noqa: E402
from services.venues.store import RosterStore                           # noqa: E402

_failures: list[str] = []


def check(condition: bool, label: str) -> None:
    if condition:
        print(f"  ok   {label}")
    else:
        print(f"  FAIL {label}")
        _failures.append(label)


def make_cafe(cafe_id="osm:node:1", name="Coffee Dose", city="Costa Mesa",
              lat=33.6585, lon=-117.8854) -> CafeRecord:
    return CafeRecord(cafe_id=cafe_id, name=name, city=city, lat=lat, lon=lon)


class FakePlaces(PlacesClient):
    """Real gating logic, canned HTTP."""

    def __init__(self, payload, **kw):
        super().__init__(api_key="fake", **kw)
        self.payload = payload
        self.queries: list[str] = []

    def search_raw(self, query, use_cache=True, latitude=None, longitude=None):
        self.queries.append(query)
        self.biased = latitude is not None and longitude is not None
        return self.payload


def place(name="Coffee Dose", lat=33.6585, lon=-117.8854, rating=4.9,
          count=3554, status="OPERATIONAL"):
    entry = {"id": "place123", "displayName": {"text": name},
             "formattedAddress": "2675 Irvine Ave, Costa Mesa, CA",
             "businessStatus": status}
    if lat is not None:
        entry["location"] = {"latitude": lat, "longitude": lon}
    if rating is not None:
        entry["rating"] = rating
    if count is not None:
        entry["userRatingCount"] = count
    return {"places": [entry]}


# ------------------------------------------------------------------ geometry

def test_geometry() -> None:
    print("\ngeometry + name matching")
    # Costa Mesa -> Santa Ana, ~10km apart.
    far = haversine_m(33.6585, -117.8854, 33.7455, -117.8677)
    check(far is not None and 9_000 < far < 11_000,
          "haversine returns a sane distance between two OC cities")
    check(haversine_m(33.6, -117.8, 33.6, -117.8) == 0.0,
          "identical points are zero metres apart")
    check(haversine_m(None, -117.8, 33.6, -117.8) is None,
          "an unknown coordinate returns None, not a wrong number")

    check(name_overlap("Coffee Dose", "Coffee Dose") == 1.0,
          "identical names overlap fully")
    check(name_overlap("Kit Coffee", "Sergio's Ring Shop") == 0.0,
          "unrelated names share nothing")
    check(0 < name_overlap("Kit Coffee", "Kit Coffee Newport") < 1.0,
          "a partial name match lands between")
    check(name_overlap("", "Coffee Dose") == 0.0,
          "an empty name cannot match anything")


# ------------------------------------------------------------------- gating

def test_identity_gates() -> None:
    print("\nidentity gates")
    cafe = make_cafe()

    client = FakePlaces(place())
    match, reason = client.find(cafe.name, city=cafe.city,
                                latitude=cafe.lat, longitude=cafe.lon,
                                use_cache=False)
    check(match is not None and reason is None, "a co-located match is accepted")
    check(match.rating == 4.9 and match.review_count == 3554,
          "rating and review count come through")
    check(match.distance_m is not None and match.distance_m < 50,
          "the distance to the OSM node is recorded on the match")
    check("Costa Mesa" in client.queries[0],
          "the city is part of the query, not just the name")
    check(client.biased,
          "known coordinates are passed as a location bias — without it, "
          "'Sergio's' matched an auto repair shop 575km away (measured)")

    unlocated = FakePlaces(place())
    unlocated.find("Coffee Dose", city="Costa Mesa", use_cache=False)
    check(not unlocated.biased,
          "and a cafe with no coordinates is searched unbiased, not at 0,0")

    # Same name, 10km away — the Sergio's failure mode.
    client = FakePlaces(place(lat=33.7455, lon=-117.8677))
    match, reason = client.find(cafe.name, city=cafe.city,
                                latitude=cafe.lat, longitude=cafe.lon,
                                use_cache=False)
    check(match is None, "a match too far from the OSM node is rejected")
    check(reason and "away" in reason,
          "and the reason says why, so the absence can be audited")

    # No coordinates: the name has to carry it.
    client = FakePlaces(place(name="Sergio's Fine Jewelry", lat=None))
    match, reason = client.find("Sergio's", city="Anaheim", use_cache=False)
    check(match is None and reason and "does not" in reason,
          "with no location to check, a weak name match is refused")

    client = FakePlaces(place(name="Coffee Dose", lat=None))
    match, _ = client.find("Coffee Dose", city="Costa Mesa", use_cache=False)
    check(match is not None,
          "but a strong name match with no location is still accepted")

    client = FakePlaces({"places": []})
    match, reason = client.find("Nonexistent Cafe", city="Irvine",
                                use_cache=False)
    check(match is None and reason and "no result" in reason,
          "an empty result set is reported, not crashed on")

    check(MAX_LOCATION_DRIFT_M == 400.0,
          "the drift ceiling is a stated constant, not a magic number")


def test_signal_shape() -> None:
    print("\nsignal shape")
    check(review_signal_from(None) is None, "no match means no signal")

    client = FakePlaces(place(rating=None, count=None))
    match, _ = client.find("New Cafe", city="Irvine", use_cache=False)
    check(review_signal_from(match) is None,
          "a place nobody has rated yet is unmeasured, NOT a zero rating")

    client = FakePlaces(place())
    match, _ = client.find("Coffee Dose", city="Costa Mesa", use_cache=False)
    signal = review_signal_from(match)
    check(signal["provider"] == "google_places", "the provider is recorded")
    check(signal["place_id"] == "place123",
          "the place_id travels so a match can be re-checked later")
    check("matched_name" in signal and "distance_m" in signal,
          "what it matched and how far away is kept for auditing")

    cafe = make_cafe()
    signal, error = collect_places(cafe, FakePlaces(place(status="CLOSED_PERMANENTLY")))
    check(signal is None and error and "CLOSED_PERMANENTLY" in error,
          "a closed cafe yields no signal — pitching it would be embarrassing")


# -------------------------------------------------------------------- store

def test_store() -> None:
    print("\nstore")
    with tempfile.TemporaryDirectory() as tmp:
        store = RosterStore(Path(tmp) / "v.db")
        cafe = make_cafe()
        store.upsert_cafe(cafe)

        store.set_signals(cafe.cafe_id, youtube={"video_count": 3, "videos": []},
                          collected_at="2026-08-17T00:00:00Z")
        check(len(store.pending_reviews()) == 1,
              "a cafe measured on youtube but not reviews is pending review")

        store.set_signals(cafe.cafe_id,
                          google={"provider": "google_places", "rating": 4.9,
                                  "review_count": 3554})
        signals = store.get_signals(cafe.cafe_id)
        check(signals["google"]["rating"] == 4.9,
              "the google signal round-trips through the store")
        check(signals["youtube"]["video_count"] == 3,
              "and backfilling reviews does not blank the youtube signal")
        check(store.pending_reviews() == [],
              "a cafe with a review signal drops out of the backfill queue")


# ------------------------------------------------------------- the payoff

def test_confidence_lifts() -> None:
    """The whole point of the key: Yelp being blocked capped every score at
    medium. A working review source should lift coverage to high."""
    print("\nconfidence")
    youtube = {"video_count": 4, "videos": [
        {"views": 10000, "likes": 400, "comments": 100,
         "published_at": "2026-08-10T00:00:00Z"}]}

    without = raw_components({"youtube": youtube, "yelp": None})
    check(without["review_signal"] is None,
          "with no review source the component is absent")

    with_google = raw_components({
        "youtube": youtube,
        "google": {"rating": 4.9, "review_count": 3554}})
    check(with_google["review_signal"] is not None,
          "google fills the review component")
    check(with_google["review_signal"] > 17,
          "4.9 stars over 3554 reviews scores high on rating x log10(count)")

    both = raw_components({
        "youtube": youtube,
        "google": {"rating": 4.9, "review_count": 3554},
        "yelp": {"rating": 2.0, "review_count": 5}})
    check(both["review_signal"] == with_google["review_signal"],
          "google wins over yelp when both are present")

    only_yelp = raw_components({"youtube": youtube,
                                "yelp": {"rating": 4.0, "review_count": 100}})
    check(only_yelp["review_signal"] is not None,
          "yelp still works as a fallback for rows measured before places")

    cafes = [make_cafe(cafe_id=f"osm:node:{i}", name=f"Cafe {i}")
             for i in range(4)]
    signals = {c.cafe_id: {"youtube": youtube,
                           "google": {"rating": 4.5, "review_count": 200}}
               for c in cafes}
    scored = score_roster(cafes, signals)
    check(all(s.confidence == "high" for s in scored),
          "a full component set scores at HIGH confidence, not medium")
    check(all(s.components["review_signal"].get("status") != "absent"
              for s in scored),
          "and the review component is no longer marked absent")

    dark = score_roster(cafes, {c.cafe_id: {"youtube": youtube} for c in cafes})
    check(all(s.confidence == "medium" for s in dark),
          "without reviews the same cafes cap at medium — the pre-key state")


def test_thin_scores_are_not_ranked() -> None:
    """Measured 2026-08-19: the first county-wide ranking put eight
    review-only cafes above the most-filmed cafe in Orange County.

    Renormalizing over present components keeps the scale honest within a
    cafe but not between cafes — one component scored against four, both on
    a 0-100 axis. A thin score is still real; it just is not a league entry.
    """
    print("\nrankability")
    rich = make_cafe(cafe_id="osm:node:rich", name="Well Filmed Cafe")
    thin = make_cafe(cafe_id="osm:node:thin", name="Only Reviewed Cafe")
    others = [make_cafe(cafe_id=f"osm:node:{i}", name=f"Cafe {i}")
              for i in range(3)]

    signals = {
        rich.cafe_id: {
            "youtube": {"video_count": 9, "videos": [
                {"views": 10000, "likes": 1200, "comments": 100,
                 "published_at": "2026-08-15T00:00:00Z"}]},
            "google": {"rating": 4.9, "review_count": 3554}},
        # Nothing but a strong rating — the shape that topped the broken table.
        thin.cafe_id: {"google": {"rating": 5.0, "review_count": 5000}},
    }
    for i, c in enumerate(others):
        signals[c.cafe_id] = {
            "youtube": {"video_count": 1, "videos": [
                {"views": 100, "likes": 1, "comments": 0,
                 "published_at": "2024-01-01T00:00:00Z"}]},
            "google": {"rating": 3.5, "review_count": 10}}

    results = score_roster([rich, thin] + others, signals)
    by_id = {h.cafe_id: h for h in results}

    check(by_id[thin.cafe_id].score is not None,
          "a review-only cafe still gets a score — it is a real measurement")
    check(not by_id[thin.cafe_id].rankable,
          "but it is not rankable against fully-measured cafes")
    check(by_id[rich.cafe_id].rankable,
          "a fully-measured cafe is rankable")

    ranked = [h for h in results if h.rankable]
    check(ranked[0].cafe_id == rich.cafe_id,
          "the most-measured cafe tops the ranking, not the thinnest one")
    check(all("min_coverage_to_rank" in h.assumptions for h in results),
          "the threshold travels in assumptions, so the cut is auditable")


def main() -> int:
    for test in (test_geometry, test_identity_gates, test_signal_shape,
                 test_store, test_confidence_lifts,
                 test_thin_scores_are_not_ranked):
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
