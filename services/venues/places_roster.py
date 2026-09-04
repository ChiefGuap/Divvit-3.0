"""Completing the Orange County roster from Google Places.

## Why this exists

The roster came from OpenStreetMap via Overpass, which is free and keyless but
depends on volunteer mapping. Measured against Google Places text search over
five OC cities, **158 of 200 returned cafes had no match in the roster**. A
sample of 20 of those showed 5 were false alarms — the same business under a
different name, which my distance-and-name matcher missed — so the real
absence rate is around 60%, not 79%.

Either way the conclusion holds: OSM has well under half the county, and a
roster that claims to be "every cafe in Orange County" was not one.

## Matching, and why place_id matters

The old matcher compared names and coordinates, which produced those five
false alarms: "CUP by Blue Hummingbird Coffee" and "Blue Hummingbird Coffee
Roastery" are one business, and no name-overlap threshold separates that case
from two genuinely different cafes on the same block.

Google's `place_id` is stable and unique, so once a roster row carries one,
every later pass matches exactly. New rows get one immediately; existing OSM
rows acquire one the first time they are matched. The fuzzy path remains only
for that first contact.

## Cost

Text Search (New) bills per request. The sweep is one request per query
template per city, times up to three pages. That is ~$0.032 each, and the run
reports its own total rather than leaving it to be discovered on a bill.
Results are cached on disk, so a resumed run does not re-bill.
"""

from __future__ import annotations

import json
import os
import sqlite3
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Iterator, Optional

from .places import haversine_m, name_overlap

SEARCH_URL = "https://places.googleapis.com/v1/places:searchText"
DEFAULT_DB = Path("data/venues.db")
CACHE_DIR = Path("data/cache/places_roster")

# Billed per request by Google; used only to report a running total.
COST_PER_REQUEST_USD = 0.032

# Three pages is the API's own ceiling for a text search.
MAX_PAGES = 3

# The tag schemes people file cafes under differ by platform, so the sweep asks
# several ways rather than assuming one phrase reaches all of them. Boba and
# tea shops in particular rarely answer to "coffee shop".
QUERY_TEMPLATES = (
    "coffee shop in {city}, California",
    "cafe in {city}, California",
    "boba tea shop in {city}, California",
    "coffee roaster in {city}, California",
)

# Google's own types for the things we count as a cafe. Anything else that
# comes back — a restaurant that happens to serve coffee, a grocery — is
# dropped rather than widening the roster to make the count look better.
ACCEPTED_TYPES = {
    "cafe", "coffee_shop", "bakery", "tea_house", "juice_shop",
    "bubble_tea_store", "dessert_shop",
}

FIELD_MASK = ",".join((
    "places.id", "places.displayName", "places.location",
    "places.formattedAddress", "places.primaryType", "places.types",
    "places.websiteUri", "places.nationalPhoneNumber",
    "places.businessStatus", "nextPageToken",
))


# Orange County's 34 incorporated cities, plus the unincorporated communities
# large enough to have their own cafes. Taken from the county's own list rather
# than from the roster's `city` column: that column is partly reverse-geocoded
# and contains shopping centres ("Woodbury Town Center", "Harbor Center") and
# at least one city in the wrong county (Pico Rivera is Los Angeles County).
# Sweeping those would spend requests on places that are not cities and miss
# cities with no cafes mapped yet — which is precisely the gap being closed.
OC_CITIES = (
    "Aliso Viejo", "Anaheim", "Brea", "Buena Park", "Costa Mesa", "Cypress",
    "Dana Point", "Fountain Valley", "Fullerton", "Garden Grove",
    "Huntington Beach", "Irvine", "La Habra", "La Palma", "Laguna Beach",
    "Laguna Hills", "Laguna Niguel", "Laguna Woods", "Lake Forest",
    "Los Alamitos", "Mission Viejo", "Newport Beach", "Orange", "Placentia",
    "Rancho Santa Margarita", "San Clemente", "San Juan Capistrano",
    "Santa Ana", "Seal Beach", "Stanton", "Tustin", "Villa Park",
    "Westminster", "Yorba Linda",
    # Unincorporated but populous enough to carry their own venues.
    "Ladera Ranch", "Rancho Mission Viejo", "Coto de Caza", "North Tustin",
    "Rossmoor", "Midway City", "Trabuco Canyon", "Silverado",
)


class RosterError(RuntimeError):
    pass


@dataclass
class Candidate:
    place_id: str
    name: str
    lat: float
    lon: float
    address: str = ""
    primary_type: str = ""
    website: Optional[str] = None
    phone: Optional[str] = None
    business_status: str = ""

    @property
    def operational(self) -> bool:
        # CLOSED_PERMANENTLY must never enter the roster as active.
        return self.business_status in ("", "OPERATIONAL")


@dataclass
class SweepResult:
    requests: int = 0
    cached: int = 0
    returned: int = 0
    rejected_type: int = 0
    closed: int = 0
    already_known: int = 0
    inserted: int = 0
    linked_place_id: int = 0
    errors: list[str] = field(default_factory=list)

    @property
    def cost_usd(self) -> float:
        return round(self.requests * COST_PER_REQUEST_USD, 2)

    def to_dict(self) -> dict[str, Any]:
        d = {k: v for k, v in self.__dict__.items()}
        d["cost_usd"] = self.cost_usd
        return d


def _api_key() -> str:
    key = os.environ.get("GOOGLE_MAPS_API_KEY")
    if not key:
        env = Path(".env")
        if env.exists():
            for line in env.read_text().splitlines():
                if line.startswith("GOOGLE_MAPS_API_KEY="):
                    key = line.split("=", 1)[1].strip().strip('"').strip("'")
                    break
    if not key:
        raise RosterError("GOOGLE_MAPS_API_KEY is not set")
    return key


def _cache_path(query: str, page: int) -> Path:
    slug = "".join(ch if ch.isalnum() else "-" for ch in query.lower())[:120]
    return CACHE_DIR / f"{slug}--p{page}.json"


def search_page(query: str, page: int, token: Optional[str], key: str,
                use_cache: bool = True,
                result: Optional[SweepResult] = None) -> dict[str, Any]:
    """One text-search page, cached on disk so a resumed sweep does not re-bill."""
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cached = _cache_path(query, page)
    if use_cache and cached.exists():
        try:
            if result:
                result.cached += 1
            return json.loads(cached.read_text())
        except ValueError:
            pass

    body: dict[str, Any] = {"textQuery": query, "maxResultCount": 20}
    if token:
        body["pageToken"] = token
    req = urllib.request.Request(
        SEARCH_URL, data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "X-Goog-Api-Key": key,
                 "X-Goog-FieldMask": FIELD_MASK})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            payload = json.load(resp)
    except urllib.error.HTTPError as exc:
        raise RosterError(f"places {exc.code}: {exc.read()[:160].decode(errors='replace')}")
    if result:
        result.requests += 1
    cached.write_text(json.dumps(payload))
    return payload


def candidates_for_city(city: str, key: str, result: SweepResult,
                        pause: float = 2.0) -> Iterator[Candidate]:
    """Every distinct place the templates surface for one city."""
    seen: set[str] = set()
    for template in QUERY_TEMPLATES:
        query = template.format(city=city)
        token: Optional[str] = None
        for page in range(MAX_PAGES):
            try:
                payload = search_page(query, page, token, key, result=result)
            except RosterError as exc:
                result.errors.append(f"{query} p{page}: {exc}")
                break

            for p in payload.get("places", []):
                result.returned += 1
                pid = p.get("id")
                name = (p.get("displayName") or {}).get("text") or ""
                loc = p.get("location") or {}
                if not pid or not name or loc.get("latitude") is None:
                    continue
                if pid in seen:
                    continue
                seen.add(pid)

                types = set(p.get("types") or [])
                if p.get("primaryType"):
                    types.add(p["primaryType"])
                if not (types & ACCEPTED_TYPES):
                    result.rejected_type += 1
                    continue

                cand = Candidate(
                    place_id=pid, name=name,
                    lat=loc["latitude"], lon=loc["longitude"],
                    address=p.get("formattedAddress") or "",
                    primary_type=p.get("primaryType") or "",
                    website=p.get("websiteUri"),
                    phone=p.get("nationalPhoneNumber"),
                    business_status=p.get("businessStatus") or "")
                if not cand.operational:
                    result.closed += 1
                    continue
                yield cand

            token = payload.get("nextPageToken")
            if not token:
                break
            time.sleep(pause)


def _ensure_columns(conn: sqlite3.Connection) -> None:
    cols = {r[1] for r in conn.execute("PRAGMA table_info(cafes)")}
    if "google_place_id" not in cols:
        conn.execute("ALTER TABLE cafes ADD COLUMN google_place_id TEXT")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_cafes_place_id"
                     " ON cafes(google_place_id)")


def _match_existing(conn: sqlite3.Connection, cand: Candidate
                    ) -> tuple[Optional[str], str]:
    """(cafe_id, how) for a candidate already on the roster.

    place_id first because it is exact. The fuzzy fallback exists only for OSM
    rows that have never been matched, and it is deliberately stricter than the
    audit's threshold — 0.55 and 120m — because a false merge silently deletes
    a real cafe from the roster, which is worse than a duplicate we can spot.
    """
    row = conn.execute("SELECT cafe_id FROM cafes WHERE google_place_id = ?",
                       (cand.place_id,)).fetchone()
    if row:
        return row[0], "place_id"

    near = conn.execute(
        "SELECT cafe_id, name, lat, lon FROM cafes"
        " WHERE lat IS NOT NULL AND abs(lat - ?) < 0.003 AND abs(lon - ?) < 0.003",
        (cand.lat, cand.lon)).fetchall()
    for cafe_id, name, lat, lon in near:
        if (haversine_m(cand.lat, cand.lon, lat, lon) <= 120
                and name_overlap(cand.name, name) >= 0.55):
            return cafe_id, "name+distance"
    return None, "none"


def sweep(cities: list[str], db: Path | str = DEFAULT_DB,
          on_status: Callable[[str], None] = lambda m: None,
          dry_run: bool = False) -> SweepResult:
    """Search every city and add whatever the roster is missing.

    Commits per city so an interrupted run keeps the requests it paid for.
    """
    key = _api_key()
    result = SweepResult()
    conn = sqlite3.connect(db)
    conn.row_factory = sqlite3.Row
    try:
        _ensure_columns(conn)
        conn.commit()
        for city in cities:
            added = 0
            for cand in candidates_for_city(city, key, result):
                cafe_id, how = _match_existing(conn, cand)
                if cafe_id:
                    result.already_known += 1
                    if how != "place_id" and not dry_run:
                        # Cheap upgrade: give the OSM row a stable id so the
                        # fuzzy path is never needed for it again.
                        conn.execute(
                            "UPDATE cafes SET google_place_id = ?,"
                            " updated_at = datetime('now') WHERE cafe_id = ?",
                            (cand.place_id, cafe_id))
                        result.linked_place_id += 1
                    continue

                result.inserted += 1
                added += 1
                if dry_run:
                    continue
                conn.execute(
                    "INSERT OR IGNORE INTO cafes"
                    " (cafe_id, name, lat, lon, city, city_source, county, source,"
                    "  website, phone, google_place_id, status, status_reason,"
                    "  first_seen, updated_at)"
                    " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'),datetime('now'))",
                    (f"places:{cand.place_id}", cand.name, cand.lat, cand.lon,
                     city, "places", "Orange County", "places",
                     cand.website, cand.phone, cand.place_id,
                     "active", "listed as operational by Google Places"))
            conn.commit()
            on_status(f"  {city:<22} +{added} new "
                      f"({result.requests} requests, ${result.cost_usd})")
    finally:
        conn.close()
    return result
