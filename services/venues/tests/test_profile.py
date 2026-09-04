"""Tests for prefilled venue profiles.

The failure that matters is not a crash. It is a profile that presents a
guess as a fact — a venue seeing wrong information about itself on the first
screen reads as carelessness about the thing they care most about.

So these pin provenance and absence, not formatting.

    .venv/bin/python -m services.venues.tests.test_profile
"""

from __future__ import annotations

import sys
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[3]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from services.venues.profile import (DERIVED, OBSERVED, UNVERIFIED,  # noqa: E402
                                     build_profile)

_failures: list[str] = []


def check(cond: bool, label: str) -> None:
    print(f"  {'ok  ' if cond else 'FAIL'} {label}")
    if not cond:
        _failures.append(label)


def row(**over):
    base = {"cafe_id": "osm:node:1", "name": "Test Cafe", "lat": 33.6, "lon": -117.9,
            "city": "Irvine", "county": "Orange County", "source": "overpass",
            "status": "active"}
    base.update(over)
    return base


def test_absence_is_never_a_value() -> None:
    print("\nabsence")
    p = build_profile(row())
    for key in ("website", "phone", "instagram", "tiktok"):
        f = p["contact"][key]
        check(f["value"] is None and f["source"] == UNVERIFIED,
              f"missing {key} is null and unverified, never an empty string")

    p2 = build_profile(row(website="   ", instagram=""))
    check(p2["contact"]["website"]["source"] == UNVERIFIED,
          "a whitespace-only value counts as absent, not as data")


def test_provenance_is_carried() -> None:
    print("\nprovenance")
    osm = build_profile(row())
    check(osm["identity"]["name"]["origin"] == "osm",
          "an OSM row is labelled osm")
    places = build_profile(row(source="places"))
    check(places["identity"]["name"]["origin"] == "google_places",
          "a Places row is labelled google_places")

    geo = build_profile(row(city_source="reverse_geocode"))
    check(geo["identity"]["city"]["source"] == DERIVED,
          "a reverse-geocoded city is DERIVED, not observed")
    check("confirm at onboarding" in geo["identity"]["city"]["note"],
          "and says it should be confirmed — it is our inference, not their fact")

    osm_city = build_profile(row())
    check(osm_city["identity"]["city"]["source"] == OBSERVED,
          "a city that came with the source data stays observed")


def test_brand_health_absence() -> None:
    print("\nbrand health")
    none = build_profile(row())
    check(none["brand_health"]["score"]["value"] is None,
          "no measurement means a null score, never a zero")
    check(none["brand_health"]["rankable"]["value"] is False,
          "and not rankable")
    check("not measured" in none["brand_health"]["score"]["note"],
          "with the reason stated")

    scored = build_profile(row(), health={"score": 93, "confidence": "high",
                                          "rankable": True, "components": {"a": 1}})
    check(scored["brand_health"]["score"]["value"] == 93, "a real score is carried")
    check(scored["brand_health"]["score"]["source"] == DERIVED,
          "and marked derived — it is our model's output, not an observation")
    check("high" in scored["brand_health"]["score"]["note"],
          "with its confidence attached to the number itself")


def test_the_onboarding_ask() -> None:
    print("\nwhat we ask the venue for")
    p = build_profile(row())
    fields = [a["field"] for a in p["needs_from_venue"]]
    check(fields[:2] == ["instagram", "tiktok"],
          "social handles are asked first — nothing can be attributed without them")
    check(all(a["why"] for a in p["needs_from_venue"]),
          "every ask says why it matters, so it does not read as a form to fill")

    filled = build_profile(row(instagram="@testcafe", tiktok="@testcafe",
                               website="https://x.com", phone="123",
                               opening_hours="Mo-Fr", cuisine="coffee"))
    check(filled["needs_from_venue"] == [],
          "a complete profile asks for nothing")


def test_readiness_gate() -> None:
    print("\nreadiness")
    bare = build_profile(row())
    check(bare["readiness"]["ready_to_show"] is False,
          "a name and a map pin is not a profile worth showing a venue")

    some = build_profile(row(website="https://x.com", phone="123"))
    check(some["readiness"]["ready_to_show"] is True,
          "two measured fields clears the bar")

    check(build_profile(row())["schema_version"] == 1,
          "the schema is versioned, because another service reads this")


def test_shape_is_stable() -> None:
    """A consumer must not have to branch on which cafe it got."""
    print("\nshape")
    a = build_profile(row())
    b = build_profile(row(source="places", website="https://x.com"),
                      health={"score": 50, "confidence": "low",
                              "rankable": False, "components": {}})
    check(set(a) == set(b), "top-level keys match whatever is known")
    for section in ("identity", "contact", "operations", "brand_health"):
        check(set(a[section]) == set(b[section]),
              f"{section} keys match, so absent fields are present-and-null")


def main() -> int:
    for t in (test_absence_is_never_a_value, test_provenance_is_carried,
              test_brand_health_absence, test_the_onboarding_ask,
              test_readiness_gate, test_shape_is_stable):
        t()
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
