"""Tests for venue resolution.

The expensive failure here is a *wrong attach*: someone else's video on a
business's dashboard, and if a reward is attached, a payout for footage of a
competitor. So these lean on the negative cases — the resolver must be willing
to say "unknown" and "needs_review" rather than force a match.

    .venv/bin/python -m services.venues.tests.test_venues
"""

from __future__ import annotations

import sys
import tempfile
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[3]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from services.venues import (BusinessCatalog, BusinessRecord,   # noqa: E402
                             VenueResolver, name_similarity)
from services.venues.reference import (                         # noqa: E402
    KIND_FOOD, KIND_STOREFRONT, ManualProvider, ReferenceImage,
    VenueFingerprint, build_fingerprint)
from services.venues.verify import (                            # noqa: E402
    CrossReferenceVerifier, haversine_meters)

_failures: list[str] = []


def check(condition: bool, label: str) -> None:
    if condition:
        print(f"  ok   {label}")
    else:
        print(f"  FAIL {label}")
        _failures.append(label)


def _catalog() -> BusinessCatalog:
    return BusinessCatalog([
        BusinessRecord("b1", "The Cauldron Ice Cream", city="Los Angeles",
                       aliases=["Cauldron"], cuisine="ice cream",
                       menu_items=["nitrogen ice cream", "cereal cone"],
                       is_partner=True),
        BusinessRecord("b2", "Sonny's Pizzeria", city="Los Angeles",
                       cuisine="pizza", menu_items=["pepperoni pizza", "burrata"]),
        BusinessRecord("b3", "Aloha Poke & Grill", city="Carson", cuisine="poke"),
        BusinessRecord("b4", "Buona Forchetta", city="San Diego", cuisine="italian"),
        BusinessRecord("b5", "Bronx Pizza", city="San Diego", cuisine="pizza"),
        BusinessRecord("b6", "Cauldron Coffee Roasters", city="Seattle",
                       cuisine="coffee"),
    ])


def test_name_similarity() -> None:
    print("name similarity")
    check(name_similarity("CALDROWN ICE CREAM", "The Cauldron Ice Cream") > 0.9,
          "OCR misread of a sign still matches its business")
    check(name_similarity("Ruffin", "Pizza by Ruffin") > 0.9,
          "partial name read off a sign matches the full name")
    check(name_similarity("Panda's", "Panda Express") > 0.8,
          "possessive vs full trading name matches")
    check(name_similarity("CALDROWN ICE CREAM", "Cauldron Coffee Roasters") < 0.7,
          "similar first word alone does not make a match")
    check(name_similarity("Bronx Pizza", "Buona Forchetta") < 0.5,
          "unrelated names score low")
    check(name_similarity("", "Sonny's Pizzeria") == 0.0,
          "empty evidence scores zero")
    # Generic words must not carry a match on their own.
    check(name_similarity("The Coffee House", "The Coffee Shop") < 0.95,
          "two generic names are not treated as identical")


def test_confirms_real_matches() -> None:
    print("confirming real matches")
    r = VenueResolver(_catalog())

    res = r.resolve(["CALDROWN ICE CREAM"],
                    detected_items=["Ice cream with cereal topping"],
                    city="Los Angeles")
    check(res.verdict == "confirmed", "OCR-noisy name confirms with corroboration")
    check(res.best.business_id == "b1", "resolves to the right business")
    check(res.exclusive, "single-venue video is exclusive")
    check(res.best.score < 1.0, "score is not saturated by bonuses")

    res = r.resolve(["Sonny's Pizzeria"], detected_items=["Pepperoni Pizza"],
                    city="Los Angeles")
    check(any("menu:" in s for s in res.best.signals),
          "menu overlap is recorded as a corroborating signal")


def test_refuses_bad_matches() -> None:
    print("refusing bad matches")
    r = VenueResolver(_catalog())

    check(r.resolve([]).verdict == "unknown", "no evidence resolves to unknown")
    check(r.resolve([""]).verdict == "unknown", "blank evidence resolves to unknown")

    res = r.resolve(["Some Random Diner"])
    check(res.verdict == "unknown", "venue absent from the catalog is unknown")
    check(res.best is None, "no business is attached when unknown")
    check("Some Random Diner" in res.unresolved_evidence,
          "unmatched evidence is surfaced (a business not yet on Divvit)")

    # Two venues share a distinctive word; without more signal this is a
    # human's call, not the resolver's.
    res = r.resolve(["Cauldron"])
    check(res.verdict == "needs_review", "genuinely ambiguous name needs review")
    check(any("ambiguous_with" in s for s in res.best.signals),
          "the competing candidate is named in the signals")

    # City is the cheap prior that breaks the tie.
    res = r.resolve(["Cauldron"], city="Seattle")
    check(res.best.business_id == "b6", "city narrows to the right Cauldron")


def test_multi_venue() -> None:
    print("multi-venue videos")
    r = VenueResolver(_catalog())
    res = r.resolve(["Square Pizza", "Bronx Pizza", "Buona Forchetta"],
                    city="San Diego")
    check(res.multi_venue, "a ranking video is flagged as multi-venue")
    check(not res.exclusive,
          "multi-venue video is not exclusive to one business")
    check(set(res.matched_business_ids()) == {"b4", "b5"},
          "every venue present in the catalog is matched")
    check("Square Pizza" in res.unresolved_evidence,
          "a featured venue not in the catalog is reported as unresolved")


def test_catalog() -> None:
    print("catalog")
    cat = _catalog()
    check(len(cat.in_city("Los Angeles")) == 2, "city filter narrows the catalog")
    check(len(cat.in_city("")) == len(cat), "empty city does not filter")
    check(len(cat.in_city("Atlantis")) == 0, "unknown city yields no candidates")
    check(cat.get("b1").name == "The Cauldron Ice Cream", "lookup by id")
    check(cat.get("nope") is None, "missing id returns None")
    check("Cauldron" in cat.get("b1").all_names(), "aliases are part of the names")

    with tempfile.TemporaryDirectory() as t:
        p = cat.to_json(Path(t) / "c.json")
        check(len(BusinessCatalog.from_json(p)) == len(cat), "JSON round-trip")

    rows = [{"id": "x1", "name": "Test Cafe", "city": "Austin"}]
    loaded = BusinessCatalog.from_supabase_rows(rows)
    check(loaded.records[0].business_id == "x1",
          "supabase rows load without the enrichment columns present")


def _fingerprint(**kw) -> VenueFingerprint:
    base = dict(business_id="b1", name="The Cauldron Ice Cream",
                aliases=["Cauldron"], latitude=33.7, longitude=-117.8,
                menu_items=["cereal cone", "nitrogen ice cream"])
    base.update(kw)
    return VenueFingerprint(**base)


def _screening(evidence, items, flags=(), food=True) -> dict:
    return {"analysis": {"is_food_beverage_content": food,
                         "venue_evidence": list(evidence),
                         "detected_items": list(items),
                         "quality_flags": list(flags)}}


def test_fingerprint() -> None:
    print("venue fingerprints")
    fp = _fingerprint(reference_images=[
        ReferenceImage(url="x", kind=KIND_STOREFRONT),
        ReferenceImage(url="y", kind=KIND_FOOD)])
    check(fp.has_geo(), "coordinates recognised")
    check(fp.strength() == "strong", "geo + storefront + menu reads as strong")
    check(len(fp.images_of(KIND_STOREFRONT)) == 1, "images filter by kind")
    check(fp.images_of(KIND_STOREFRONT)[0].weight()
          > fp.images_of(KIND_FOOD)[0].weight(),
          "a storefront photo outweighs a plate of food")

    bare = VenueFingerprint(business_id="b9", name="Nothing Known")
    check(not bare.has_geo(), "absent coordinates stay absent, never guessed")
    check(bare.strength() == "weak", "empty profile reads as weak")

    rec = BusinessRecord("b1", "Test Cafe", city="Austin", latitude=30.2,
                         longitude=-97.7, menu_items=["cold brew"])
    manual = ManualProvider().fetch(rec)
    check(manual.latitude == 30.2, "manual provider carries profile coordinates")
    combined = build_fingerprint(rec, providers=[ManualProvider()])
    check(combined.sources == ["manual"], "provider is recorded on the fingerprint")


def test_geo_distance() -> None:
    print("geo distance")
    check(haversine_meters(32.7157, -117.1611, 32.7157, -117.1611) < 1,
          "identical coordinates are zero metres apart")
    d = haversine_meters(32.7157, -117.1611, 32.7167, -117.1611)
    check(100 < d < 120, "one thousandth of a degree of latitude is ~111m")


def test_cross_reference() -> None:
    print("cross-reference verification")
    v = CrossReferenceVerifier()   # no visual matcher: that signal is skipped

    r = v.verify(screening=_screening([], [], food=False),
                 fingerprint=_fingerprint())
    check(r.verdict == "rejected", "non-food content is rejected outright")

    # Signage names an entirely different business.
    r = v.verify(screening=_screening(["Bronx Pizza"], ["pepperoni pizza"]),
                 fingerprint=_fingerprint())
    check(r.verdict == "rejected", "wrong business name on screen is rejected")

    # Nothing to check against: must not become a silent pass.
    r = v.verify(screening=_screening([], []),
                 fingerprint=VenueFingerprint(business_id="b1", name="Unknown Cafe"))
    check(r.verdict == "needs_review", "no checkable evidence means review")
    check(r.trust_score == 0.0, "unchecked signals never score as passes")
    check(any("enrich the business profile" in x for x in r.reasons),
          "the reason names the actual product gap")

    # Name matches but that is the only signal available.
    r = v.verify(screening=_screening(["CALDROWN ICE CREAM"], []),
                 fingerprint=_fingerprint(menu_items=[]))
    check(r.verdict == "needs_review",
          "a single passing signal is not enough to auto-approve")
    check(any("only 1 signal" in x for x in r.reasons),
          "the shortfall is stated explicitly")

    # Name plus menu: two independent signals agree.
    r = v.verify(screening=_screening(["CALDROWN ICE CREAM"],
                                      ["Ice cream with cereal topping"]),
                 fingerprint=_fingerprint())
    check(r.verdict == "verified", "two agreeing signals verify")
    check(any(s.name == "menu_overlap" and s.status == "pass" for s in r.signals),
          "loose dish description still matches the menu (token overlap)")

    # Authenticity flags halve trust even when the venue matches.
    flagged = v.verify(screening=_screening(["CALDROWN ICE CREAM"],
                                            ["Ice cream with cereal topping"],
                                            flags=["likely_repost"]),
                       fingerprint=_fingerprint())
    check(flagged.verdict == "needs_review", "repost flag blocks auto-approval")
    check(flagged.trust_score < r.trust_score, "repost flag reduces trust")

    # Geo contradiction outweighs everything else.
    import tempfile
    r = v.verify(screening=_screening(["CALDROWN ICE CREAM"],
                                      ["Ice cream with cereal topping"]),
                 fingerprint=_fingerprint(), video_path=tempfile.mktemp())
    check(r.verdict in ("verified", "needs_review"),
          "a missing media file skips geo rather than failing the submission")


def main() -> int:
    for test in (test_name_similarity, test_confirms_real_matches,
                 test_refuses_bad_matches, test_multi_venue, test_catalog,
                 test_fingerprint, test_geo_distance, test_cross_reference):
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
