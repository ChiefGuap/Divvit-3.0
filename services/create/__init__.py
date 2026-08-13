"""Divvit Create — the editing AI.

Collection clips (labeled by screening) + Discover's format data ->
one packaged vertical video a business can post.

    recipes.py   what shape the video takes (driven by Discover's ROI ranking)
    library.py   which clips may be used at all (rights-gated)
    moments.py   which seconds of each clip to use (TwelveLabs search)
    assemble.py  the cut itself (ffmpeg, plan-then-render)
    publish.py   Instagram Reels via Graph API (dry-run by default)

Entry point: `python -m services.create.cli --help`
"""

from .recipes import RECIPES, Recipe, Slot, recipe_for, pick_archetype_from_discover
from .library import Clip, ClipLibrary
from .moments import Moment, MomentFinder
from .assemble import AssemblyError, EditPlan, plan_edit, render, write_plan

__all__ = [
    "RECIPES", "Recipe", "Slot", "recipe_for", "pick_archetype_from_discover",
    "Clip", "ClipLibrary", "Moment", "MomentFinder",
    "AssemblyError", "EditPlan", "plan_edit", "render", "write_plan",
]
