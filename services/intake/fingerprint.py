"""Perceptual video fingerprints — is this file the same *video* we have seen?

The question dedupe has to answer is not "same bytes" (sha256 handles that for
free) but "same footage": a re-encode, a resolution change, or a few seconds
trimmed off must still match, while two different videos shot in the same cafe
must not. That is a perceptual question, so the fingerprint is perceptual:

    frames sampled at a fixed rate (2/s), evenly spaced across the timeline
      -> each decoded by ffmpeg straight to 9x8 grayscale raw bytes
      -> each reduced to a 64-bit dHash (horizontal gradient sign)
      -> fingerprint = the ordered list of per-frame hashes

dHash-on-tiny-grayscale is deliberately coarse. Everything a re-encode changes
(bitrate, codec, chroma, resolution) is destroyed by the 9x8 downscale before
hashing, so those variants land within a bit or two of the original. What
makes two videos different footage (composition, motion, cuts) survives even
at 9x8, so impostors stay ~half the bits apart — random 64-bit hashes differ
in 32 bits on average.

Why a fixed RATE and not a fixed COUNT: a trim under fixed-count sampling
rescales the whole sampling grid (16 frames over 72s land in different places
than 16 frames over 80s), and no amount of sliding fixes a scale mismatch —
measured on real clips, a 10% head+tail trim scored up to 30 bits/frame under
fixed-count, indistinguishable from a different video. Under a fixed rate a
trim is a pure shift of the sequence, so comparison slides the two sequences
against each other (±MAX_OFFSET_SECONDS) and scores the best alignment.

The per-frame statistic is the MEDIAN Hamming distance: a trim pushes a few
sampled frames across cut boundaries (those pairs jump to ~30 bits) and a
mean would let them drown out the majority that still match; the median
ignores them.

Flat frames — solid colours, black lead-ins, static title cards — have no
gradient, so they all hash to the same value and would make any two videos
with enough dead air "match". Each frame therefore carries a flatness flag
(std of the 72 pixels below FLAT_STD) and flat-vs-flat frame pairs are
excluded from the distance: they agree, but their agreement is not evidence.
A video that is MOSTLY flat can never perceptually match anything (distance
comes back maximal); only its sha256 can — which is the right failure mode,
because a featureless video is unusable UGC whatever else is true of it.

No Pillow in the venv (verified 2026-08-16), so ffmpeg does all image work
and numpy does all math — no new dependencies.

Threshold calibration (calibrate.py, run 2026-08-16 on the six real corpus
clips in data/create_clips_eval — two 15s TikToks, four 59-85s YouTube
videos; variants generated with ffmpeg):

    genuine pairs (same footage, transformed)     median bits/frame
      re-encoded  (libx264 crf 32)                 0.0 - 1.0
      downscaled  (256px wide)                     0.0 - 1.0
      trimmed     (first 1.5s cut)                 0.0
      trimmed 10% (off head AND tail)              0.0 - 2.0
      cropped 10% + re-encoded                    10.0 - 12.0
      worst genuine pair observed                 12.0

    impostor pairs (15 cross-pairs of the 6 distinct videos)
      closest impostor pair                       27.0
      median / max                                31.0 / 32.0

Separation gap: 12 (worst genuine, the border crop) to 27 (closest
impostor). MATCH_THRESHOLD sits at 14 — two bits above the worst observed
genuine transform, thirteen below the closest impostor. NEAR_THRESHOLD at 20
marks the residual "suspicious but not certain" band that goes to a human
instead of an auto-verdict. The crop transform is the one to watch —
measured: a 15% border crop scores 14-17 (the near band, human review) and a
20% crop scores 18-22, the top of which escapes the near band entirely.
Heavy crops and horizontal flips are documented evasions; see the README for
what would catch them later.
"""

from __future__ import annotations

import hashlib
import json
import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np

# Sampling rate. 2 frames/second keeps a 15s TikTok at 30 frames and an
# 85s YouTube video at 170 — small enough to store inline, dense enough that
# a single scene never dominates.
SAMPLE_FPS = 2.0

# A fingerprint needs enough frames to be meaningful; very short clips are
# sampled faster to reach this floor. Cap bounds the fingerprint of long
# uploads (10 minutes at 2fps) — beyond that the tail goes unsampled.
MIN_FRAMES = 8
MAX_FRAMES = 1200

# dHash geometry: 9 columns x 8 rows -> 8 horizontal comparisons per row.
_HASH_W, _HASH_H = 9, 8
_FRAME_BYTES = _HASH_W * _HASH_H
HASH_BITS = (_HASH_W - 1) * _HASH_H  # 64

# How far the sequences may slide during alignment: tolerates this many
# seconds trimmed from the head. (Tail trims just shorten the sequence and
# need no offset.)
MAX_OFFSET_SECONDS = 12.0

# Frames whose 9x8 pixels have a std below this are "flat" — no usable
# gradient. 2.5 on a 0-255 scale: a solid colour with codec noise.
FLAT_STD = 2.5

# An alignment must overlap in at least this many INFORMATIVE (non-flat)
# frame pairs to be scoreable; fewer and agreement could be luck.
MIN_OVERLAP = 6

# Calibrated on real clips — see module docstring for the measured numbers.
MATCH_THRESHOLD = 14.0   # <= this: same video
NEAR_THRESHOLD = 20.0    # <= this: suspicious, a human decides


class FingerprintError(RuntimeError):
    pass


@dataclass
class VideoFingerprint:
    """Per-frame dHashes plus enough context to explain a match."""

    frame_hashes: list[int]                 # one 64-bit int per sampled frame
    flat_flags: list[bool] = field(default_factory=list)
    duration_seconds: float = 0.0
    sha256: str = ""                        # exact-bytes identity, free to carry

    def __post_init__(self) -> None:
        if not self.flat_flags:
            self.flat_flags = [False] * len(self.frame_hashes)

    @property
    def n_frames(self) -> int:
        return len(self.frame_hashes)

    @property
    def flat_fraction(self) -> float:
        if not self.flat_flags:
            return 0.0
        return sum(self.flat_flags) / len(self.flat_flags)

    def to_json(self) -> str:
        return json.dumps({
            "frame_hashes": [f"{h:016x}" for h in self.frame_hashes],
            "flat_flags": "".join("1" if f else "0" for f in self.flat_flags),
            "duration_seconds": round(self.duration_seconds, 3),
            "sha256": self.sha256,
        })

    @classmethod
    def from_json(cls, text: str) -> "VideoFingerprint":
        d = json.loads(text)
        return cls(
            frame_hashes=[int(h, 16) for h in d.get("frame_hashes") or []],
            flat_flags=[c == "1" for c in d.get("flat_flags") or ""],
            duration_seconds=d.get("duration_seconds") or 0.0,
            sha256=d.get("sha256") or "",
        )


# ------------------------------------------------------------------ extract

def _probe_duration(path: Path) -> float:
    proc = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "csv=p=0", str(path)],
        capture_output=True, text=True, timeout=60)
    try:
        return float(proc.stdout.strip())
    except ValueError:
        raise FingerprintError(
            f"ffprobe could not read a duration from {path.name}: "
            f"{proc.stderr.strip()[:200]}")


def _extract_gray_frames(path: Path, rate: float,
                         max_frames: int) -> np.ndarray:
    """Decode evenly spaced 9x8 grayscale frames in one ffmpeg call.

    `fps` samples the timeline at even intervals; `scale` with area
    averaging collapses each frame to the hash grid — which is also what
    makes the hash immune to resolution and compression noise.
    """
    proc = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(path),
         "-vf", f"fps={rate:.6f},scale={_HASH_W}:{_HASH_H}:flags=area,format=gray",
         "-frames:v", str(max_frames),
         "-f", "rawvideo", "-pix_fmt", "gray", "-"],
        capture_output=True, timeout=600)
    raw = proc.stdout
    usable = len(raw) - (len(raw) % _FRAME_BYTES)
    if usable < _FRAME_BYTES:
        raise FingerprintError(
            f"ffmpeg produced no frames for {path.name}: "
            f"{proc.stderr.decode(errors='replace').strip()[:200]}")
    frames = np.frombuffer(raw[:usable], dtype=np.uint8)
    return frames.reshape(-1, _HASH_H, _HASH_W)


def _dhash(frame: np.ndarray) -> int:
    """Sign of the horizontal gradient, row-major, packed into 64 bits."""
    bits = frame[:, 1:].astype(np.int16) > frame[:, :-1].astype(np.int16)
    value = 0
    for bit in bits.flatten():
        value = (value << 1) | int(bit)
    return value


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def fingerprint_file(path: Path | str,
                     sample_fps: float = SAMPLE_FPS) -> VideoFingerprint:
    path = Path(path)
    if not path.exists():
        raise FingerprintError(f"no such file: {path}")
    if path.stat().st_size == 0:
        raise FingerprintError(f"{path.name} is empty")
    duration = _probe_duration(path)
    rate = sample_fps
    if duration * rate < MIN_FRAMES:
        rate = MIN_FRAMES / max(duration, 0.5)
    frames = _extract_gray_frames(path, rate, MAX_FRAMES)
    return VideoFingerprint(
        frame_hashes=[_dhash(f) for f in frames],
        flat_flags=[bool(np.std(f.astype(np.float64)) < FLAT_STD)
                    for f in frames],
        duration_seconds=duration,
        sha256=_sha256(path),
    )


# ------------------------------------------------------------------ compare

def _hamming(a: int, b: int) -> int:
    return (a ^ b).bit_count()


def fingerprint_distance(a: VideoFingerprint, b: VideoFingerprint,
                         max_offset_seconds: float = MAX_OFFSET_SECONDS,
                         sample_fps: float = SAMPLE_FPS) -> float:
    """Best-alignment median Hamming distance, in bits per frame (0..64).

    Slides the sequences against each other within ±max_offset_seconds and
    returns the smallest median per-frame distance over any alignment with
    enough informative overlap. Median, not mean, and flat-vs-flat pairs
    excluded — see module docstring. Returns 64.0 (maximally distant) when
    no alignment has enough informative overlap.
    """
    ha, hb = a.frame_hashes, b.frame_hashes
    if not ha or not hb:
        return float(HASH_BITS)

    max_offset = max(1, int(round(max_offset_seconds * sample_fps)))
    best = float(HASH_BITS)
    for offset in range(-max_offset, max_offset + 1):
        distances = []
        for i in range(len(ha)):
            j = i + offset
            if not 0 <= j < len(hb):
                continue
            if a.flat_flags[i] and b.flat_flags[j]:
                continue  # agreement between featureless frames proves nothing
            distances.append(_hamming(ha[i], hb[j]))
        if len(distances) < MIN_OVERLAP:
            continue
        distances.sort()
        best = min(best, float(distances[len(distances) // 2]))
    return best


@dataclass
class FingerprintMatch:
    """A comparison result, ready to be recorded as gate evidence."""

    distance: float
    verdict: str                       # match | near | distinct
    exact: bool = False                # byte-identical files
    detail: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {"distance": self.distance, "verdict": self.verdict,
                "exact": self.exact, **({"detail": self.detail}
                                        if self.detail else {})}


def compare(a: VideoFingerprint, b: VideoFingerprint) -> FingerprintMatch:
    if a.sha256 and a.sha256 == b.sha256:
        return FingerprintMatch(distance=0.0, verdict="match", exact=True)
    distance = fingerprint_distance(a, b)
    if distance <= MATCH_THRESHOLD:
        verdict = "match"
    elif distance <= NEAR_THRESHOLD:
        verdict = "near"
    else:
        verdict = "distinct"
    return FingerprintMatch(distance=distance, verdict=verdict)


# ------------------------------------------------------- cover-frame match

@dataclass
class CoverMatch:
    """Does a platform's cover image appear in the video we screened?"""

    matched: bool
    distance: int                  # best Hamming distance over all frames
    best_frame: int                # which sampled frame matched
    frames_compared: int
    threshold: int
    similarity: float              # 1.0 - distance/64, the spec's 0-0.85 scale

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


# Calibrated 2026-09-01 against real TikTok covers fetched from oEmbed and
# matched to the same creator's videos held locally:
#
#     cover 6747282088778632454 vs its own video     2 bits   (sim 0.969)
#     cover 6745113350746737926 vs its own video     1 bit    (sim 0.984)
#     cover 6747282088778632454 vs the other video  24 bits   (sim 0.625)
#     cover 6745113350746737926 vs the other video  23 bits   (sim 0.641)
#
# A 21-bit gap, and the genuine side is far tighter than expected — a platform
# cover really is one of the frames, re-encoded but not re-composed. 12 sits in
# the middle of that gap. The spec's 0.85 similarity works out at ~10 bits,
# so this is the same call arrived at from measurement rather than assumption.
#
# An earlier guess of 18 would have "worked" on this data while sitting only
# 5 bits from an impostor — comfortable until the first near-duplicate.
COVER_MATCH_BITS = 12


def hash_image(path: Path | str) -> int:
    """dHash one still, on the same grid and with the same scaler the video
    frames use — a cover hashed differently from the frames it is compared
    against would be comparing two different measurements.

    It cannot reuse `_extract_gray_frames`: that applies an `fps` filter, and a
    still image has no timeline for fps to sample, so ffmpeg emits nothing.
    """
    path = Path(path)
    proc = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(path),
         "-vf", f"scale={_HASH_W}:{_HASH_H}:flags=area,format=gray",
         "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "gray", "-"],
        capture_output=True, timeout=120)
    raw = proc.stdout
    if len(raw) < _FRAME_BYTES:
        raise FingerprintError(
            f"ffmpeg produced no frame for {path.name}: "
            f"{proc.stderr.decode(errors='replace').strip()[:200]}")
    frame = np.frombuffer(raw[:_FRAME_BYTES], dtype=np.uint8).reshape(_HASH_H, _HASH_W)
    return _dhash(frame)


def cover_match(fingerprint: VideoFingerprint, cover_path: Path | str,
                threshold: int = COVER_MATCH_BITS) -> CoverMatch:
    """Compare a posted cover frame against every frame we sampled at screening.

    The cover is whichever frame the platform (or the poster) chose, so it is
    matched against the *minimum* distance across the whole video rather than
    against frame zero. Matching only the first frame would fail every video
    whose creator picked a later thumbnail — which is most of them.
    """
    cover = hash_image(cover_path)
    best, best_i = HASH_BITS, -1
    for i, frame in enumerate(fingerprint.frame_hashes):
        d = _hamming(cover, frame)
        if d < best:
            best, best_i = d, i
    return CoverMatch(
        matched=best <= threshold, distance=best, best_frame=best_i,
        frames_compared=fingerprint.n_frames, threshold=threshold,
        similarity=round(1.0 - best / HASH_BITS, 4))
