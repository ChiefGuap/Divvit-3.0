"""Video recipes — the bridge from Discover's data to an editable plan.

A recipe is an ordered list of *slots*. Each slot says what kind of footage it
needs (the same `content_type` labels screening already assigns to Collection
videos), what job it does in the edit (hook / body / payoff), how long it runs,
and what to search for when picking the exact moment out of a clip.

The recipe for a business is chosen from Discover's format ranking: the
archetype with the best format score in the current corpus becomes the shape of
the video Create assembles. That is the whole point — we copy what is measured
to work, not what a template author guessed.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Optional

# Roles a slot can play. Order in the recipe is the edit order.
HOOK = "hook"        # first 1-3s; decides whether anyone keeps watching
BODY = "body"        # the substance
PAYOFF = "payoff"    # the verdict/reaction that rewards watching to the end


@dataclass
class Slot:
    role: str
    # content_type labels this slot accepts, in preference order. These are
    # screening's labels — the Collection is already tagged with them.
    accepts: list[str]
    # What to ask TwelveLabs for when choosing the moment inside the clip.
    moment_query: str
    min_seconds: float = 1.5
    max_seconds: float = 6.0
    # Optional on-screen text template; {business} is filled at build time.
    overlay: Optional[str] = None


@dataclass
class CaptionStyle:
    """How burned-in text should look, derived from what the market actually does.

    Parsed from the free-text description TwelveLabs returns
    ("Large white text with black outline, centered at the bottom of the
    screen") into the handful of numbers ffmpeg's drawtext needs.
    """

    fontsize: int = 64
    color: str = "white"
    border_width: int = 4
    border_color: str = "black@0.7"
    y_fraction: float = 0.78   # 0 = top, 1 = bottom
    source: str = "default"

    @classmethod
    def from_description(cls, description: str) -> "CaptionStyle":
        d = (description or "").lower()
        if not d:
            return cls()
        style = cls(source=description[:120])

        if "large" in d or "big" in d or "bold" in d:
            style.fontsize = 76
        elif "small" in d:
            style.fontsize = 48

        # Text colour and outline colour must be parsed separately. A naive
        # keyword scan over "white text with black outline" finds "black"
        # first and renders black-on-black — invisible captions.
        colours = "white|black|yellow|red|pink|green|blue|orange"
        text_match = re.search(rf"\b({colours})\b(?=[^.]*?\btext\b)", d) \
            or re.search(rf"\btext\b[^.]*?\b({colours})\b", d)
        if text_match:
            style.color = text_match.group(1)
        outline_match = re.search(rf"\b({colours})\b(?=\s*(?:outline|border|stroke))", d)
        if outline_match:
            style.border_color = f"{outline_match.group(1)}@0.7"
        # Never let the text and its outline end up the same colour.
        if style.border_color.split("@")[0] == style.color:
            style.border_color = "black@0.7" if style.color != "black" else "white@0.7"

        if "no outline" in d or "without outline" in d:
            style.border_width = 0
        elif "shadow" in d:
            style.border_width = 2
        if "background" in d or "box" in d:
            # A solid caption box reads as a heavier border at this fidelity.
            style.border_width = max(style.border_width, 6)

        if "top" in d:
            style.y_fraction = 0.12
        elif "middle" in d or "center of the screen" in d:
            style.y_fraction = 0.45
        elif "bottom" in d:
            style.y_fraction = 0.78
        return style


@dataclass
class Recipe:
    archetype: str
    label: str
    slots: list[Slot]
    caption_style: CaptionStyle = field(default_factory=CaptionStyle)
    target_seconds: float = 30.0
    music_hint: str = ""  # descriptive, for when we add licensed music
    # Set when the recipe was derived from observed data rather than hardcoded.
    # Carries the evidence so the dashboard can show *why* the video looks the
    # way it does.
    derived_from: Optional[dict] = None

    def total_max(self) -> float:
        return sum(s.max_seconds for s in self.slots)

    @property
    def is_learned(self) -> bool:
        return self.derived_from is not None


# Recipes keyed by Discover archetype. Slots deliberately over-ask on accepts:
# a menu_review edit can fall back to vlog footage, because a missing slot
# kills the whole build while an imperfect clip just weakens it.
RECIPES: dict[str, Recipe] = {
    "menu_review": Recipe(
        archetype="menu_review",
        label="Menu item review",
        target_seconds=25,
        slots=[
            Slot(HOOK, ["menu_item", "review"],
                 "close up of delicious food, most appetizing shot",
                 1.5, 3.0, overlay="you need to try this"),
            Slot(BODY, ["menu_item", "vlog", "review"],
                 "food being prepared or served or shown to camera", 3.0, 6.0),
            Slot(BODY, ["review", "menu_item", "vlog"],
                 "person tasting food for the first time", 3.0, 6.0),
            Slot(PAYOFF, ["review", "vlog"],
                 "person reacting positively and giving a verdict about the food",
                 2.5, 6.0, overlay="{business}"),
        ],
    ),
    "cafe_vlog": Recipe(
        archetype="cafe_vlog",
        label="Cafe visit vlog",
        target_seconds=30,
        slots=[
            Slot(HOOK, ["interior", "vlog"],
                 "walking into a cafe entrance, storefront or door",
                 1.5, 3.0, overlay="come with me to {business}"),
            Slot(BODY, ["interior", "vlog"],
                 "cafe interior ambience, seating, decor", 2.5, 5.0),
            Slot(BODY, ["menu_item", "vlog"],
                 "ordering or receiving food and drinks at the counter", 3.0, 6.0),
            Slot(BODY, ["menu_item", "review", "vlog"],
                 "close up of food and drinks on the table", 2.5, 5.0),
            Slot(PAYOFF, ["review", "vlog"],
                 "person smiling, enjoying, or recommending the experience",
                 2.5, 6.0, overlay="{business}"),
        ],
    ),
    "aesthetic": Recipe(
        archetype="aesthetic",
        label="Aesthetic / ambience",
        target_seconds=20,
        music_hint="lofi / ambient, no voiceover",
        slots=[
            Slot(HOOK, ["interior", "menu_item"],
                 "most beautiful cinematic shot, steam, pour, or light",
                 1.5, 3.0),
            Slot(BODY, ["interior"],
                 "cozy cafe interior, warm light, textures", 3.0, 6.0),
            Slot(BODY, ["menu_item", "interior"],
                 "latte art being poured or drink close up", 3.0, 6.0),
            Slot(PAYOFF, ["interior", "menu_item"],
                 "wide satisfying shot of the space or finished drink",
                 2.5, 5.0, overlay="{business}"),
        ],
    ),
    "hidden_gem": Recipe(
        archetype="hidden_gem",
        label="Hidden gem",
        target_seconds=25,
        slots=[
            Slot(HOOK, ["interior", "vlog"],
                 "unassuming storefront or entrance from outside",
                 1.5, 3.0, overlay="nobody knows about this place"),
            Slot(BODY, ["interior", "vlog"],
                 "revealing the interior of the cafe", 2.5, 5.0),
            Slot(BODY, ["menu_item", "review"],
                 "the best looking food or drink close up", 3.0, 6.0),
            Slot(PAYOFF, ["review", "vlog"],
                 "person impressed or amazed by the food",
                 2.5, 6.0, overlay="{business} — go before everyone finds out"),
        ],
    ),
}

# Fallback when Discover has no confident winner: menu_review is the safest
# performer for food businesses and needs the least footage variety.
DEFAULT_ARCHETYPE = "menu_review"


def recipe_for(archetype: str) -> Recipe:
    return RECIPES.get(archetype) or RECIPES[DEFAULT_ARCHETYPE]


def _mentions_other_entity(rendered: str, fill: dict) -> bool:
    """Guard against a learned hook naming someone else's city or cuisine.

    Putting "TOP 5 INDIAN RESTAURANTS IN LONDON" on a San Diego Korean cafe's
    video is worse than shipping no hook — it is confidently wrong, on screen,
    on the business's own account.
    """
    import re as _re
    own = {str(v).lower() for v in fill.values()}
    own_words = {w for value in own for w in _re.findall(r"[a-z]+", value)}
    for word in _re.findall(r"[A-Za-z][A-Za-z'’]+", rendered):
        if len(word) <= 2 or not word[0].isupper():
            continue
        if word.lower() in own_words:
            continue
        if word.upper() in {"TOP", "BEST", "NEW", "POV", "TRYING", "TRIED",
                            "MUST", "TRY", "I", "THE", "IN", "AT", "OF",
                            "THIS", "YOU", "YOUR", "MY", "WE", "HIDDEN",
                            "GEM", "WORTH", "FOOD", "SPOT", "SPOTS"}:
            continue
        return True
    return False


def recipe_from_profile(profile, base: Optional[Recipe] = None,
                        city: str = "", cuisine: str = "") -> Recipe:
    """Build a recipe from an observed StyleProfile.

    This is the point of the whole Discover pipeline. The hardcoded recipes
    above are scaffolding — shot *intent* per slot, which is genuinely editorial
    knowledge. Everything measurable comes from the corpus instead of from me:

      * **slot count** from the median cut count, so the edit has the same
        rhythm density as real videos in the format
      * **slot duration** from the median shot length actually measured with
        ffmpeg, not a guess
      * **hook overlay text** from real harvested hooks, templatized so we reuse
        the genre convention ("TOP 5 {cuisine} ..." ) rather than anyone's exact
        caption
      * **target length** from the median duration of the format
      * **music hint** from the dominant observed audio treatment

    Falls back to the base recipe's values wherever the profile is thin, so a
    low-confidence profile degrades to the scaffold rather than producing a
    two-second video from one bad sample.
    """
    base = base or recipe_for(getattr(profile, "archetype", "") or "")
    fill = {"city": city or "your city", "cuisine": cuisine or "food",
            "business": "{business}"}

    # How many slots: one per cut, clamped to something an editor would ship
    # and to what the scaffold can describe.
    cuts = getattr(profile, "median_cuts", None)
    slot_count = len(base.slots)
    if cuts:
        slot_count = max(3, min(int(round(cuts)), 6))

    shot_seconds = getattr(profile, "median_shot_seconds", None)
    target = getattr(profile, "median_duration_seconds", None) or base.target_seconds

    # Real hooks, templatized. Refill the placeholders we can.
    hooks = list(getattr(profile, "hook_templates", []) or [])
    hook_overlay = None
    for candidate in hooks:
        try:
            rendered = candidate.format(**fill)
        except (KeyError, IndexError, ValueError):
            continue
        rendered = " ".join(rendered.split())
        # Profiles already reject templates with stray proper nouns, but the
        # rendered string is what actually appears on screen — check it too
        # rather than trusting the upstream filter blindly.
        if 3 <= len(rendered) <= 60 and not _mentions_other_entity(rendered, fill):
            hook_overlay = rendered
            break

    # Grow or trim the scaffold's slots to the observed count. Repeats come
    # from the body, never the hook or payoff — those are structural.
    slots = list(base.slots)
    body = [s for s in slots if s.role == BODY] or slots[1:2]
    while len(slots) < slot_count and body:
        insert_at = max(1, len(slots) - 1)
        slots.insert(insert_at, body[len(slots) % len(body)])
    slots = slots[:slot_count]

    new_slots: list[Slot] = []
    for i, slot in enumerate(slots):
        min_s, max_s = slot.min_seconds, slot.max_seconds
        if shot_seconds:
            # Center the slot's window on the observed shot length, keeping a
            # little latitude either side for the moment finder.
            min_s = max(1.0, round(shot_seconds * 0.7, 2))
            max_s = max(min_s + 0.5, round(shot_seconds * 1.6, 2))
        overlay = slot.overlay
        if i == 0 and hook_overlay:
            overlay = hook_overlay
        new_slots.append(Slot(role=slot.role, accepts=list(slot.accepts),
                              moment_query=slot.moment_query,
                              min_seconds=min_s, max_seconds=max_s,
                              overlay=overlay))

    audio = getattr(profile, "dominant_audio_style", "") or ""
    energy = getattr(profile, "dominant_music_energy", "") or ""
    genres = getattr(profile, "music_genre_hints", []) or []
    music_hint = base.music_hint
    if audio:
        music_hint = f"{audio}"
        if genres and genres[0].lower() not in ("n/a", "none", ""):
            music_hint += f", {genres[0]}"
        if energy and energy != "none":
            music_hint += f", {energy} energy"

    caption_desc = getattr(profile, "common_caption_style", "") or ""
    return Recipe(
        archetype=base.archetype,
        label=base.label,
        slots=new_slots,
        caption_style=CaptionStyle.from_description(caption_desc),
        target_seconds=round(float(target), 1),
        music_hint=music_hint,
        derived_from={
            "sample_size": getattr(profile, "sample_size", 0),
            "confidence": getattr(profile, "confidence", "low"),
            "median_cuts": cuts,
            "median_shot_seconds": shot_seconds,
            "median_duration_seconds": getattr(profile, "median_duration_seconds", None),
            "caption_style": getattr(profile, "common_caption_style", ""),
            "audio_style": audio,
            "narration": getattr(profile, "dominant_narration", ""),
            "hook_source": hook_overlay,
            "tone": list(getattr(profile, "tone_words", []) or [])[:5],
        },
    )


def pick_archetype_from_discover(format_ranking: list) -> str:
    """Choose the recipe from Discover's ROI table (rank_formats output).

    Takes the best-scoring archetype we actually have a recipe for, skipping
    'unclassified'. Falls back to the default rather than failing — a business
    should always be able to build *something*.
    """
    for stats, _projection in format_ranking:
        if stats.archetype in RECIPES:
            return stats.archetype
    return DEFAULT_ARCHETYPE
