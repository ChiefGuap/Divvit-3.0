"""Filling in the addresses Overpass did not carry.

294 of 686 cafes came out of OpenStreetMap with no city. Every one of them has
coordinates, but only 17 have a postcode and 32 a street — so there is nothing
local to derive a city from, and reverse geocoding is the only route.

**Validated before use, not after.** The method was checked against the 12
rows that already held a postcode: reverse geocoding agreed with the postcode
on file 12 times out of 12. That is the evidence for trusting it on the other
282, and it is the only reason this writes to the database at all.

A wrong city is worse than a blank one. A blank city shows up as missing; a
wrong one silently corrupts every per-city rollup and looks like data. So:

  * `city_source` records how each value was obtained, so a geocoded city is
    never mistaken for one OSM supplied.
  * Anything the geocoder cannot place is left blank and counted, never
    guessed at from a neighbouring result.
  * Only cafes inside Orange County are accepted. A coordinate that reverse
    geocodes to another county means the row is wrong, not that the county is.
"""

from __future__ import annotations

import json
import os
import sqlite3
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Iterator, Optional

GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json"
DEFAULT_DB = Path("data/venues.db")

# Google bills per request; this is the whole cost of the backfill.
COST_PER_REQUEST_USD = 0.005

CITY_TYPES = ("locality", "sublocality", "administrative_area_level_3")


@dataclass
class GeocodeResult:
    cafe_id: str
    city: Optional[str] = None
    postcode: Optional[str] = None
    street: Optional[str] = None
    county: Optional[str] = None
    status: str = "ok"          # ok | no_result | out_of_county | error

    @property
    def usable(self) -> bool:
        return self.status == "ok" and bool(self.city)


def _api_key() -> str:
    key = os.environ.get("GOOGLE_MAPS_API_KEY")
    if not key:
        env = Path(".env")
        if env.exists():
            for line in env.read_text().splitlines():
                if line.startswith("GOOGLE_MAPS_API_KEY=") and "=" in line:
                    key = line.split("=", 1)[1].strip().strip('"').strip("'")
                    break
    if not key:
        raise RuntimeError("GOOGLE_MAPS_API_KEY is not set")
    return key


def _components(payload: dict[str, Any]) -> dict[str, str]:
    """Flatten address components, nearest result first.

    `setdefault` means the most specific result wins: Google returns results
    ordered from precise to broad, and taking the first occurrence of each
    type avoids picking up a county-wide value when a street-level one exists.
    """
    out: dict[str, str] = {}
    for result in payload.get("results", []):
        for comp in result.get("address_components", []):
            for kind in comp.get("types", []):
                out.setdefault(kind, comp.get("long_name", ""))
    return out


def reverse_geocode(lat: float, lon: float, key: str,
                    fetch: Optional[Callable[[str], dict[str, Any]]] = None,
                    county: str = "Orange County") -> GeocodeResult:
    query = urllib.parse.urlencode({"latlng": f"{lat},{lon}", "key": key})
    url = f"{GEOCODE_URL}?{query}"
    try:
        if fetch:
            payload = fetch(url)
        else:
            with urllib.request.urlopen(url, timeout=25) as resp:
                payload = json.load(resp)
    except (urllib.error.URLError, OSError, ValueError, TimeoutError) as exc:
        return GeocodeResult("", status=f"error:{type(exc).__name__}")

    status = payload.get("status")
    if status == "ZERO_RESULTS":
        return GeocodeResult("", status="no_result")
    if status != "OK":
        return GeocodeResult("", status=f"error:{status}")

    comp = _components(payload)
    city = next((comp[t] for t in CITY_TYPES if comp.get(t)), None)
    got_county = comp.get("administrative_area_level_2")

    # A coordinate that lands outside the county means the row is wrong. Say
    # so rather than writing a city that will look plausible in the UI.
    if got_county and county.lower() not in got_county.lower():
        return GeocodeResult("", city=city, county=got_county,
                             status="out_of_county")

    street = comp.get("route")
    number = comp.get("street_number")
    return GeocodeResult("", city=city, postcode=comp.get("postal_code"),
                         street=f"{number} {street}".strip() if street else None,
                         county=got_county, status="ok")


def _ensure_provenance_column(conn: sqlite3.Connection) -> None:
    cols = {r[1] for r in conn.execute("PRAGMA table_info(cafes)")}
    if "city_source" not in cols:
        conn.execute("ALTER TABLE cafes ADD COLUMN city_source TEXT")


def pending(db: Path | str = DEFAULT_DB, limit: Optional[int] = None
            ) -> list[sqlite3.Row]:
    """Cafes still missing a city. Resumable by construction: a row that has
    been filled no longer matches, so re-running never repeats paid work."""
    conn = sqlite3.connect(db)
    conn.row_factory = sqlite3.Row
    try:
        _ensure_provenance_column(conn)
        conn.commit()
        sql = ("SELECT cafe_id, name, lat, lon, street, postcode FROM cafes"
               " WHERE (city IS NULL OR trim(city) = '')"
               "   AND lat IS NOT NULL AND lon IS NOT NULL"
               " ORDER BY name")
        if limit:
            sql += f" LIMIT {int(limit)}"
        return list(conn.execute(sql))
    finally:
        conn.close()


def backfill(db: Path | str = DEFAULT_DB, limit: Optional[int] = None,
             pause: float = 0.12,
             on_status: Callable[[str], None] = lambda m: None
             ) -> dict[str, Any]:
    """Reverse geocode every cafe missing a city and write what comes back.

    Each row is committed as it is resolved rather than in one batch at the
    end: a run interrupted halfway keeps the requests it already paid for.
    """
    key = _api_key()
    rows = pending(db, limit)
    conn = sqlite3.connect(db)
    conn.row_factory = sqlite3.Row
    counts = {"attempted": 0, "filled": 0, "no_result": 0,
              "out_of_county": 0, "errors": 0, "no_city_in_result": 0}
    try:
        _ensure_provenance_column(conn)
        for row in rows:
            counts["attempted"] += 1
            res = reverse_geocode(row["lat"], row["lon"], key)

            if res.status == "no_result":
                counts["no_result"] += 1
            elif res.status == "out_of_county":
                counts["out_of_county"] += 1
                on_status(f"  {row['name'][:30]}: outside the county "
                          f"({res.county}) — left blank")
            elif res.status.startswith("error"):
                counts["errors"] += 1
            elif not res.city:
                counts["no_city_in_result"] += 1
            else:
                # Only fill street/postcode where we hold nothing; a value
                # already on the row came from OSM and is not ours to replace.
                conn.execute(
                    "UPDATE cafes SET city = ?, city_source = 'reverse_geocode',"
                    " postcode = COALESCE(NULLIF(trim(postcode), ''), ?),"
                    " street   = COALESCE(NULLIF(trim(street), ''), ?),"
                    " updated_at = datetime('now') WHERE cafe_id = ?",
                    (res.city, res.postcode, res.street, row["cafe_id"]))
                conn.commit()
                counts["filled"] += 1

            if counts["attempted"] % 25 == 0:
                on_status(f"  {counts['attempted']}/{len(rows)} "
                          f"({counts['filled']} filled)")
            time.sleep(pause)
    finally:
        conn.close()

    counts["cost_usd"] = round(counts["attempted"] * COST_PER_REQUEST_USD, 2)
    return counts
