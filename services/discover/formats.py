"""Cafe/restaurant UGC format archetypes.

The unit Divvit actually sells is not "a video" — it is a *format* that reliably
performs. These archetypes are the vocabulary shared by three parts of Discover:

  1. queries.py  — generates searches designed to surface each archetype
  2. roi.py      — groups harvested videos by archetype to compute per-format
                   performance, which is what "projected ROI" is projecting
  3. Create      — the brief handed to a user is a format, not a script

Classification is keyword-based on title/description/hashtags. That is crude and
intentionally so: it runs free over the whole corpus. TwelveLabs screening gives
us a second, far better signal (`content_type` from actual video understanding),
and `classify()` prefers it whenever a video has been screened.
"""

from __future__ import annotations

from typing import Any, Optional

from .models import DiscoveredVideo

# archetype -> (matching keywords, query templates)
# Templates use {city} / {cuisine} / {business}; unfilled ones are skipped.
FORMAT_ARCHETYPES: dict[str, dict[str, Any]] = {
    "cafe_vlog": {
        "label": "Cafe visit vlog",
        "keywords": ["vlog", "day in my life", "come with me", "cafe hopping",
                     "coffee run", "morning routine", "spend the day", "grwm"],
        "templates": ["cafe hopping {city}", "come with me to a cafe {city}",
                      "pov cafe {city}", "cafe run {city}"],
        "brief": "Film your visit start to finish — walk in, order, first bite.",
    },
    "menu_review": {
        "label": "Menu item review / taste test",
        "keywords": ["review", "taste test", "trying", "tried", "what to order",
                     "ordering", "menu", "honest review", "rating"],
        "templates": ["{cuisine} review {city}", "what to order at {business}",
                      "trying viral cafe {city}", "cafe review {city}",
                      "honest review coffee {city}"],
        "brief": "Order 2-3 items, react honestly to each, name your favorite.",
    },
    "hidden_gem": {
        "label": "Hidden gem / must-try",
        "keywords": ["hidden gem", "you need to try", "must try", "underrated",
                     "best kept secret", "nobody knows", "slept on"],
        "templates": ["hidden gem cafe {city}", "underrated restaurants {city}",
                      "you need to try this {city}"],
        "brief": "Frame the place as a discovery — why nobody knows about it yet.",
    },
    "ranking_list": {
        "label": "Ranking / top list",
        "keywords": ["best", "top 5", "top 10", "ranked", "ranking", "tier list",
                     "vs", "better than"],
        "templates": ["best cafes in {city}", "best {cuisine} in {city}",
                      "cafe tier list {city}", "ranking cafes in {city}"],
        "brief": "Rank 3-5 spots, put the winner last to hold the watch time.",
    },
    "aesthetic": {
        "label": "Aesthetic / ambience b-roll",
        "keywords": ["aesthetic", "asmr", "cinematic", "cozy", "ambience",
                     "ambiance", "vibes", "pov", "interior"],
        "templates": ["aesthetic cafe {city}", "cozy coffee shop {city}",
                      "cafe asmr", "study cafe {city}"],
        "brief": "No talking — interior, light, textures, sound of the espresso machine.",
    },
    "behind_counter": {
        "label": "Behind the counter / craft",
        "keywords": ["barista", "latte art", "how it's made", "how its made",
                     "behind the scenes", "making", "roasting", "recipe"],
        "templates": ["barista latte art {city}", "how its made cafe",
                      "behind the scenes coffee shop"],
        "brief": "Show the craft — the pour, the plate, the person making it.",
    },
    "value_deal": {
        "label": "Value / price check",
        "keywords": ["cheap", "budget", "worth it", "affordable", "price",
                     "how much", "under $", "value"],
        "templates": ["cheap eats {city}", "is it worth it {cuisine} {city}",
                      "budget food {city}"],
        "brief": "Lead with the price, end with the verdict on whether it's worth it.",
    },
}

# TwelveLabs screening `content_type` -> archetype. Screening sees the actual
# video, so when it has run its answer wins over keyword guessing.
SCREENING_TYPE_MAP = {
    "review": "menu_review",
    "vlog": "cafe_vlog",
    "interior": "aesthetic",
    "menu_item": "menu_review",
    "event": "cafe_vlog",
}

UNCLASSIFIED = "unclassified"


def classify(video: DiscoveredVideo) -> str:
    """Best available archetype for a video.

    Screening verdict first (it watched the video), keywords as the free
    fallback for the ~99% of the corpus we will never pay to index.
    """
    screening = video.screening or {}
    analysis = screening.get("analysis") or {}
    content_type = analysis.get("content_type")
    if content_type in SCREENING_TYPE_MAP and analysis.get("content_type_confidence") != "low":
        return SCREENING_TYPE_MAP[content_type]

    haystack = " ".join([
        video.title or "", video.description or "", " ".join(video.hashtags or []),
    ]).lower()

    best, best_score = UNCLASSIFIED, 0
    for name, spec in FORMAT_ARCHETYPES.items():
        score = sum(1 for kw in spec["keywords"] if kw in haystack)
        if score > best_score:
            best, best_score = name, score
    return best


def label(archetype: str) -> str:
    return FORMAT_ARCHETYPES.get(archetype, {}).get("label", archetype)


def brief(archetype: str) -> Optional[str]:
    """The instruction a business would hand a creator for this format.
    Feeds Campaigns and Create."""
    return FORMAT_ARCHETYPES.get(archetype, {}).get("brief")
