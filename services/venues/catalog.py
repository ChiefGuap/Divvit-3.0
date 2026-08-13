"""The business catalog venue resolution matches against.

Screening tells us what a video *says* — "CALDROWN ICE CREAM" read off a sign.
This is the other half: the set of businesses that string could refer to, with
the extra fields that make a match defensible rather than a guess.

Backed by JSON today so Discover and the screening bridge can run without a
database. The field set is deliberately the shape the `businesses` Postgres
table should grow into (see the migration alongside this module), so moving to
Supabase is a loader swap, not a rewrite.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Any, Iterable, Optional


@dataclass
class BusinessRecord:
    """One business, as venue resolution needs to see it."""

    business_id: str
    name: str
    city: str = ""
    # Everything the venue actually gets called. A sign reading "CAULDRON",
    # a cup reading "The Cauldron Ice Cream", and a customer saying "Cauldron"
    # are all the same business; matching only the legal name misses two.
    aliases: list[str] = field(default_factory=list)
    cuisine: str = ""
    menu_items: list[str] = field(default_factory=list)
    # Free-text distinctive identifiers: logo, cup design, interior notes.
    # Feeds both matching and the screening prompt.
    visual_cues: list[str] = field(default_factory=list)
    address: str = ""
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    # Partner businesses get priority on ambiguous matches — a paying customer
    # is a likelier subject than a venue we only know about in passing.
    is_partner: bool = False

    def all_names(self) -> list[str]:
        return [n for n in ([self.name] + list(self.aliases)) if n]

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "BusinessRecord":
        known = set(cls.__dataclass_fields__)
        return cls(**{k: v for k, v in d.items() if k in known})


class BusinessCatalog:
    def __init__(self, records: Iterable[BusinessRecord] = ()):
        self.records: list[BusinessRecord] = list(records)

    def __len__(self) -> int:
        return len(self.records)

    def add(self, record: BusinessRecord) -> None:
        self.records.append(record)

    def get(self, business_id: str) -> Optional[BusinessRecord]:
        return next((r for r in self.records if r.business_id == business_id), None)

    def in_city(self, city: str) -> list[BusinessRecord]:
        """Narrow to a city when we know it — the strongest cheap prior.

        Two unrelated cafes on opposite coasts can share a name; the one in the
        submitting user's city is almost always the right answer.
        """
        if not city:
            return list(self.records)
        needle = city.strip().lower()
        return [r for r in self.records if needle in (r.city or "").lower()]

    # ------------------------------------------------------------- loading
    @classmethod
    def from_json(cls, path: Path | str) -> "BusinessCatalog":
        data = json.loads(Path(path).read_text())
        rows = data.get("businesses") if isinstance(data, dict) else data
        return cls(BusinessRecord.from_dict(r) for r in (rows or []))

    def to_json(self, path: Path | str) -> Path:
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(
            {"businesses": [r.to_dict() for r in self.records]}, indent=2))
        return path

    @classmethod
    def from_supabase_rows(cls, rows: Iterable[dict[str, Any]]) -> "BusinessCatalog":
        """Build from `businesses` table rows. Tolerates the columns being
        absent so this works before the enrichment migration is applied."""
        out = []
        for r in rows:
            out.append(BusinessRecord(
                business_id=str(r.get("id") or r.get("business_id") or ""),
                name=r.get("name") or "",
                city=r.get("city") or "",
                aliases=list(r.get("aliases") or []),
                cuisine=r.get("cuisine") or "",
                menu_items=list(r.get("menu_items") or []),
                visual_cues=list(r.get("visual_cues") or []),
                address=r.get("address") or "",
                latitude=r.get("latitude"),
                longitude=r.get("longitude"),
                is_partner=bool(r.get("is_partner")),
            ))
        return cls(out)
