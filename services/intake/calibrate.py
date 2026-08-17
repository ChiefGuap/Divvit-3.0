"""Threshold calibration for the perceptual fingerprint.

Generates transformed variants of real clips with ffmpeg, measures
genuine-pair vs impostor-pair distances, and prints the distributions the
MATCH_THRESHOLD / NEAR_THRESHOLD constants were chosen from. Re-run whenever
the fingerprint parameters change:

    .venv/bin/python -m services.intake.calibrate --clips data/create_clips_eval

The transforms model what an actual re-upload looks like:
  reencode   heavy re-compression (libx264 crf 32, slow bitrate starve)
  downscale  256px wide — a "saved from WhatsApp" copy
  trim       first 1.5 seconds cut off
  trim10     10% off the head AND the tail
  crop       10% border crop, then re-encoded
"""

from __future__ import annotations

import argparse
import itertools
import subprocess
import sys
import tempfile
from pathlib import Path

from .fingerprint import fingerprint_file, fingerprint_distance, VideoFingerprint

TRANSFORMS: dict[str, list[str]] = {
    "reencode": ["-c:v", "libx264", "-crf", "32", "-preset", "veryfast", "-an"],
    "downscale": ["-vf", "scale=256:-2", "-c:v", "libx264", "-crf", "28", "-an"],
    "trim": ["-ss", "1.5", "-c:v", "libx264", "-crf", "23", "-an"],
    "crop": ["-vf", "crop=iw*0.9:ih*0.9", "-c:v", "libx264", "-crf", "28", "-an"],
}


def make_variant(src: Path, kind: str, out_dir: Path,
                 duration: float | None = None) -> Path:
    out = out_dir / f"{src.stem}__{kind}.mp4"
    args = ["ffmpeg", "-v", "error", "-y"]
    if kind == "trim10" and duration:
        # 10% off each end: seek before -i for speed, -t bounds the tail.
        args += ["-ss", f"{duration * 0.10:.2f}", "-i", str(src),
                 "-t", f"{duration * 0.80:.2f}",
                 "-c:v", "libx264", "-crf", "23", "-an"]
    else:
        args += ["-i", str(src)] + TRANSFORMS[kind]
    args.append(str(out))
    subprocess.run(args, check=True, timeout=600)
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--clips", default="data/create_clips_eval",
                    help="directory of source .mp4 clips")
    ap.add_argument("--extra", action="append", default=[],
                    help="additional clip directories (impostor diversity)")
    args = ap.parse_args()

    sources: list[Path] = []
    for d in [args.clips] + args.extra:
        sources += sorted(Path(d).glob("*.mp4"))
    if len(sources) < 2:
        print(f"need at least 2 clips, found {len(sources)}", file=sys.stderr)
        return 1
    print(f"calibrating on {len(sources)} source clips\n")

    prints: dict[str, VideoFingerprint] = {}
    for src in sources:
        prints[src.stem] = fingerprint_file(src)

    kinds = list(TRANSFORMS) + ["trim10"]
    genuine: dict[str, list[float]] = {k: [] for k in kinds}
    with tempfile.TemporaryDirectory() as tmp:
        tmp_dir = Path(tmp)
        for src in sources:
            base = prints[src.stem]
            for kind in kinds:
                variant = make_variant(src, kind, tmp_dir, base.duration_seconds)
                d = fingerprint_distance(base, fingerprint_file(variant))
                genuine[kind].append(d)
                variant.unlink()

    print("genuine pairs (same footage, transformed) — median bits/frame:")
    worst_genuine = 0.0
    for kind in kinds:
        vals = genuine[kind]
        worst_genuine = max(worst_genuine, max(vals))
        print(f"  {kind:10s} min {min(vals):5.1f}  max {max(vals):5.1f}  "
              f"mean {sum(vals) / len(vals):5.1f}")

    impostor = [fingerprint_distance(prints[a.stem], prints[b.stem])
                for a, b in itertools.combinations(sources, 2)]
    impostor.sort()
    print(f"\nimpostor pairs ({len(impostor)} cross-pairs of different videos):")
    print(f"  best (closest) {impostor[0]:5.1f}   "
          f"p10 {impostor[len(impostor) // 10]:5.1f}   "
          f"median {impostor[len(impostor) // 2]:5.1f}   "
          f"max {impostor[-1]:5.1f}")

    print(f"\nworst genuine {worst_genuine:.1f}  vs  closest impostor "
          f"{impostor[0]:.1f}  -> separation gap "
          f"{impostor[0] - worst_genuine:.1f} bits")
    return 0


if __name__ == "__main__":
    sys.exit(main())
