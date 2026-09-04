"""Tests for the city backfill.

The risk here is not a crash, it is a plausible-looking wrong answer. A blank
city reads as missing; a wrong one silently corrupts every per-city rollup and
looks like data. So these pin the refusals, not the happy path.

    .venv/bin/python -m services.venues.tests.test_geocode
"""

from __future__ import annotations

import sys
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[3]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from services.venues.geocode import reverse_geocode                  # noqa: E402

_failures: list[str] = []


def check(cond: bool, label: str) -> None:
    print(f"  {'ok  ' if cond else 'FAIL'} {label}")
    if not cond:
        _failures.append(label)


def payload(*components, status="OK"):
    return {"status": status,
            "results": [{"address_components": list(components)}]}


def comp(name, *types):
    return {"long_name": name, "types": list(types)}


def fetch_returning(body):
    return lambda url: body


def test_reads_the_city() -> None:
    print("\nreading a result")
    r = reverse_geocode(33.6, -117.9, "k", fetch=fetch_returning(payload(
        comp("Costa Mesa", "locality"), comp("Orange County", "administrative_area_level_2"),
        comp("92627", "postal_code"), comp("Newport Blvd", "route"),
        comp("1140", "street_number"))))
    check(r.status == "ok" and r.city == "Costa Mesa", "locality becomes the city")
    check(r.postcode == "92627", "postcode is carried")
    check(r.street == "1140 Newport Blvd", "street number and route are joined")
    check(r.usable, "and the row is usable")


def test_city_falls_back_through_types() -> None:
    print("\ncity precedence")
    r = reverse_geocode(0, 0, "k", fetch=fetch_returning(payload(
        comp("Ladera Ranch", "sublocality"),
        comp("Orange County", "administrative_area_level_2"))))
    check(r.city == "Ladera Ranch",
          "an unincorporated place with no locality falls back to sublocality")


def test_out_of_county_is_refused() -> None:
    """A coordinate landing in another county means the ROW is wrong. Writing
    the city anyway would put a plausible, wrong value in the database."""
    print("\nout of county")
    r = reverse_geocode(34.05, -118.24, "k", fetch=fetch_returning(payload(
        comp("Los Angeles", "locality"),
        comp("Los Angeles County", "administrative_area_level_2"))))
    check(r.status == "out_of_county", "a Los Angeles coordinate is refused")
    check(not r.usable, "and is not usable, so nothing is written")
    check(r.city == "Los Angeles",
          "though the value is still reported, so the bad row can be found")


def test_empty_and_broken_responses() -> None:
    print("\nfailures")
    r = reverse_geocode(0, 0, "k", fetch=fetch_returning({"status": "ZERO_RESULTS"}))
    check(r.status == "no_result" and not r.usable, "ZERO_RESULTS writes nothing")

    r = reverse_geocode(0, 0, "k", fetch=fetch_returning({"status": "OVER_QUERY_LIMIT"}))
    check(r.status.startswith("error") and not r.usable,
          "a quota error writes nothing — it is an outage, not an answer")

    def boom(url):
        raise TimeoutError("slow")
    r = reverse_geocode(0, 0, "k", fetch=boom)
    check(r.status.startswith("error") and not r.usable, "a timeout writes nothing")

    r = reverse_geocode(0, 0, "k", fetch=fetch_returning(payload(
        comp("Orange County", "administrative_area_level_2"))))
    check(r.status == "ok" and not r.city and not r.usable,
          "a result with a county but no city is not usable — nothing is "
          "invented from the county name")


def test_most_specific_result_wins() -> None:
    print("\nresult ordering")
    body = {"status": "OK", "results": [
        {"address_components": [comp("Irvine", "locality"),
                                comp("Orange County", "administrative_area_level_2")]},
        {"address_components": [comp("Santa Ana", "locality")]}]}
    r = reverse_geocode(0, 0, "k", fetch=fetch_returning(body))
    check(r.city == "Irvine",
          "the nearest result wins; a broader later one does not overwrite it")


def main() -> int:
    for t in (test_reads_the_city, test_city_falls_back_through_types,
              test_out_of_county_is_refused, test_empty_and_broken_responses,
              test_most_specific_result_wins):
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
