# Divvit Intake — upload verification for the Screening service

When a user submits a video and claims it is about a specific place, three
things can be wrong before the content itself is even judged: we already have
this video, someone else already has this video, or the video is not about
that place. Intake answers all three, spending nothing until the free answers
run out:

| # | Gate | Cost | Question |
|---|------|------|----------|
| 1 | `fingerprint` | local | is the file a readable video at all |
| 2 | `duplicate_submission` | local | has this footage been submitted before, by whom |
| 3 | `public_corpus` | local | does it match a video Discover harvested from public social |
| 4 | `venue_verification` | **one paid Pegasus call** | is it about the claimed business |

The ordering is the budget policy. A duplicate, a suspected re-upload, or a
broken file never costs an API call — gate 4 is only reached by submissions
the local gates could not decide. Every gate's result (including `skipped`)
is persisted with the submission, so any verdict can be audited later.

```bash
# submit
.venv/bin/python -m services.intake.cli submit clip.mp4 \
    --submitter u1 --business "La Bora" --location "North Park, San Diego"

# free gates only — spends nothing, answers "would this dedupe?"
.venv/bin/python -m services.intake.cli check-dupe clip.mp4

# what has been submitted and why it landed where it did
.venv/bin/python -m services.intake.cli history

# fingerprint known public videos into the theft index
.venv/bin/python -m services.intake.cli index-corpus --file tiktok.mp4 \
    --url "https://tiktok.com/@handle/video/123" --creator @handle
```

## The fingerprint

sha256 catches byte-identical files for free; everything else needs a
perceptual answer. Frames are sampled at 2/s, each collapsed by ffmpeg to a
9x8 grayscale grid and reduced to a 64-bit dHash; comparison slides the two
hash sequences against each other (a trim is a pure shift under fixed-rate
sampling) and scores the best alignment by **median** per-frame Hamming
distance. numpy and ffmpeg only — Pillow is not in the venv and is not
needed.

Thresholds are measured, not chosen. On the six real corpus clips in
`data/create_clips_eval` with ffmpeg-generated variants
(`services.intake.calibrate`, 2026-08-16):

| pair type | median bits/frame |
|---|---|
| re-encoded (crf 32) | 0 – 1 |
| downscaled to 256px | 0 – 1 |
| trimmed 1.5s | 0 |
| trimmed 10% off head and tail | 0 – 2 |
| cropped 10% + re-encoded | 10 – 12 |
| **worst genuine transform** | **12** |
| **closest impostor** (15 cross-pairs) | **27** |
| typical impostor | 29 – 32 |

`match <= 14` (auto-decide), `near <= 20` (human decides), else distinct.
Two different videos shot in the same cafe are different footage and sit in
the impostor band — the false-positive risk the threshold protects is real:
calling an honest submitter a thief.

Featureless frames (solid colours, black lead-ins) all hash alike, so each
frame carries a flatness flag and flat-vs-flat pairs are excluded from the
distance. A video that is mostly dead air can only match by sha256 — the
right failure mode, since featureless footage is unusable UGC regardless.

Fixed-rate sampling replaced the first fixed-count design after measurement:
under 16-evenly-spaced-frames, a 10% trim rescales the sampling grid and
scored up to 30 bits — indistinguishable from a different video. Under fixed
rate the same trim scores 0–2.

## Duplicate vs theft

A fingerprint match against a **previous submission** rejects, but who
submitted the original changes the meaning:

- same submitter → `duplicate_submission_resubmit`. Idempotent; a retry or a
  double-tap, not an offence.
- different submitter → `duplicate_submission_other_user`, with
  `possible_theft: true` and both parties recorded. Matches always attribute
  to the *earliest* submission — the claim a reward would have been paid on.

A match against the **harvested public corpus** goes to `needs_review` as
`possible_unowned_content`, never auto-reject: the likeliest honest matcher
is the original creator bringing their own TikTok to Divvit, which is
exactly what the product wants. The gate records what ops needs to settle
ownership — the platform URL, the creator handle, and the check to run
("does the submitter control @handle?").

The theft index only knows videos that were fingerprinted while their media
was on disk. Discover deletes evaluation copies after classification, so
fingerprinting belongs at download time in that pipeline; until then
`index-corpus` backfills whatever media still exists.

## Venue verification

The claimed name+location is resolved against the business catalog
(`services/venues`) so screening runs open-book — a catalog hit puts the
canonical name, menu and visual cues into the Pegasus prompt. The call
itself is `screening.py` business mode over the direct `/analyze` path
(inline base64, pegasus1.5): tokens, never indexed minutes, with the guards
services/classify measured (22MB file gate, 512-token floor). Verdict logic
is `ScreeningClient.decide`, unchanged.

If Discover's corpus already holds screened footage of the same business,
the submission's evidence is cross-checked against it:

- **corroborated** (signage similarity ≥ 0.6 or two shared menu tokens) can
  rescue exactly one situation: screening believed the content but marked
  the venue `unclear`. It never overrides a rejection.
- **contradicted** (≥ 2 corpus videos with readable evidence, best
  similarity < 0.45, no menu overlap) downgrades an approval to review. The
  0.45 line is measured: the OCR-tolerant similarity scores obviously
  unrelated names around 0.35–0.41 (`verify.py` measured "Bronx Pizza" vs
  "The Cauldron Ice Cream" at 0.41), so a lower cutoff calls real
  mismatches neutral.
- an empty corpus — the common case at launch — degrades to screening alone
  and says so in the payload (`status: no_context`).

## What a determined thief can still do

Stated plainly, with measured distances where we have them:

- **Horizontal flip** — measured 30 bits: evades. dHash is not
  mirror-invariant. Cheap future fix: also compare against the
  column-reversed hash (one extra pass, no new data).
- **Crop beyond ~15%** — measured: 15% crop scores 14–17 (lands in the
  review band), 20% scores 18–22, the top of which escapes entirely.
- **Heavy overlays / picture-in-picture / speed changes** — untested,
  assumed to evade.
- **Footage never harvested or submitted before** — invisible to gates 2–3
  by construction. The venue gate still checks the claim, but cannot know
  the footage belongs to someone else.

What would catch these later: at indexing time (approved content enters the
Marengo index anyway) a semantic visual search of new submissions against
the index is flip- and crop-robust, and TwelveLabs' own `likely_repost` /
`watermarked` flags already feed the review path. The perceptual gate's job
is to make theft cost effort *before* any of that spend.

## Tests

```bash
.venv/bin/python -m services.intake.tests.test_intake
```

No network. Synthetic ffmpeg lavfi videos stand in for footage; a fake
screener counts paid calls so gate ordering is asserted, not assumed.
Real-clip behaviour is measured by `services.intake.calibrate`.
