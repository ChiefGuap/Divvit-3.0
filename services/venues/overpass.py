"""Overpass API connector for the cafe roster.

Overpass (https://overpass-api.de) is a free, keyless query endpoint over
OpenStreetMap. It is also a shared community resource with real load problems,
so this module is deliberately polite:

  * one bounded query per county, not per-cafe lookups
  * raw responses cached to `data/overpass/` — a re-run reads the cache and
    costs Overpass nothing (`force_refresh=True` to actually re-fetch)
  * retries with growing backoff on the failure modes Overpass actually has
    (429 too-many-requests, 504 gateway timeout, transient resets)
  * an identifying User-Agent, per their usage policy

The query unions the tag schemes people actually use for cafes: `amenity=cafe`
is the canonical one, `shop=coffee` catches roasters-with-seating and beans
shops, `shop=tea` and `amenity=fast_food` + coffee/boba cuisine catch the boba
and tea shops that mappers file inconsistently. Chains are *not* filtered in
the query — we want them in the raw payload so exclusion is our (testable)
logic, not Overpass's.
"""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any, Callable, Optional

import requests

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
DEFAULT_CACHE_DIR = Path("data/overpass")
USER_AGENT = ("DivvitDiscover/0.1 (cafe roster research; "
              "contact: raquib.alam00@gmail.com)")

# Server-side query timeout. County-sized cafe queries measured at ~10s; the
# headroom is for Overpass under load, not for our query being expensive.
QUERY_TIMEOUT_S = 180

RETRY_DELAYS_S = (5, 20, 60)


class OverpassError(RuntimeError):
    pass


def county_cafes_query(county: str, state: str = "California") -> str:
    """One query: resolve the county admin boundary, union the cafe tag schemes.

    `nwr` covers nodes, ways and relations; `out center` gives ways/relations a
    computed centroid so every element has usable coordinates.
    """
    return f"""
[out:json][timeout:{QUERY_TIMEOUT_S}];
area["boundary"="administrative"]["admin_level"="4"]["name"="{state}"]->.state;
rel(area.state)["boundary"="administrative"]["admin_level"="6"]["name"="{county}"];
map_to_area ->.county;
(
  nwr["amenity"="cafe"](area.county);
  nwr["shop"="coffee"](area.county);
  nwr["shop"="tea"](area.county);
  nwr["amenity"="fast_food"]["cuisine"~"coffee|bubble_tea|tea"](area.county);
);
out center;
""".strip()


def _cache_path(cache_dir: Path, county: str, state: str) -> Path:
    slug = "-".join(f"{county} {state}".lower().split())
    return Path(cache_dir) / f"{slug}.json"


def fetch_county_cafes(
    county: str,
    state: str = "California",
    cache_dir: Path | str = DEFAULT_CACHE_DIR,
    force_refresh: bool = False,
    url: str = OVERPASS_URL,
    on_status: Callable[[str], None] = print,
    _post: Optional[Callable[..., Any]] = None,   # test seam
) -> dict[str, Any]:
    """Raw Overpass JSON for a county, cache-first.

    Raises OverpassError only after every retry is exhausted — a roster run
    should fail loudly rather than write an empty roster that looks real.
    """
    cache_file = _cache_path(Path(cache_dir), county, state)
    if cache_file.exists() and not force_refresh:
        on_status(f"[overpass] cache hit: {cache_file}")
        return json.loads(cache_file.read_text())

    query = county_cafes_query(county, state)
    post = _post or requests.post
    last_error: Optional[str] = None

    for attempt, delay in enumerate((0,) + RETRY_DELAYS_S):
        if delay:
            on_status(f"[overpass] retrying in {delay}s ({last_error})")
            time.sleep(delay)
        try:
            on_status(f"[overpass] querying {url} for {county}, {state} "
                      f"(attempt {attempt + 1})")
            response = post(
                url, data={"data": query},
                headers={"User-Agent": USER_AGENT},
                timeout=QUERY_TIMEOUT_S + 60)
        except requests.RequestException as exc:
            last_error = f"request failed: {exc}"
            continue

        if response.status_code in (429, 504):
            last_error = f"HTTP {response.status_code} (server busy)"
            continue
        if response.status_code != 200:
            raise OverpassError(
                f"Overpass returned HTTP {response.status_code}: "
                f"{response.text[:300]}")

        try:
            payload = response.json()
        except ValueError as exc:
            last_error = f"bad JSON: {exc}"
            continue

        if not payload.get("elements"):
            # A county with zero cafes is a wrong boundary resolution, not a
            # real answer. Do not cache it.
            raise OverpassError(
                f"Overpass returned no elements for {county}, {state} — "
                "check the county/state names against OSM boundary tags")

        cache_file.parent.mkdir(parents=True, exist_ok=True)
        cache_file.write_text(json.dumps(payload))
        on_status(f"[overpass] {len(payload['elements'])} elements, "
                  f"cached to {cache_file}")
        return payload

    raise OverpassError(f"Overpass query failed after retries: {last_error}")
