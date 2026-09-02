"""Word-level animated captions — the single strongest native-feel signal.

Every high-performing cafe video in the corpus has burned-in captions that
appear word by word, in time with the speech. It is the defining visual
signature of TikTok/Reels/Shorts, and a video without it reads as "brand
content" no matter how good the footage is.

Implementation: faster-whisper gives word timestamps locally (no API, no
per-minute cost, runs on CPU), which are grouped into short phrase cues and
rendered as ASS subtitles. ASS rather than drawtext because it gives real
karaoke highlighting, outlines, and per-cue positioning in one pass, and ffmpeg
burns it with a single `subtitles` filter.

TwelveLabs has no transcript endpoint on v1.3 (checked), and its search-span
transcriptions are phrase-level with no word timing — not enough to animate.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

# Model size trade-off: "base" transcribes a 60s clip in a few seconds on CPU
# and is accurate enough for short, clearly-spoken UGC. "small" is noticeably
# better on noisy cafe audio at ~3x the time.
DEFAULT_MODEL = "base"

_model_cache: dict[str, Any] = {}


@dataclass
class Word:
    text: str
    start: float
    end: float


@dataclass
class Cue:
    """A short phrase shown as one caption line."""

    words: list[Word]
    start: float
    end: float

    def text(self) -> str:
        return " ".join(w.text for w in self.words)


def _get_model(model_size: str):
    if model_size not in _model_cache:
        from faster_whisper import WhisperModel
        # int8 on CPU: fastest path that keeps quality for short clips.
        _model_cache[model_size] = WhisperModel(model_size, device="cpu",
                                                compute_type="int8")
    return _model_cache[model_size]


def transcribe_words(media_path: Path | str, start: float = 0.0,
                     end: Optional[float] = None,
                     model_size: str = DEFAULT_MODEL) -> list[Word]:
    """Word-level transcript for a slice of media, timed from `start`.

    Returned timings are relative to `start`, because captions are burned onto
    an already-trimmed segment.
    """
    model = _get_model(model_size)
    segments, _info = model.transcribe(
        str(media_path), word_timestamps=True, vad_filter=True,
        beam_size=1, language=None)

    words: list[Word] = []
    for segment in segments:
        for w in (segment.words or []):
            if end is not None and w.start >= end:
                break
            if w.end <= start:
                continue
            text = w.word.strip()
            if not text:
                continue
            words.append(Word(text=text,
                              start=max(0.0, w.start - start),
                              end=max(0.0, w.end - start)))
    return words


def group_into_cues(words: list[Word], max_words: int = 4,
                    max_gap: float = 0.6, max_seconds: float = 2.0) -> list[Cue]:
    """Group words into short cues.

    Short cues (3-5 words) are what the format actually uses — a full sentence
    on screen reads as a lecture, not a Reel. Cues also break on a pause, so
    captions track the rhythm of speech rather than a fixed word count.
    """
    cues: list[Cue] = []
    current: list[Word] = []

    for word in words:
        if current:
            gap = word.start - current[-1].end
            span = word.end - current[0].start
            if (len(current) >= max_words or gap > max_gap
                    or span > max_seconds):
                cues.append(Cue(words=current, start=current[0].start,
                                end=current[-1].end))
                current = []
        current.append(word)

    if current:
        cues.append(Cue(words=current, start=current[0].start,
                        end=current[-1].end))
    return cues


# ----------------------------------------------------------------- ASS output

def _ass_time(seconds: float) -> str:
    seconds = max(0.0, seconds)
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = seconds % 60
    return f"{h:d}:{m:02d}:{s:05.2f}"


_ASS_COLORS = {
    "white": "&H00FFFFFF", "black": "&H00000000", "yellow": "&H0000FFFF",
    "red": "&H000000FF", "green": "&H0000FF00", "blue": "&H00FF0000",
    "pink": "&H00B469FF", "orange": "&H000080FF",
}


def _ass_color(name: str, default: str = "&H00FFFFFF") -> str:
    return _ASS_COLORS.get((name or "").split("@")[0].lower(), default)


def _ass_escape(text: str) -> str:
    return text.replace("\\", "").replace("{", "(").replace("}", ")")


def build_ass(cues: list[Cue], width: int, height: int,
              fontsize: int = 64, color: str = "white", font_family: str = "",
              outline_color: str = "black", y_fraction: float = 0.78,
              highlight_color: str = "yellow",
              karaoke: bool = True) -> str:
    """Render cues as an ASS subtitle file.

    `karaoke=True` highlights each word as it is spoken — the effect every
    caption app in this space ships by default.
    """
    primary = _ass_color(color)
    outline = _ass_color(outline_color, "&H00000000")
    highlight = _ass_color(highlight_color, "&H0000FFFF")
    # ASS margins are from the bottom when alignment is 2 (bottom-center).
    margin_v = max(20, int(height * (1.0 - y_fraction)))

    header = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {width}
PlayResY: {height}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Divvit,{font_family or "Arial"},{fontsize},{primary},{highlight},{outline},&H64000000,-1,0,0,0,100,100,0,0,1,{max(3, fontsize // 16)},1,2,60,60,{margin_v},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""

    lines = []
    for cue in cues:
        if cue.end <= cue.start:
            continue
        if karaoke and len(cue.words) > 1:
            parts = []
            for w in cue.words:
                # \k durations are in centiseconds.
                duration = max(1, int(round((w.end - w.start) * 100)))
                parts.append(f"{{\\k{duration}}}{_ass_escape(w.text)} ")
            body = "".join(parts).strip()
        else:
            body = _ass_escape(cue.text())
        # A gentle pop-in; subtle enough to read as native, not as a template.
        body = "{\\fad(80,60)}" + body
        lines.append(f"Dialogue: 0,{_ass_time(cue.start)},{_ass_time(cue.end + 0.15)},"
                     f"Divvit,,0,0,0,,{body}")

    return header + "\n".join(lines) + "\n"


def write_ass(cues: list[Cue], path: Path | str, **kwargs) -> Optional[Path]:
    """Write an ASS file, or None when there is nothing to caption."""
    if not cues:
        return None
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(build_ass(cues, **kwargs), encoding="utf-8")
    return path


def captions_for_segment(media_path: Path | str, start: float, end: float,
                         model_size: str = DEFAULT_MODEL,
                         max_words: int = 4) -> list[Cue]:
    """Cues for one planned segment, timed from the segment's own zero."""
    words = transcribe_words(media_path, start=start, end=end,
                             model_size=model_size)
    words = [w for w in words if w.start < (end - start)]
    for w in words:
        w.end = min(w.end, end - start)
    return group_into_cues(words, max_words=max_words)
