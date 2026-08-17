"""The cafe roster — Discover's organizing unit, pivoted from video-first.

Discover used to start from videos and work backwards to venues. This inverts
it: start from *every independent cafe in a county*, then measure the public
signal about each one. The point is a sales motion — show a cafe its own Brand
Health dashboard before it signs — so the roster has to be complete, chain-free,
and keyed stably enough to accumulate signal across runs.

Source is OpenStreetMap via Overpass (see `overpass.py`): free, no key, and the
`osm:<type>:<id>` key is stable across re-harvests. OSM coverage of independents
is good but not perfect; the roster is a floor, not a census, and the README
says so.

Chain exclusion is two independent tests, either of which excludes:
  1. OSM says so — a `brand` or `brand:wikidata` tag means a mapper already
     identified this as a branded location.
  2. We say so — a normalized name/operator match against a blocklist of the
     coffee/boba/bakery chains actually present in Southern California, because
     plenty of Starbucks nodes carry no brand tag.

Excluded cafes are *stored with a reason*, not dropped — "how many chains did
we filter" is a question the roster must be able to answer later.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field, asdict
from typing import Any, Iterable, Optional

from .resolver import normalize

# Normalized-form name fragments. Matching is on word boundaries against the
# normalized name/operator/brand, so "scooter s" matches "Scooter's Coffee" but
# a hypothetical "Scooterville Cafe" survives. Extend freely; a false positive
# here silently deletes a prospect, so prefer specific over clever.
CHAIN_BLOCKLIST = (
    # coffee
    "starbucks", "dunkin", "peet s", "peets", "philz", "coffee bean",
    "dutch bros", "tim hortons", "mccafe", "mcdonald s", "scooter s coffee",
    "black rock coffee", "the human bean", "bad ass coffee", "ziggi s",
    "coffee bean and tea leaf",
    # bakery-cafe chains
    "85 c", "85c", "panera", "krispy kreme", "einstein bros", "paris baguette",
    "tous les jours", "corner bakery", "le pain quotidien", "kolache factory",
    # single-local-site national chains the multi-location test cannot see
    # (both leaked into the first live ranking before this entry)
    "bluestone lane",
    # boba / tea chains (heavy OC presence)
    "sharetea", "kung fu tea", "ding tea", "boba time", "gong cha", "chatime",
    "happy lemon", "tp tea", "7 leaves", "tapioca express", "omomo",
    "sunright", "wushiland", "one zo", "meet fresh", "yifang", "xing fu tang",
    "tiger sugar", "somisomi", "cha for tea", "tastea", "boba guys",
    # juice chains that OSM sometimes tags as cafes
    "nekter", "juice it up", "jamba",
)


def _boundary_match(name: str, fragment: str) -> bool:
    """Word-boundary substring: 'peet s' in 'peet s coffee', not in 'trumpeets'."""
    return f" {fragment} " in f" {name} "


def chain_reason(tags: dict[str, str]) -> Optional[str]:
    """Why this OSM element is a chain, or None if it looks independent."""
    if tags.get("brand:wikidata"):
        return f"brand:wikidata={tags['brand:wikidata']}"
    if tags.get("brand"):
        return f"brand={tags['brand']}"
    for field_name in ("name", "operator"):
        norm = normalize(tags.get(field_name, ""))
        if not norm:
            continue
        for fragment in CHAIN_BLOCKLIST:
            if _boundary_match(norm, fragment):
                return f"{field_name} matches blocklist ({fragment!r})"
    return None


@dataclass
class CafeRecord:
    """One physical cafe, keyed stably on its OSM identity."""

    cafe_id: str            # osm:<node|way|relation>:<id> — dedupe key
    name: str
    lat: Optional[float] = None
    lon: Optional[float] = None
    city: str = ""
    street: str = ""
    housenumber: str = ""
    postcode: str = ""
    website: str = ""
    phone: str = ""
    instagram: str = ""
    facebook: str = ""
    tiktok: str = ""
    cuisine: str = ""
    opening_hours: str = ""
    county: str = ""
    source: str = "overpass"
    is_chain: bool = False
    exclusion_reason: str = ""
    tags: dict[str, str] = field(default_factory=dict)  # raw OSM tags, evidence

    def address(self) -> str:
        street = " ".join(p for p in (self.housenumber, self.street) if p)
        return ", ".join(p for p in (street, self.city, self.postcode) if p)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "CafeRecord":
        known = set(cls.__dataclass_fields__)
        return cls(**{k: v for k, v in d.items() if k in known})


def _tag(tags: dict[str, str], *keys: str) -> str:
    """First non-empty value among aliases — OSM has several spellings for
    most contact fields (`website` vs `contact:website`, etc.)."""
    for key in keys:
        value = (tags.get(key) or "").strip()
        if value:
            return value
    return ""


def _handle(value: str) -> str:
    """'https://www.instagram.com/kitkoffee/' and '@kitkoffee' both -> 'kitkoffee'."""
    value = value.strip().rstrip("/")
    if "/" in value:
        value = value.rsplit("/", 1)[-1]
    return value.lstrip("@").split("?")[0]


def element_to_cafe(element: dict[str, Any], county: str = "") -> Optional[CafeRecord]:
    """One Overpass element -> CafeRecord, or None for nameless elements.

    Nameless cafe nodes exist (someone mapped a building outline and stopped);
    without a name we can neither search for videos nor sell a dashboard, so
    they are dropped and counted by the caller rather than stored.
    """
    tags = element.get("tags") or {}
    name = (tags.get("name") or "").strip()
    if not name:
        return None

    # nodes carry lat/lon directly; ways/relations get a computed `center`
    center = element.get("center") or {}
    lat = element.get("lat", center.get("lat"))
    lon = element.get("lon", center.get("lon"))

    reason = chain_reason(tags)
    return CafeRecord(
        cafe_id=f"osm:{element.get('type')}:{element.get('id')}",
        name=name,
        lat=lat,
        lon=lon,
        city=_tag(tags, "addr:city"),
        street=_tag(tags, "addr:street"),
        housenumber=_tag(tags, "addr:housenumber"),
        postcode=_tag(tags, "addr:postcode"),
        website=_tag(tags, "website", "contact:website", "url"),
        phone=_tag(tags, "phone", "contact:phone"),
        instagram=_handle(_tag(tags, "contact:instagram", "instagram")),
        facebook=_handle(_tag(tags, "contact:facebook", "facebook")),
        tiktok=_handle(_tag(tags, "contact:tiktok", "tiktok")),
        cuisine=_tag(tags, "cuisine"),
        opening_hours=_tag(tags, "opening_hours"),
        county=county,
        is_chain=reason is not None,
        exclusion_reason=reason or "",
        tags=dict(tags),
    )


def parse_overpass(payload: dict[str, Any], county: str = ""
                   ) -> tuple[list[CafeRecord], dict[str, int]]:
    """Overpass JSON -> deduped cafes (chains included, flagged) + tally.

    Dedupe inside one response matters because the query unions several tag
    clauses (`amenity=cafe`, `shop=coffee`, ...) and one venue often matches
    two of them.
    """
    seen: set[str] = set()
    cafes: list[CafeRecord] = []
    tally = {"elements": 0, "nameless": 0, "duplicates": 0,
             "independent": 0, "chain": 0}

    for element in payload.get("elements") or []:
        tally["elements"] += 1
        cafe = element_to_cafe(element, county=county)
        if cafe is None:
            tally["nameless"] += 1
            continue
        if cafe.cafe_id in seen:
            tally["duplicates"] += 1
            continue
        seen.add(cafe.cafe_id)
        cafes.append(cafe)
        tally["chain" if cafe.is_chain else "independent"] += 1

    return cafes, tally


def flag_local_chains(cafes: list[CafeRecord], min_locations: int = 3
                      ) -> int:
    """Third exclusion test, run over the whole roster: the same name at
    `min_locations`+ sites in one county is a multi-location brand, whatever
    its tags say. Caught live: Bodhi Leaf Coffee Traders (7 OC locations) and
    Lollicup (a franchise) both arrived brand-tag-free and off-blocklist.

    Two locations stays independent — a cafe that opened a second shop is
    still exactly the prospect Divvit wants.
    """
    tally: dict[str, int] = {}
    for cafe in cafes:
        if not cafe.is_chain:
            tally[normalize(cafe.name)] = tally.get(normalize(cafe.name), 0) + 1

    flagged = 0
    for cafe in cafes:
        count = tally.get(normalize(cafe.name), 0)
        if not cafe.is_chain and count >= min_locations:
            cafe.is_chain = True
            cafe.exclusion_reason = (f"{count} same-name locations in county "
                                     "(multi-location brand)")
            flagged += 1
    return flagged


def roster_to_json(cafes: Iterable[CafeRecord]) -> str:
    return json.dumps({"cafes": [c.to_dict() for c in cafes]},
                      indent=2, ensure_ascii=False)
