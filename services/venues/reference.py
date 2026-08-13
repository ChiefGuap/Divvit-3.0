"""Venue fingerprints — reference material about the *real* business.

Venue verification today is closed-book: Pegasus looks at a submitted video and
compares it against whatever text we happened to store. If the business profile
is thin, there is nothing to compare against and everything lands in
`unclear`.

This module makes it open-book. Before verifying a submission we assemble what
is publicly known about the venue — its coordinates, its address, photos of its
exterior and interior — and verification becomes a comparison against evidence
rather than a judgement call.

Providers are pluggable because the good source (Google Places) needs a key
and a billing account, and the pipeline has to work before that exists:

    ManualProvider        — from the business profile we already store. Free,
                            works today, only as good as onboarding data.
    GooglePlacesProvider  — coordinates, address, and real photos of the venue.
                            Needs GOOGLE_MAPS_API_KEY.
    StreetViewProvider    — storefront imagery at the venue's coordinates.
                            Same key; the single best source for signage.

A fingerprint never asserts more than its source supports: `latitude` stays
None rather than guessed, because a fabricated coordinate would silently
convert the strongest verification signal into noise.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from typing import Any, Optional, Protocol

import requests

from .catalog import BusinessRecord

PLACES_BASE = "https://maps.googleapis.com/maps/api/place"
STREETVIEW_BASE = "https://maps.googleapis.com/maps/api/streetview"

# Photo kinds, ordered by how much they prove. A storefront shot with signage
# is near-conclusive; a plate of food could be any restaurant on earth.
KIND_STOREFRONT = "storefront"
KIND_INTERIOR = "interior"
KIND_FOOD = "food"
KIND_UNKNOWN = "unknown"

KIND_WEIGHT = {
    KIND_STOREFRONT: 1.0,
    KIND_INTERIOR: 0.8,
    KIND_UNKNOWN: 0.5,
    KIND_FOOD: 0.2,
}


@dataclass
class ReferenceImage:
    url: str
    kind: str = KIND_UNKNOWN
    source: str = ""
    local_path: Optional[str] = None

    def weight(self) -> float:
        return KIND_WEIGHT.get(self.kind, 0.5)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class VenueFingerprint:
    """Everything we know about the real venue, from all sources combined."""

    business_id: str
    name: str
    aliases: list[str] = field(default_factory=list)
    address: str = ""
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    reference_images: list[ReferenceImage] = field(default_factory=list)
    menu_items: list[str] = field(default_factory=list)
    visual_cues: list[str] = field(default_factory=list)
    sources: list[str] = field(default_factory=list)
    fetched_at: str = ""

    def has_geo(self) -> bool:
        return self.latitude is not None and self.longitude is not None

    def images_of(self, *kinds: str) -> list[ReferenceImage]:
        return [i for i in self.reference_images if i.kind in kinds]

    def strength(self) -> str:
        """How much this fingerprint can actually prove."""
        score = 0
        if self.has_geo():
            score += 2
        if self.images_of(KIND_STOREFRONT):
            score += 2
        if self.images_of(KIND_INTERIOR):
            score += 1
        if self.visual_cues or self.menu_items:
            score += 1
        return "strong" if score >= 4 else "partial" if score >= 2 else "weak"

    def merge(self, other: "VenueFingerprint") -> "VenueFingerprint":
        """Combine sources. Existing non-empty values win — the first provider
        asked is the most trusted one."""
        self.address = self.address or other.address
        if self.latitude is None:
            self.latitude, self.longitude = other.latitude, other.longitude
        self.reference_images += other.reference_images
        self.menu_items = self.menu_items or other.menu_items
        self.visual_cues = self.visual_cues or other.visual_cues
        self.aliases = list({*self.aliases, *other.aliases})
        self.sources = list({*self.sources, *other.sources})
        return self

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["strength"] = self.strength()
        return d


class FingerprintProvider(Protocol):
    name: str

    def available(self) -> tuple[bool, str]:
        ...

    def fetch(self, business: BusinessRecord) -> Optional[VenueFingerprint]:
        ...


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class ManualProvider:
    """Fingerprint from the business profile we already hold.

    No network, no key, available immediately — and exactly as good as what
    onboarding collected, which is the point. If this returns a `weak`
    fingerprint, that is a product gap showing up as a data gap.
    """

    name = "manual"

    def available(self) -> tuple[bool, str]:
        return True, "business profile"

    def fetch(self, business: BusinessRecord) -> Optional[VenueFingerprint]:
        return VenueFingerprint(
            business_id=business.business_id,
            name=business.name,
            aliases=list(business.aliases),
            address=business.address,
            latitude=business.latitude,
            longitude=business.longitude,
            menu_items=list(business.menu_items),
            visual_cues=list(business.visual_cues),
            sources=[self.name],
            fetched_at=_now(),
        )


class GooglePlacesProvider:
    """Coordinates, address and real photos of the venue from Google Places.

    NOTE: written against the Places API but not exercised — no key was
    available. Verify the response shapes against your account before relying
    on it in production.
    """

    name = "google_places"

    def __init__(self, api_key: Optional[str] = None, max_photos: int = 6,
                 timeout: int = 30):
        self.api_key = api_key or os.environ.get("GOOGLE_MAPS_API_KEY", "")
        self.max_photos = max_photos
        self.timeout = timeout
        self.session = requests.Session()

    def available(self) -> tuple[bool, str]:
        if not self.api_key:
            return False, "GOOGLE_MAPS_API_KEY not set"
        return True, "google places"

    def _find_place_id(self, business: BusinessRecord) -> Optional[str]:
        # Bias the search by city so "Sonny's" resolves to the right one.
        query = " ".join(x for x in (business.name, business.address or business.city) if x)
        resp = self.session.get(f"{PLACES_BASE}/findplacefromtext/json", params={
            "input": query, "inputtype": "textquery",
            "fields": "place_id", "key": self.api_key}, timeout=self.timeout)
        candidates = (resp.json() or {}).get("candidates") or []
        return candidates[0].get("place_id") if candidates else None

    def fetch(self, business: BusinessRecord) -> Optional[VenueFingerprint]:
        ok, _ = self.available()
        if not ok:
            return None
        try:
            place_id = self._find_place_id(business)
            if not place_id:
                return None
            resp = self.session.get(f"{PLACES_BASE}/details/json", params={
                "place_id": place_id,
                "fields": "name,formatted_address,geometry,photo",
                "key": self.api_key}, timeout=self.timeout)
            result = (resp.json() or {}).get("result") or {}
        except requests.RequestException:
            return None

        location = ((result.get("geometry") or {}).get("location") or {})
        images = []
        for photo in (result.get("photos") or [])[:self.max_photos]:
            ref = photo.get("photo_reference")
            if not ref:
                continue
            images.append(ReferenceImage(
                url=(f"{PLACES_BASE}/photo?maxwidth=1024&photo_reference={ref}"
                     f"&key={self.api_key}"),
                # Places does not label photo subject; the verifier weights
                # unlabelled images conservatively.
                kind=KIND_UNKNOWN, source=self.name))

        return VenueFingerprint(
            business_id=business.business_id,
            name=result.get("name") or business.name,
            address=result.get("formatted_address") or business.address,
            latitude=location.get("lat"),
            longitude=location.get("lng"),
            reference_images=images,
            sources=[self.name],
            fetched_at=_now(),
        )


class StreetViewProvider:
    """Storefront imagery at the venue's coordinates.

    The most probative reference we can get: a submitted video that shows the
    same storefront is very hard to fake, and signage is exactly what Pegasus
    is good at reading. Requires coordinates from another provider first.
    """

    name = "street_view"

    def __init__(self, api_key: Optional[str] = None, size: str = "640x640"):
        self.api_key = api_key or os.environ.get("GOOGLE_MAPS_API_KEY", "")
        self.size = size

    def available(self) -> tuple[bool, str]:
        if not self.api_key:
            return False, "GOOGLE_MAPS_API_KEY not set"
        return True, "street view"

    def fetch(self, business: BusinessRecord) -> Optional[VenueFingerprint]:
        ok, _ = self.available()
        if not ok or business.latitude is None:
            return None
        images = [ReferenceImage(
            url=(f"{STREETVIEW_BASE}?size={self.size}"
                 f"&location={business.latitude},{business.longitude}"
                 f"&fov=80&pitch=0&heading={heading}&key={self.api_key}"),
            kind=KIND_STOREFRONT, source=self.name)
            for heading in (0, 90, 180, 270)]
        return VenueFingerprint(
            business_id=business.business_id, name=business.name,
            latitude=business.latitude, longitude=business.longitude,
            reference_images=images, sources=[self.name], fetched_at=_now())


def build_fingerprint(business: BusinessRecord,
                      providers: Optional[list[FingerprintProvider]] = None
                      ) -> VenueFingerprint:
    """Assemble a fingerprint from every available provider.

    Order matters: the manual profile is asked first because a business
    telling us its own coordinates beats a fuzzy name search on Places.
    """
    providers = providers or [ManualProvider(), GooglePlacesProvider(),
                              StreetViewProvider()]
    combined: Optional[VenueFingerprint] = None
    for provider in providers:
        ok, _ = provider.available()
        if not ok:
            continue
        try:
            fp = provider.fetch(business)
        except Exception:
            continue
        if fp is None:
            continue
        combined = fp if combined is None else combined.merge(fp)
    return combined or VenueFingerprint(business_id=business.business_id,
                                        name=business.name, fetched_at=_now())
