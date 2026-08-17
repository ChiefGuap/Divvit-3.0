"""The clip library Create is allowed to cut from.

Create only ever edits footage the business has rights to. That is the entire
legal basis of the product: the Collection's approval flow (user submits →
business accepts → Legal Ownership transfers) is what turns a customer's video
into usable raw material. Nothing from Discover's harvested corpus can appear
in an output video — those are other people's posts we measured, not footage
we own. The library enforces that at the only chokepoint that matters: what
clips exist at all as far as the assembler is concerned.

Sources:
  * `from_submissions()` — production path, reads the Supabase `submissions`
    table (status = accepted) once the app is live.
  * `from_screening_results()` — today's path: clips screened by our own
    pipeline with rights we explicitly assert (e.g. footage we filmed, or a
    partner's own videos they handed us).
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

USABLE_RIGHTS = {"creator_licensed", "owned"}


@dataclass
class Clip:
    """One rights-cleared video the assembler may cut from."""

    clip_id: str
    local_path: Path
    content_type: str                 # screening's label: review/vlog/interior/...
    duration_seconds: Optional[float] = None
    rights_status: str = "owned"
    twelvelabs_video_id: Optional[str] = None  # set -> moment search available
    detected_items: list[str] = field(default_factory=list)
    summary: str = ""
    # True when the footage already has captions burned into the pixels.
    # Adding ours on top produces two stacked subtitle tracks — the most
    # obvious "made by a bot" artifact there is. Raw phone footage from the
    # Collection is almost never pre-captioned; harvested UGC usually is.
    has_burned_captions: bool = False

    def usable(self) -> tuple[bool, str]:
        if self.rights_status not in USABLE_RIGHTS:
            return False, f"rights_status={self.rights_status}"
        if not self.local_path.exists():
            return False, f"file missing: {self.local_path}"
        return True, ""


class ClipLibrary:
    def __init__(self, clips: list[Clip], allow_internal_eval: bool = False):
        """`allow_internal_eval=True` admits `internal_eval` clips so the
        editing pipeline can be tested on harvested footage. Any library built
        this way is poisoned for publishing: `publishable` goes False and the
        CLI refuses to hand its output to the publisher. The flag exists so
        model testing and rights enforcement don't have to fight each other.
        """
        self.publishable = not allow_internal_eval
        usable_rights = USABLE_RIGHTS | ({"internal_eval"} if allow_internal_eval
                                         else set())

        def check(c: Clip) -> tuple[bool, str]:
            if c.rights_status not in usable_rights:
                return False, f"rights_status={c.rights_status}"
            if not c.local_path.exists():
                return False, f"file missing: {c.local_path}"
            return True, ""

        for clip in clips:
            ok, why = check(clip)
            if not ok:
                # Loud, because a clip silently dropped here becomes "why is my
                # video missing the interior shot" three layers up.
                print(f"[library] excluded {clip.clip_id}: {why}")
        self.clips = [c for c in clips if check(c)[0]]
        if allow_internal_eval:
            print("[library] INTERNAL EVAL MODE — output must not be published")

    def __len__(self) -> int:
        return len(self.clips)

    def by_type(self, accepts: list[str]) -> list[Clip]:
        """Clips matching a slot's accepted types, in the slot's preference
        order, stable within a type."""
        out = []
        for wanted in accepts:
            out.extend(c for c in self.clips if c.content_type == wanted)
        return out

    def coverage(self) -> dict[str, int]:
        counts: dict[str, int] = {}
        for c in self.clips:
            counts[c.content_type] = counts.get(c.content_type, 0) + 1
        return counts

    # ------------------------------------------------------------- builders
    @classmethod
    def from_screening_results(cls, media_dir: Path | str,
                               results: list[dict[str, Any]],
                               rights_status: str = "owned") -> "ClipLibrary":
        """Build from screening outputs (`ScreeningResult`-shaped dicts).

        `rights_status` is asserted by the caller because screening does not
        know who owns a file — the caller does. Only pass owned/licensed
        footage here.
        """
        media_dir = Path(media_dir)
        clips = []
        for r in results:
            analysis = r.get("analysis") or {}
            path = Path(r.get("local_path") or (media_dir / f"{r.get('clip_id')}.mp4"))
            clips.append(Clip(
                clip_id=str(r.get("clip_id") or r.get("video_id") or path.stem),
                local_path=path,
                content_type=analysis.get("content_type") or "other",
                duration_seconds=r.get("duration_seconds"),
                rights_status=rights_status,
                twelvelabs_video_id=r.get("video_id"),
                detected_items=list(analysis.get("detected_items") or []),
                summary=analysis.get("summary") or "",
                has_burned_captions=bool((r.get("style") or {}).get("has_on_screen_text")),
            ))
        return cls(clips)

    @classmethod
    def from_submissions(cls, rows: list[dict[str, Any]],
                         media_dir: Path | str) -> "ClipLibrary":
        """Production path: rows from the `submissions` table.

        Only `accepted` submissions become clips — acceptance is the moment
        rights transfer per the Legal Ownership flow. The screening payload is
        expected in `metrics` (JSONB) under 'screening', where the intake
        pipeline writes it.
        """
        media_dir = Path(media_dir)
        clips = []
        for row in rows:
            if row.get("status") != "accepted":
                continue
            metrics = row.get("metrics") or {}
            if isinstance(metrics, str):
                try:
                    metrics = json.loads(metrics)
                except ValueError:
                    metrics = {}
            screening = metrics.get("screening") or {}
            analysis = screening.get("analysis") or {}
            clips.append(Clip(
                clip_id=str(row["id"]),
                local_path=media_dir / f"{row['id']}.mp4",
                content_type=row.get("category") or analysis.get("content_type") or "other",
                rights_status="creator_licensed",
                twelvelabs_video_id=screening.get("video_id"),
                detected_items=list(analysis.get("detected_items") or []),
                summary=analysis.get("summary") or "",
            ))
        return cls(clips)
