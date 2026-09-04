"""A prefilled venue profile, ready for the day a cafe signs up.

## What this is for

Every cafe in Orange County should already have a profile waiting, so a venue
that onboards sees its own brand health on the first screen instead of an
empty dashboard. That means two things have to be true at once, and they pull
against each other:

  * enough must be filled in that the page is worth looking at, and
  * nothing filled in may be wrong.

A cafe seeing incorrect facts about itself on day one is far worse than one
seeing gaps. It reads as carelessness about the thing they care most about,
and it is the first impression we get. So every field carries **where it came
from**, and anything we did not measure is `null` with a stated reason rather
than a plausible default.

## The three provenance levels

`observed`   — read from a public source we can name (OSM, Google Places).
`derived`    — computed by us from observations (brand health, a reverse
               geocoded city). Correct as far as the inputs go, but ours.
`unverified` — we have nothing, and the venue must supply it.

`needs_from_venue` is the list that matters at onboarding: the exact fields a
cafe should confirm or fill, ordered by how much they change what we can do
for them. Social handles come first because without them there is nothing to
attribute a video to.
"""

from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

PROFILE_SCHEMA_VERSION = 1
DEFAULT_DB = Path("data/venues.db")

OBSERVED, DERIVED, UNVERIFIED = "observed", "derived", "unverified"

# Ordered by how much having it changes what the product can do. Social handles
# lead because a video cannot be attributed to a venue without one.
ASK_ORDER = (
    ("instagram", "Instagram handle",
     "Needed to attribute posts and to receive story mentions."),
    ("tiktok", "TikTok handle",
     "Needed to attribute posts. TikTok is where this content actually lives."),
    ("website", "Website", "Used to confirm the venue is still trading."),
    ("phone", "Phone number", "Used to confirm the venue is still trading."),
    ("opening_hours", "Opening hours",
     "Lets campaigns target the hours you actually want filmed."),
    ("cuisine", "What you serve",
     "Sharpens which creators and searches we match you against."),
)


@dataclass
class Field_:
    """One value plus how we came by it."""
    value: Any
    source: str                       # observed | derived | unverified
    origin: str = ""                  # osm, places, reverse_geocode, model…
    note: str = ""

    def to_dict(self) -> dict[str, Any]:
        d = {"value": self.value, "source": self.source}
        if self.origin:
            d["origin"] = self.origin
        if self.note:
            d["note"] = self.note
        return d


def _f(value: Any, origin: str, source: str = OBSERVED,
       note: str = "") -> Field_:
    """Blank strings are absence, not a value someone typed."""
    if value is None or (isinstance(value, str) and not value.strip()):
        return Field_(None, UNVERIFIED, note=note or "not on file")
    return Field_(value, source, origin, note)


def _origin_for_source(source: str) -> str:
    return {"overpass": "osm", "places": "google_places"}.get(source or "", source or "unknown")


def build_profile(row: dict[str, Any], health: Optional[dict[str, Any]] = None,
                  signals: Optional[dict[str, Any]] = None) -> dict[str, Any]:
    """One cafe's prefilled profile.

    `row` is a `cafes` row as a dict; `health` and `signals` are optional
    because most of the roster has neither, and a profile without them is
    still worth showing — it just says so.
    """
    origin = _origin_for_source(row.get("source", ""))
    city_origin = ("reverse_geocode" if row.get("city_source") == "reverse_geocode"
                   else origin)
    city_source = DERIVED if row.get("city_source") == "reverse_geocode" else OBSERVED

    identity = {
        "name": _f(row.get("name"), origin),
        "city": _f(row.get("city"), city_origin, city_source,
                   note=("reverse geocoded from coordinates; confirm at onboarding"
                         if city_source == DERIVED else "")),
        "address": _f(" ".join(x for x in (row.get("housenumber"),
                                           row.get("street")) if x).strip() or None,
                      origin),
        "postcode": _f(row.get("postcode"), origin),
        "county": _f(row.get("county"), origin),
        "coordinates": _f(
            {"lat": row["lat"], "lon": row["lon"]}
            if row.get("lat") is not None and row.get("lon") is not None else None,
            origin),
    }

    contact = {
        "website": _f(row.get("website"), origin),
        "phone": _f(row.get("phone"), origin),
        "instagram": _f(row.get("instagram"), origin),
        "tiktok": _f(row.get("tiktok"), origin),
        "facebook": _f(row.get("facebook"), origin),
    }

    operations = {
        "opening_hours": _f(row.get("opening_hours"), origin),
        "cuisine": _f(row.get("cuisine"), origin),
        "is_chain": Field_(bool(row.get("is_chain")), DERIVED, "roster_rules",
                           "chains are excluded from the independent cohort"),
        "status": Field_(row.get("status") or "active", DERIVED, "lifecycle",
                         row.get("status_reason") or ""),
    }

    # Brand health is preconfigured where it exists. Where it does not, the key
    # stays present and null so the shape never changes between cafes.
    if health:
        brand_health = {
            "score": Field_(health.get("score"), DERIVED, "brand_health_model",
                            f"confidence: {health.get('confidence', 'unknown')}"),
            "confidence": Field_(health.get("confidence"), DERIVED, "brand_health_model"),
            "rankable": Field_(health.get("rankable"), DERIVED, "brand_health_model",
                               "false means too little is measured to compare "
                               "this venue against others"),
            "components": Field_(health.get("components"), DERIVED, "brand_health_model"),
        }
    else:
        brand_health = {
            "score": Field_(None, UNVERIFIED, note="not measured yet"),
            "confidence": Field_(None, UNVERIFIED),
            "rankable": Field_(False, DERIVED, "brand_health_model",
                               "nothing measured, so not comparable"),
            "components": Field_(None, UNVERIFIED),
        }

    review = (signals or {}).get("review") or {}
    review_block = {
        "rating": _f(review.get("rating"), "google_places"),
        "review_count": _f(review.get("count"), "google_places"),
    }

    asks: list[dict[str, str]] = []
    merged = {**contact, **operations}
    for key, label, why in ASK_ORDER:
        f = merged.get(key)
        if f is not None and f.source == UNVERIFIED:
            asks.append({"field": key, "label": label, "why": why})

    # A profile is "ready to show" when there is something on it beyond a name
    # and a dot on a map. Below that bar the venue's first screen would be an
    # empty state with their own name on it.
    substantive = sum(
        1 for f in (*contact.values(), brand_health["score"],
                    review_block["rating"], operations["opening_hours"])
        if f.source != UNVERIFIED)

    def unwrap(d: dict[str, Field_]) -> dict[str, Any]:
        return {k: v.to_dict() for k, v in d.items()}

    return {
        "schema_version": PROFILE_SCHEMA_VERSION,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "cafe_id": row.get("cafe_id"),
        "google_place_id": row.get("google_place_id"),
        "identity": unwrap(identity),
        "contact": unwrap(contact),
        "operations": unwrap(operations),
        "brand_health": unwrap(brand_health),
        "review_signal": unwrap(review_block),
        "needs_from_venue": asks,
        "readiness": {
            "substantive_fields": substantive,
            "ready_to_show": substantive >= 2,
            "note": ("A profile below two measured fields would greet the venue "
                     "with an empty state carrying their own name."),
        },
    }


def profiles(db: Path | str = DEFAULT_DB, limit: Optional[int] = None,
             active_only: bool = True) -> list[dict[str, Any]]:
    conn = sqlite3.connect(db)
    conn.row_factory = sqlite3.Row
    try:
        sql = "SELECT * FROM cafes"
        if active_only:
            sql += " WHERE status = 'active'"
        sql += " ORDER BY name"
        if limit:
            sql += f" LIMIT {int(limit)}"
        rows = [dict(r) for r in conn.execute(sql)]

        health_by_id: dict[str, dict[str, Any]] = {}
        try:
            for r in conn.execute(
                    "SELECT cafe_id, score, confidence, rankable, components"
                    " FROM brand_health_snapshots"
                    " WHERE (cafe_id, captured_at) IN"
                    " (SELECT cafe_id, MAX(captured_at) FROM brand_health_snapshots"
                    "  GROUP BY cafe_id)"):
                d = dict(r)
                if isinstance(d.get("components"), str):
                    try:
                        d["components"] = json.loads(d["components"])
                    except ValueError:
                        d["components"] = None
                health_by_id[d["cafe_id"]] = d
        except sqlite3.OperationalError:
            pass  # no snapshots table yet; profiles still build

        return [build_profile(r, health_by_id.get(r["cafe_id"])) for r in rows]
    finally:
        conn.close()
