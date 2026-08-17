"""Per-segment finishing — the difference between "stitched clips" and "a video".

Each of these targets a specific tell that makes automated edits read as
automated:

* **Loudness** — clips from different phones arrive at wildly different levels.
  Volume jumping at every cut is the single most audible amateur signal. EBU
  R128 normalisation to -14 LUFS (the level platforms normalise to anyway)
  makes the cuts inaudible.
* **Exposure** — the same reason, visually. Footage from three cameras cuts
  together as three different videos unless brightness is pulled toward a
  common target.
* **Motion** — a static shot held for four seconds looks dead next to native
  content, which is almost never locked off. A slow push in or out keeps the
  frame alive without reading as an effect.

Measurement first, correction second: we probe the actual clip rather than
applying a fixed look, because a fixed look is just a different wrong answer.
"""

from __future__ import annotations

import re
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

# Platforms normalise uploads to roughly -14 LUFS; matching it means our audio
# survives their processing instead of being pumped or attenuated.
TARGET_LUFS = -14.0
TARGET_LRA = 11.0
TARGET_PEAK = -1.5

# Mid-grey target for luma normalisation, in 0-255. Slightly above centre:
# food footage reads better a touch bright.
TARGET_YAVG = 128.0
# Cap correction so a deliberately moody interior shot is nudged, not flattened.
MAX_BRIGHTNESS_SHIFT = 0.12


@dataclass
class SegmentMeasurement:
    yavg: Optional[float] = None
    has_audio: bool = True

    def brightness_shift(self) -> float:
        """eq `brightness` value (-1..1) to move this clip toward the target."""
        if self.yavg is None:
            return 0.0
        delta = (TARGET_YAVG - self.yavg) / 255.0
        return round(max(-MAX_BRIGHTNESS_SHIFT, min(MAX_BRIGHTNESS_SHIFT, delta)), 4)


def has_audio_stream(path: Path | str) -> bool:
    try:
        proc = subprocess.run(
            ["ffprobe", "-v", "error", "-select_streams", "a",
             "-show_entries", "stream=index", "-of", "csv=p=0", str(path)],
            capture_output=True, text=True, timeout=60)
        return bool(proc.stdout.strip())
    except subprocess.SubprocessError:
        return False


def measure_segment(path: Path | str, start: float, end: float,
                    ffmpeg: str = "ffmpeg") -> SegmentMeasurement:
    """Sample the segment's average luma. Cheap: a few frames, not the clip."""
    measurement = SegmentMeasurement(has_audio=has_audio_stream(path))
    duration = max(0.1, end - start)
    try:
        proc = subprocess.run(
            [ffmpeg, "-hide_banner", "-nostats",
             "-ss", f"{start:.3f}", "-t", f"{duration:.3f}", "-i", str(path),
             "-vf", "fps=2,signalstats,metadata=print:key=lavfi.signalstats.YAVG",
             "-an", "-f", "null", "-"],
            capture_output=True, text=True, timeout=180)
    except subprocess.SubprocessError:
        return measurement

    values = [float(v) for v in
              re.findall(r"lavfi\.signalstats\.YAVG=([0-9.]+)", proc.stderr)]
    if values:
        measurement.yavg = round(sum(values) / len(values), 2)
    return measurement


def motion_filter(index: int, width: int, height: int, fps: int,
                  duration: float, strength: float = 0.07) -> str:
    """A slow push in or out, alternating by segment.

    Alternating direction matters: every segment pushing in the same way is its
    own kind of template. `zoompan` with d=1 advances one output frame per
    input frame, so the move is tied to real time rather than a frame count we
    would have to keep in sync with the trim.
    """
    frames = max(1, int(round(duration * fps)))
    step = strength / frames
    if index % 2 == 0:
        zoom = f"min(1+{step:.6f}*on,{1 + strength:.4f})"        # push in
    else:
        zoom = f"max({1 + strength:.4f}-{step:.6f}*on,1.0)"      # pull out
    return (f"zoompan=z='{zoom}':d=1"
            f":x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'"
            f":s={width}x{height}:fps={fps}")


def video_chain(width: int, height: int, fps: int, *,
                measurement: Optional[SegmentMeasurement] = None,
                motion: Optional[str] = None,
                subtitles_path: Optional[Path] = None,
                drawtext: Optional[str] = None) -> str:
    """Full per-segment video filter chain, in the order that matters.

    Scale/crop first (work at final resolution), then exposure, then motion,
    then burn-ins last so captions and overlays are never zoomed or cropped.
    """
    parts = [
        f"scale={width}:{height}:force_original_aspect_ratio=increase",
        f"crop={width}:{height}",
        f"fps={fps}",
        "setsar=1",
    ]
    shift = measurement.brightness_shift() if measurement else 0.0
    if abs(shift) > 0.005:
        parts.append(f"eq=brightness={shift}:saturation=1.05")
    if motion:
        parts.append(motion)
    if subtitles_path:
        escaped = str(subtitles_path).replace("\\", "/").replace(":", r"\:")
        parts.append(f"subtitles='{escaped}'")
    if drawtext:
        parts.append(drawtext)
    parts.append("format=yuv420p")
    return ",".join(parts)


def audio_chain(has_audio: bool) -> str:
    """Normalise level so cuts are inaudible; resample so concat is safe."""
    if not has_audio:
        return ""
    return (f"loudnorm=I={TARGET_LUFS}:LRA={TARGET_LRA}:TP={TARGET_PEAK},"
            "aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo")
