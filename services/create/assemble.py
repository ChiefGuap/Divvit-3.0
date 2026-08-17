"""Assembly — recipe + clips + moments -> one postable vertical mp4.

Pure ffmpeg, no editing SDK. Every segment is normalized to the same canvas
(1080x1920, 30fps, aac) before concat, because concat of mismatched streams is
the single most common way an automated edit dies. Landscape source footage is
scaled to fill the vertical frame and center-cropped rather than letterboxed —
platform-native, not repurposed-TV.

The build is planned first (`plan_edit`) and rendered second (`render`). The
plan is a plain dict, so the dashboard can show "here is the cut I intend to
make" for approval before any rendering happens.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
from types import SimpleNamespace
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Any, Callable, Optional

from .captions import captions_for_segment, write_ass
from .library import ClipLibrary
from .moments import MomentFinder
from .polish import (SegmentMeasurement, audio_chain, measure_segment,
                     motion_filter, video_chain)
from .recipes import PAYOFF, Recipe

CANVAS_W, CANVAS_H, FPS = 1080, 1920, 30


class AssemblyError(RuntimeError):
    pass


@dataclass
class PlannedSegment:
    slot_role: str
    clip_id: str
    source_path: str
    start: float
    end: float
    moment_source: str
    overlay: Optional[str] = None
    transcription: str = ""
    # Filled during render: what the burned-in speech captions actually say.
    spoken_caption: str = ""
    # Source already has captions in the pixels -> don't add a second layer.
    has_burned_captions: bool = False


@dataclass
class EditPlan:
    archetype: str
    business: str
    segments: list[PlannedSegment] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    caption_style: Optional[dict[str, Any]] = None

    def total_seconds(self) -> float:
        return sum(s.end - s.start for s in self.segments)

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["total_seconds"] = round(self.total_seconds(), 2)
        return d


def plan_edit(recipe: Recipe, library: ClipLibrary, finder: MomentFinder,
              business: str, on_status: Callable[[str], None] = print) -> EditPlan:
    """Fill each slot with the best available clip + moment.

    A clip is used at most once — a video that repeats the same shot reads as
    broken. A slot with no candidates is skipped with a warning; the edit
    shrinks rather than fails, as long as at least a hook and one more segment
    survive.
    """
    plan = EditPlan(archetype=recipe.archetype, business=business,
                    caption_style=asdict(recipe.caption_style))
    used: set[str] = set()

    # Assign scarcest-first: the slot with the fewest candidate clips picks
    # before slots that could use anything. Greedy in-recipe-order allocation
    # let a permissive body slot eat the only `review` clip and starve the
    # payoff — the one slot the whole edit builds toward.
    slot_order = sorted(
        range(len(recipe.slots)),
        key=lambda i: len(library.by_type(recipe.slots[i].accepts)))

    # Spans already taken from each clip, so two slots never show the same
    # action twice even if they both drew from the same source video.
    spans_used: dict[str, list[tuple[float, float]]] = {}
    assigned: dict[int, PlannedSegment] = {}
    for i in slot_order:
        slot = recipe.slots[i]
        candidates = [c for c in library.by_type(slot.accepts)
                      if c.clip_id not in used]
        if not candidates:
            plan.warnings.append(
                f"no unused clip for {slot.role} slot (accepts {slot.accepts})")
            continue
        clip = candidates[0]
        # Payoff and review beats live on what the person says; b-roll does not.
        wants_speech = slot.role == PAYOFF or "review" in slot.accepts[:1]
        moment = finder.pick(clip, slot.moment_query, slot.min_seconds,
                             slot.max_seconds, wants_speech=wants_speech,
                             avoid=spans_used.get(clip.clip_id))
        used.add(clip.clip_id)
        spans_used.setdefault(clip.clip_id, []).append((moment.start, moment.end))
        overlay = slot.overlay.format(business=business) if slot.overlay else None
        assigned[i] = PlannedSegment(
            slot_role=slot.role, clip_id=clip.clip_id,
            source_path=str(clip.local_path),
            start=moment.start, end=moment.end,
            moment_source=moment.source, overlay=overlay,
            transcription=moment.transcription,
            has_burned_captions=clip.has_burned_captions)

    # Emit in recipe order — assignment order is an implementation detail.
    for i, slot in enumerate(recipe.slots):
        seg = assigned.get(i)
        if seg is None:
            on_status(f"[plan] {slot.role}: SKIPPED — no footage")
            continue
        plan.segments.append(seg)
        on_status(f"[plan] {seg.slot_role}: {seg.clip_id} "
                  f"{seg.start:.1f}-{seg.end:.1f}s ({seg.moment_source})")

    if len(plan.segments) < 2:
        raise AssemblyError(
            f"only {len(plan.segments)} slots could be filled — the library "
            f"needs more variety (coverage: {library.coverage()})")
    return plan


# ------------------------------------------------------------------ render

def _escape_drawtext(text: str) -> str:
    return (text.replace("\\", "\\\\").replace(":", "\\:")
            .replace("'", "\\\\\\'").replace("%", "\\%"))


# drawtext has no auto-wrap and silently renders past the frame edge, so a
# learned hook like "TOP 5 Korean cafe IN San Diego" clipped to
# "OP 5 Korean cafe IN San Dieg". Width is estimated from the font metric
# rather than measured — close enough, and it keeps ffmpeg to one pass.
_CHAR_WIDTH_RATIO = 0.52
_SAFE_WIDTH = CANVAS_W * 0.88
_MIN_FONTSIZE = 34


def _fit_caption(text: str, fontsize: int, max_lines: int = 2) -> tuple[str, int]:
    """Wrap to at most `max_lines`, then shrink until the widest line fits."""
    words = text.split()
    if not words:
        return text, fontsize

    def widest(lines: list[str], size: int) -> float:
        return max(len(line) for line in lines) * size * _CHAR_WIDTH_RATIO

    for lines_allowed in range(1, max_lines + 1):
        target = max(1, -(-len(text) // lines_allowed))  # ceil
        lines, current = [], ""
        for word in words:
            candidate = f"{current} {word}".strip()
            if current and len(candidate) > target and len(lines) < lines_allowed - 1:
                lines.append(current)
                current = word
            else:
                current = candidate
        lines.append(current)
        if widest(lines, fontsize) <= _SAFE_WIDTH:
            return "\n".join(lines), fontsize

    # Still too wide at max_lines: shrink to fit.
    size = fontsize
    while size > _MIN_FONTSIZE and widest(lines, size) > _SAFE_WIDTH:
        size -= 2
    return "\n".join(lines), size


def _segment_filters(overlay: Optional[str], caption=None) -> str:
    """Normalize to the canvas; optionally burn an overlay caption.

    Caption styling comes from the recipe, which derives it from how captions
    actually look in this format's real videos — not from a house style.
    """
    chain = (
        f"scale={CANVAS_W}:{CANVAS_H}:force_original_aspect_ratio=increase,"
        f"crop={CANVAS_W}:{CANVAS_H},fps={FPS},setsar=1,format=yuv420p"
    )
    if overlay:
        wrapped, size = _fit_caption(overlay, getattr(caption, "fontsize", 64))
        text = _escape_drawtext(wrapped)
        color = getattr(caption, "color", "white")
        bw = getattr(caption, "border_width", 4)
        bc = getattr(caption, "border_color", "black@0.7")
        y = getattr(caption, "y_fraction", 0.78)
        chain += (
            f",drawtext=text='{text}':fontcolor={color}:fontsize={size}:"
            f"borderw={bw}:bordercolor={bc}:x=(w-text_w)/2:y=h*{y}"
        )
    return chain



def _run(cmd: list[str], what: str) -> None:
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise AssemblyError(f"{what} failed: {proc.stderr[-700:]}")


def _render_segment(seg: PlannedSegment, index: int, workdir: Path,
                    caption, *, captions: bool, motion: bool,
                    normalize: bool, caption_model: str,
                    ffmpeg: str, on_status) -> Path:
    """Render one finished segment: trimmed, graded, moved, captioned, levelled.

    Rendering segments individually rather than in one giant filter_complex is
    what makes per-segment captions possible at all (the `subtitles` filter
    needs a file per segment) and keeps a failure attributable to one clip.
    """
    duration = seg.end - seg.start
    out = workdir / f"seg{index:02d}.mp4"

    measurement = (measure_segment(seg.source_path, seg.start, seg.end, ffmpeg)
                   if normalize else SegmentMeasurement())

    subs_path = None
    if captions and seg.has_burned_captions:
        on_status(f"    (seg{index}: source already captioned — not stacking ours)")
    elif captions:
        try:
            cues = captions_for_segment(seg.source_path, seg.start, seg.end,
                                        model_size=caption_model)
            if cues:
                subs_path = write_ass(
                    cues, workdir / f"seg{index:02d}.ass",
                    width=CANVAS_W, height=CANVAS_H,
                    fontsize=max(58, int(getattr(caption, "fontsize", 64) * 1.05)),
                    color=getattr(caption, "color", "white"),
                    outline_color=getattr(caption, "border_color", "black"),
                    y_fraction=getattr(caption, "y_fraction", 0.78))
                seg.spoken_caption = " ".join(c.text() for c in cues)[:300]
        except Exception as exc:
            # Captions are an enhancement; never lose the segment over them.
            on_status(f"    (captions unavailable for seg{index}: "
                      f"{type(exc).__name__})")

    drawtext = None
    if seg.overlay:
        wrapped, size = _fit_caption(seg.overlay, getattr(caption, "fontsize", 64))
        # Hook text sits high when speech captions occupy the lower third.
        y = 0.14 if subs_path else getattr(caption, "y_fraction", 0.78)
        drawtext = (
            f"drawtext=text=\'{_escape_drawtext(wrapped)}\'"
            f":fontcolor={getattr(caption, 'color', 'white')}:fontsize={size}"
            f":borderw={getattr(caption, 'border_width', 4)}"
            f":bordercolor={getattr(caption, 'border_color', 'black@0.7')}"
            f":x=(w-text_w)/2:y=h*{y}")

    motion_f = (motion_filter(index, CANVAS_W, CANVAS_H, FPS, duration)
                if motion else None)
    vchain = video_chain(CANVAS_W, CANVAS_H, FPS, measurement=measurement,
                         motion=motion_f, subtitles_path=subs_path,
                         drawtext=drawtext)

    cmd = [ffmpeg, "-y", "-hide_banner", "-loglevel", "error",
           "-ss", f"{seg.start:.3f}", "-to", f"{seg.end:.3f}",
           "-i", str(seg.source_path), "-vf", vchain]

    achain = audio_chain(measurement.has_audio)
    if achain:
        cmd += ["-af", achain]
    else:
        # Silent track so concat stays aligned when a clip has no audio.
        cmd += ["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo",
                "-shortest", "-map", "0:v", "-map", "1:a"]

    cmd += ["-c:v", "libx264", "-preset", "medium", "-crf", "20",
            "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2",
            "-video_track_timescale", "30000", str(out)]

    _run(cmd, f"segment {index}")
    return out


def _concat(segment_files: list[Path], out_path: Path, *,
            music: Optional[Path], music_gain_db: float,
            ffmpeg: str) -> None:
    """Join finished segments, optionally under a ducked music bed."""
    n = len(segment_files)
    cmd = [ffmpeg, "-y", "-hide_banner", "-loglevel", "error"]
    for f in segment_files:
        cmd += ["-i", str(f)]

    streams = "".join(f"[{i}:v][{i}:a]" for i in range(n))
    filters = [f"{streams}concat=n={n}:v=1:a=1[vout][acat]"]

    if music and Path(music).exists():
        cmd += ["-stream_loop", "-1", "-i", str(music)]
        # Sidechain the music against the dialogue so speech always wins.
        filters += [
            f"[{n}:a]volume={music_gain_db}dB,aresample=48000,"
            f"aformat=sample_fmts=fltp:channel_layouts=stereo[bed]",
            "[acat]asplit=2[voice][key]",
            "[bed][key]sidechaincompress=threshold=0.03:ratio=8:attack=5:"
            "release=250[ducked]",
            "[voice][ducked]amix=inputs=2:duration=first:dropout_transition=0,"
            "alimiter=limit=0.95[aout]",
        ]
        audio_out = "[aout]"
    else:
        audio_out = "[acat]"

    cmd += ["-filter_complex", ";".join(filters),
            "-map", "[vout]", "-map", audio_out,
            "-c:v", "libx264", "-preset", "medium", "-crf", "20",
            "-c:a", "aac", "-b:a", "192k",
            "-movflags", "+faststart", str(out_path)]
    _run(cmd, "concat")


def render(plan: EditPlan, out_path: Path | str,
           ffmpeg: str = "ffmpeg",
           *,
           captions: bool = True,
           motion: bool = True,
           normalize: bool = True,
           caption_model: str = "small",
           music: Optional[Path | str] = None,
           music_gain_db: float = -18.0,
           keep_workdir: Optional[Path] = None,
           on_status: Callable[[str], None] = print) -> Path:
    """Render the plan to a postable mp4.

    Two passes on purpose. Each segment is finished independently — graded,
    moved, captioned, loudness-normalised — then the finished segments are
    concatenated. A single filter_complex cannot burn per-segment subtitle
    files, and one bad clip in a monolithic graph fails the whole render with
    an error that points nowhere.
    """
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    workdir = Path(keep_workdir) if keep_workdir else Path(
        tempfile.mkdtemp(prefix="divvit-create-"))
    workdir.mkdir(parents=True, exist_ok=True)
    caption = SimpleNamespace(**(plan.caption_style or {}))

    try:
        on_status(f"[render] finishing {len(plan.segments)} segments "
                  f"(captions={captions}, motion={motion}, grade={normalize})")
        files = []
        for i, seg in enumerate(plan.segments):
            files.append(_render_segment(
                seg, i, workdir, caption, captions=captions, motion=motion,
                normalize=normalize, caption_model=caption_model,
                ffmpeg=ffmpeg, on_status=on_status))
            on_status(f"    seg{i} {seg.slot_role} ok")

        on_status(f"[render] joining -> {out_path.name} "
                  f"({plan.total_seconds():.1f}s)"
                  + (" with music bed" if music else ""))
        _concat(files, out_path, music=Path(music) if music else None,
                music_gain_db=music_gain_db, ffmpeg=ffmpeg)
    finally:
        if not keep_workdir:
            shutil.rmtree(workdir, ignore_errors=True)

    if not out_path.exists() or out_path.stat().st_size < 10_000:
        raise AssemblyError("ffmpeg produced no usable output")
    return out_path


def write_plan(plan: EditPlan, path: Path | str) -> Path:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(plan.to_dict(), indent=2))
    return path
