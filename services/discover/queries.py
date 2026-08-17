"""Query generation for the three Discover jobs.

Discover is not one scraper — it is three questions asked of the same sources:

  1. business  — "what is being posted about *this* partner right now?"
  2. trend     — "what cafe/restaurant formats are working right now?"
  3. category  — "what does the competitive landscape around this business
                 look like?"

Each returns SourceQuery objects; the harvester does not care which job it is
running.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

from .formats import FORMAT_ARCHETYPES
from .models import INTENT_BUSINESS, INTENT_CATEGORY, INTENT_TREND, SourceQuery


@dataclass
class BusinessTarget:
    """What Discover needs to know about a business to go looking for it.

    Maps onto the `businesses` table plus the profile fields business
    onboarding should be collecting (see screening.py's BusinessProfile —
    same data, and we should converge these on one record).
    """

    name: str
    business_id: Optional[str] = None
    city: str = ""
    cuisine: str = ""            # "Korean cafe", "ramen", "third-wave coffee"
    handles: dict[str, str] = field(default_factory=dict)  # platform -> @handle
    competitors: list[str] = field(default_factory=list)

    def tags(self) -> dict[str, str]:
        return {k: v for k, v in
                {"city": self.city, "cuisine": self.cuisine, "business": self.name}.items() if v}


def _fill(template: str, city: str, cuisine: str, business: str) -> Optional[str]:
    """Render a template, dropping it if a placeholder it needs is empty."""
    values = {"city": city, "cuisine": cuisine, "business": business}
    for key, value in values.items():
        if "{" + key + "}" in template and not value:
            return None
    return " ".join(template.format(**values).split())


def business_queries(target: BusinessTarget, platforms: list[str],
                     limit: int = 25) -> list[SourceQuery]:
    """Job 1: content about this specific business.

    Deliberately noisy — recall matters more than precision here, because
    TwelveLabs venue verification is the precision stage. A video we never
    find is a video the business never sees.
    """
    name, city = target.name, target.city
    texts = [
        f'"{name}" {city}'.strip(),
        f"{name} {city} review".strip(),
        f"{name} {target.cuisine}".strip() if target.cuisine else None,
        f"{name} vlog",
        f"what to order at {name}",
    ]
    handle_texts = [h.lstrip("@") for h in target.handles.values() if h]
    texts.extend(handle_texts)

    out = []
    for platform in platforms:
        for text in texts:
            if not text:
                continue
            out.append(SourceQuery(
                text=text, intent=INTENT_BUSINESS, platform=platform,
                business_id=target.business_id, limit=limit, tags=target.tags()))
    return _dedupe(out)


def trend_queries(city: str = "", cuisine: str = "", platforms: Optional[list[str]] = None,
                  limit: int = 25, archetypes: Optional[list[str]] = None
                  ) -> list[SourceQuery]:
    """Job 2: trending UGC formats in the category.

    One query per archetype template so the harvest returns a *balanced*
    corpus — every format gets sampled, instead of whatever one broad search
    happened to favor. That balance is what makes the ROI comparison honest.
    """
    platforms = platforms or ["youtube"]
    names = archetypes or list(FORMAT_ARCHETYPES)
    tags = {k: v for k, v in {"city": city, "cuisine": cuisine}.items() if v}

    out = []
    for platform in platforms:
        for archetype in names:
            spec = FORMAT_ARCHETYPES.get(archetype)
            if not spec:
                continue
            for template in spec["templates"]:
                # Templates without a {city} slot search globally, which returns
                # worldwide ASMR channels and brand content instead of local
                # customer UGC. If we have a city, every query gets localized.
                if city and "{city}" not in template:
                    template = f"{template} {{city}}"
                text = _fill(template, city, cuisine, "")
                if not text:
                    continue
                out.append(SourceQuery(
                    text=text, intent=INTENT_TREND, platform=platform,
                    limit=limit, tags={**tags, "archetype": archetype}))
    return _dedupe(out)


def creator_queries(handles: list[str], platforms: Optional[list[str]] = None,
                    limit: int = 30, tags: Optional[dict[str, str]] = None
                    ) -> list[SourceQuery]:
    """Harvest known food/cafe creators' short-form tabs directly.

    Highest-yield source we have on YouTube. Keyword search returns a few
    usable Shorts per hundred results; a creator's Shorts tab is *entirely*
    vertical short-form by construction. Seed this with creators the trend
    harvest surfaced, and it compounds — the corpus finds its own suppliers.
    """
    platforms = platforms or ["youtube"]
    out = []
    for platform in platforms:
        for handle in handles:
            handle = handle.strip()
            if not handle:
                continue
            out.append(SourceQuery(
                text=handle, intent=INTENT_TREND, platform=platform,
                limit=limit, tags={**(tags or {}), "source": "creator"}))
    return _dedupe(out)


def category_queries(target: BusinessTarget, platforms: Optional[list[str]] = None,
                     limit: int = 25) -> list[SourceQuery]:
    """Job 3: the competitive landscape — named competitors plus the
    category-level searches a customer in this city would actually run."""
    platforms = platforms or ["youtube"]
    texts = [f"{c} {target.city}".strip() for c in target.competitors]
    if target.cuisine and target.city:
        texts += [
            f"best {target.cuisine} in {target.city}",
            f"{target.cuisine} {target.city} review",
        ]

    out = []
    for platform in platforms:
        for text in texts:
            out.append(SourceQuery(
                text=text, intent=INTENT_CATEGORY, platform=platform,
                business_id=target.business_id, limit=limit, tags=target.tags()))
    return _dedupe(out)


def _dedupe(queries: list[SourceQuery]) -> list[SourceQuery]:
    seen, out = set(), []
    for q in queries:
        if q.key() not in seen:
            seen.add(q.key())
            out.append(q)
    return out
