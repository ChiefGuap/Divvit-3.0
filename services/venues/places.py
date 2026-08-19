"""Google Places — the review signal, and the roster's identity check.

Yelp blocked every request at the IP level on the first live run (measured
2026-08-16, three cafes, HTTP 403 from the first call). That left the review
component dark for all 120 measured cafes and capped every Brand Health score
at `medium` confidence. Places is the replacement, and it is a better source
than the one it replaces:

  * **Ratings and review counts are first-party**, not parsed out of markup
    that changes without notice.
  * **It resolves identity.** Text search returns a stable `place_id`, the
    formatted address, and coordinates, so an OSM record can be confirmed
    against the business Google knows at that location. A rating attached to
    the wrong cafe is worse than no rating.
  * `businessStatus` tells us a cafe has closed — the roster inherits OSM's
    staleness, and scoring a closed cafe is embarrassing in a sales context.

Places API (New) v1 is used rather than the legacy endpoint: the legacy
`/maps/api/place/*` family is deprecated for new projects, and the new API's
field mask means we are billed only for the fields we ask for.

## Cost discipline

Text Search bills per request, per SKU, by the fields requested. The field
mask here is deliberately minimal — id, name, address, location, rating,
count, status — which keeps every call in the cheaper tier and never touches
the expensive ones (reviews text, photos, atmosphere). `MAX_RESULTS = 1`
because we want the best match, not a page of them.

Responses are cached to disk keyed by the query, so re-running a metrics pass
over an already-measured roster costs nothing. That matters: the pass is
designed to resume across nights, and without a cache a resume would re-bill
every cafe already done.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import time
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Any, Optional

import requests

SEARCH_URL = "https://places.googleapis.com/v1/places:searchText"

# Only what the score and the identity check need. Every added field can move
# the request into a costlier SKU.
FIELD_MASK = ",".join((
    "places.id",
    "places.displayName",
    "places.formattedAddress",
    "places.location",
    "places.rating",
    "places.userRatingCount",
    "places.businessStatus",
))

DEFAULT_CACHE_DIR = Path("data/places")
MAX_RESULTS = 1

# Metres. Google's pin and OSM's node rarely agree exactly; they disagree by a
# lot when the text search has matched a different business with a similar
# name. 400m is generous enough for a mall unit or a mis-tagged OSM node and
# tight enough to catch a match in the next town.
MAX_LOCATION_DRIFT_M = 400.0

# Google returns "OPERATIONAL", "CLOSED_TEMPORARILY", "CLOSED_PERMANENTLY".
OPERATIONAL = "OPERATIONAL"

# Only used when the OSM record has no coordinates to check against, which is
# rare — nodes almost always carry lat/lon. With geometry unavailable the name
# is the only evidence, so the bar is deliberately high: "Sergio's" vs
# "Sergio's Fine Jewelry" scores 0.33 here and is refused, which is the right
# answer for a cafe roster.
MIN_NAME_OVERLAP_NO_LOCATION = 0.6

# Radius of the search bias circle around the OSM node. Wide enough to absorb
# a mis-placed node or a mall address, narrow enough that a same-named
# business in the next county does not outrank the real one.
LOCATION_BIAS_RADIUS_M = 5_000.0

_WORD = re.compile(r"[a-z0-9]+")


class PlacesError(RuntimeError):
    pass


@dataclass
class PlaceMatch:
    place_id: str
    name: str
    address: str
    latitude: Optional[float]
    longitude: Optional[float]
    rating: Optional[float]
    review_count: Optional[int]
    business_status: str
    # How far Google's pin sits from the OSM node, and whether the names
    # agree. Both travel with the match so a bad attach can be audited later
    # instead of silently scoring the wrong business.
    distance_m: Optional[float] = None
    name_overlap: Optional[float] = None

    @property
    def is_operational(self) -> bool:
        return self.business_status == OPERATIONAL

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _tokens(text: str) -> set[str]:
    """Word tokens, minus the debris that inflates a match.

    Possessives are the specific problem: "Sergio's" tokenizes to
    {sergio, s}, and that stray single character is a free point of overlap
    against any other possessive name.
    """
    return {t for t in _WORD.findall((text or "").lower()) if len(t) > 1}


def name_overlap(a: str, b: str) -> float:
    """Jaccard over word tokens. 1.0 is identical, 0.0 shares nothing."""
    ta, tb = _tokens(a), _tokens(b)
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / len(ta | tb)


def haversine_m(lat1: Optional[float], lon1: Optional[float],
                lat2: Optional[float], lon2: Optional[float]) -> Optional[float]:
    """Great-circle metres, or None when either point is unknown."""
    if None in (lat1, lon1, lat2, lon2):
        return None
    import math
    r = 6_371_000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = (math.sin(dp / 2) ** 2
         + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2)
    return 2 * r * math.asin(math.sqrt(a))


class PlacesClient:
    def __init__(self, api_key: Optional[str] = None,
                 cache_dir: Path | str = DEFAULT_CACHE_DIR,
                 timeout: int = 30, min_interval_s: float = 0.05):
        self.api_key = api_key or os.environ.get("GOOGLE_MAPS_API_KEY", "")
        self.cache_dir = Path(cache_dir)
        self.timeout = timeout
        self.min_interval_s = min_interval_s
        self._last_call = 0.0
        self._session: Optional[requests.Session] = None
        # Counted so a run can report what it actually billed for, separately
        # from what it served from cache.
        self.billed_calls = 0
        self.cache_hits = 0

    def available(self) -> tuple[bool, str]:
        if not self.api_key:
            return False, "GOOGLE_MAPS_API_KEY not set"
        return True, "google places (new) v1"

    def _sess(self) -> requests.Session:
        if self._session is None:
            self._session = requests.Session()
        return self._session

    def _cache_path(self, key: str) -> Path:
        digest = hashlib.sha256(key.encode()).hexdigest()[:20]
        return self.cache_dir / f"{digest}.json"

    def search_raw(self, query: str, use_cache: bool = True,
                   latitude: Optional[float] = None,
                   longitude: Optional[float] = None) -> dict[str, Any]:
        """One text search. Cached by query + bias so a resume never re-bills.

        The bias is part of the cache key because it changes the answer: the
        same query with and without a location returns different businesses.
        """
        biased = latitude is not None and longitude is not None
        cache_key = (f"{query}|{latitude:.4f},{longitude:.4f}" if biased
                     else query)
        cached = self._cache_path(cache_key)
        if use_cache and cached.exists():
            self.cache_hits += 1
            try:
                return json.loads(cached.read_text())
            except ValueError:
                pass  # a corrupt cache entry just re-fetches

        ok, why = self.available()
        if not ok:
            raise PlacesError(why)

        # Cheap politeness: Places has generous QPS but a roster pass is a
        # burst of hundreds of identical-shaped calls.
        elapsed = time.time() - self._last_call
        if elapsed < self.min_interval_s:
            time.sleep(self.min_interval_s - elapsed)

        body: dict[str, Any] = {"textQuery": query,
                                "maxResultCount": MAX_RESULTS}
        if biased:
            # Bias, not restrict: 218 of the OC roster's records carry no
            # addr:city, so their query is bare "<name> CA" and text search
            # will happily return the same-named business 500km away. The OSM
            # node's coordinates are the strongest locality signal we hold.
            body["locationBias"] = {"circle": {
                "center": {"latitude": latitude, "longitude": longitude},
                "radius": LOCATION_BIAS_RADIUS_M}}

        response = self._sess().post(
            SEARCH_URL, timeout=self.timeout,
            headers={"X-Goog-Api-Key": self.api_key,
                     "X-Goog-FieldMask": FIELD_MASK},
            json=body)
        self._last_call = time.time()

        if response.status_code == 403:
            raise PlacesError(
                "places -> 403: key rejected. Check the key is unrestricted "
                "for this IP and that 'Places API (New)' is enabled.")
        if response.status_code == 429:
            raise PlacesError("places -> 429: quota exhausted")
        if response.status_code >= 400:
            raise PlacesError(
                f"places -> {response.status_code}: {response.text[:200]}")

        payload = response.json() or {}
        self.billed_calls += 1
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        cached.write_text(json.dumps(payload))
        return payload

    def find(self, name: str, city: str = "", state: str = "CA",
             latitude: Optional[float] = None,
             longitude: Optional[float] = None,
             use_cache: bool = True) -> tuple[Optional[PlaceMatch], Optional[str]]:
        """Best match for a roster cafe, with identity checks applied.

        Returns (match, reason-it-was-rejected). A rejected match is returned
        as None *with* the reason rather than silently dropped, so a metrics
        pass can report why a cafe has no review signal.
        """
        where = ", ".join(p for p in (city, state) if p)
        query = f"{name} {where}".strip() if where else name

        try:
            payload = self.search_raw(query, use_cache=use_cache,
                                      latitude=latitude, longitude=longitude)
        except PlacesError as exc:
            return None, str(exc)

        places = payload.get("places") or []
        if not places:
            return None, "places: no result for this name and city"

        top = places[0]
        location = top.get("location") or {}
        match = PlaceMatch(
            place_id=top.get("id") or "",
            name=(top.get("displayName") or {}).get("text") or "",
            address=top.get("formattedAddress") or "",
            latitude=location.get("latitude"),
            longitude=location.get("longitude"),
            rating=top.get("rating"),
            review_count=top.get("userRatingCount"),
            business_status=top.get("businessStatus") or "",
        )
        match.name_overlap = name_overlap(name, match.name)
        match.distance_m = haversine_m(latitude, longitude,
                                       match.latitude, match.longitude)

        # Identity gates. The failure mode being defended against is the one
        # the YouTube relevance gate already hit: a common cafe name matching
        # a different business elsewhere. A wrong 4.8 is worse than no rating.
        if match.distance_m is not None and match.distance_m > MAX_LOCATION_DRIFT_M:
            return None, (f"places: matched '{match.name}' "
                          f"{match.distance_m:.0f}m away — too far to be the "
                          "same business")
        if match.distance_m is None and match.name_overlap < MIN_NAME_OVERLAP_NO_LOCATION:
            # No coordinates to check against, so the name has to carry it.
            return None, (f"places: matched '{match.name}' which does not "
                          f"look like '{name}' and has no location to confirm")
        return match, None


def review_signal_from(match: Optional[PlaceMatch]) -> Optional[dict[str, Any]]:
    """PlaceMatch -> the signals blob Brand Health reads.

    A place with no ratings yet returns None rather than a zero: a new cafe
    nobody has reviewed is unmeasured, not badly reviewed.
    """
    if match is None or match.rating is None:
        return None
    return {
        "provider": "google_places",
        "rating": match.rating,
        "review_count": match.review_count or 0,
        "place_id": match.place_id,
        "matched_name": match.name,
        "address": match.address,
        "business_status": match.business_status,
        "distance_m": (round(match.distance_m, 1)
                       if match.distance_m is not None else None),
        "name_overlap": (round(match.name_overlap, 2)
                         if match.name_overlap is not None else None),
    }
