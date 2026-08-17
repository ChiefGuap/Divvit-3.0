"""The five video categories Divvit screens for.

This is the shared vocabulary between screening, Discover and Create. It is
deliberately about *what kind of video this is*, not *what is in the frame* —
two videos can both show a latte and belong to different categories depending
on whether someone is reviewing it, filming ambience, or showing the pour.

Why five, and why these five: each one is used differently downstream.

    review      -> the persuasion. Someone vouches for the place on camera.
    montage     -> the reach. Fast multi-shot cuts travel furthest.
    aesthetic   -> the b-roll. No narrative, pure texture; fills gaps.
    venue_vibe  -> the establishing shot. Proves the room is worth visiting.
    menu_item   -> the product. A specific dish or drink, close up.

Create's recipes draw from these buckets by role, so a mislabel is not a
cosmetic problem — it puts b-roll where a payoff should be.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

REVIEW = "review"
MONTAGE = "montage"
AESTHETIC = "aesthetic"
VENUE_VIBE = "venue_vibe"
MENU_ITEM = "menu_item"
UNCLASSIFIED = "unclassified"

CATEGORIES = (REVIEW, MONTAGE, AESTHETIC, VENUE_VIBE, MENU_ITEM)


@dataclass(frozen=True)
class Category:
    key: str
    label: str
    definition: str          # goes into the model prompt verbatim
    distinguisher: str       # how to tell it from its nearest neighbour
    create_role: str         # what Create uses it for


TAXONOMY: dict[str, Category] = {
    REVIEW: Category(
        key=REVIEW,
        label="Review",
        definition=(
            "A person speaks about the place or the food — rating it, reacting "
            "to it, recommending it. Their voice or their face carries the video."
        ),
        distinguisher=(
            "If nobody is giving an opinion out loud or to camera, it is not a "
            "review, however much food is on screen."
        ),
        create_role="payoff — the moment that persuades",
    ),
    MONTAGE: Category(
        key=MONTAGE,
        label="Montage",
        definition=(
            "Many short shots cut quickly together, often several dishes, "
            "several venues, or a ranked list. The structure is the point."
        ),
        distinguisher=(
            "Distinguished from a review by pace and breadth: a montage moves "
            "on every second or two and rarely dwells on one subject."
        ),
        create_role="body — carries the middle of a cut",
    ),
    AESTHETIC: Category(
        key=AESTHETIC,
        label="Aesthetic / background",
        definition=(
            "Deliberately no narrative: light, texture, steam, sound. Nobody "
            "talks. Often ASMR or slow-motion. Could be almost anywhere."
        ),
        distinguisher=(
            "Distinguished from venue vibe by intent — aesthetic footage is "
            "about the texture, not about proving what this specific place is like."
        ),
        create_role="b-roll — fills gaps, sets tone",
    ),
    VENUE_VIBE: Category(
        key=VENUE_VIBE,
        label="Venue vibe",
        definition=(
            "The room and its atmosphere: the space, the seating, the crowd, "
            "how busy or calm it feels. Shows what being there is like."
        ),
        distinguisher=(
            "Distinguished from aesthetic footage because it is legible as "
            "THIS venue — the layout, the signage, the people in it."
        ),
        create_role="hook — establishes the place",
    ),
    MENU_ITEM: Category(
        key=MENU_ITEM,
        label="Menu item",
        definition=(
            "One specific dish or drink, held in frame long enough to be the "
            "subject. Plating, pouring, a close-up of the food itself."
        ),
        distinguisher=(
            "Distinguished from a montage because it stays on one item, and "
            "from a review because nobody is judging it out loud."
        ),
        create_role="body — the product shot",
    ),
}

# The screening model's original content_type vocabulary predates this
# taxonomy. Mapping it lets every already-screened video be relabelled for
# free instead of paying to re-index it.
#
# `vlog` is deliberately absent: a vlog can be a review, a montage or a venue
# tour depending on how it is shot, so it has to be re-classified rather than
# mapped. `event` maps to venue_vibe because event footage is almost always
# about the room being full.
LEGACY_CONTENT_TYPE_MAP: dict[str, str] = {
    "review": REVIEW,
    "menu_item": MENU_ITEM,
    "interior": VENUE_VIBE,
    "event": VENUE_VIBE,
}

AMBIGUOUS_LEGACY_TYPES = frozenset({"vlog", "other"})

# Discover's keyword archetypes -> categories, for the cheap pre-screen pass.
ARCHETYPE_MAP: dict[str, str] = {
    "menu_review": REVIEW,
    "cafe_vlog": VENUE_VIBE,
    "ranking_list": MONTAGE,
    "aesthetic": AESTHETIC,
    "behind_counter": MENU_ITEM,
    "hidden_gem": REVIEW,
    "value_deal": REVIEW,
}


def label(key: str) -> str:
    cat = TAXONOMY.get(key)
    return cat.label if cat else "Unclassified"


def create_role(key: str) -> Optional[str]:
    cat = TAXONOMY.get(key)
    return cat.create_role if cat else None


def from_legacy(content_type: Optional[str]) -> Optional[str]:
    """Relabel an already-screened video, or None when it needs a fresh look."""
    if not content_type or content_type in AMBIGUOUS_LEGACY_TYPES:
        return None
    return LEGACY_CONTENT_TYPE_MAP.get(content_type)


def prompt_block() -> str:
    """The category definitions, formatted for the classifier prompt.

    Generated rather than hand-written so the prompt can never drift from the
    taxonomy the rest of the code enforces.
    """
    lines = []
    for i, key in enumerate(CATEGORIES, 1):
        c = TAXONOMY[key]
        lines.append(f'{i}. "{c.key}" — {c.definition} {c.distinguisher}')
    return "\n".join(lines)
