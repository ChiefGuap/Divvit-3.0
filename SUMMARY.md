# Overnight build: intake upload-verification layer

Branch `agents/screening-verification`, all work in `services/intake/` (new
package). Nothing else touched. All five test suites pass (intake + discover
+ create + venues + classify). Not pushed, no PRs.

## What was built

`services/intake/` — the gates between "user pressed upload" and "we spend
money":

- **fingerprint.py** — perceptual video fingerprint: frames sampled at 2/s,
  ffmpeg decodes each straight to a 9x8 grayscale grid, numpy dHashes it to
  64 bits (Pillow is not in the venv — verified — and is not needed).
  Comparison slides the sequences (±12s) and takes the best-alignment
  *median* per-frame Hamming distance. Flat/featureless frames are flagged
  and excluded — two videos with dead air must not "match" on nothing.
- **store.py** — `IntakeStore` (SQLite, CorpusStore-style self-migrating
  schema): `submissions` (every submission, all gate results, verdict,
  fingerprint) and `corpus_fingerprints` (known public videos, with URL +
  creator handle for ops evidence).
- **provenance.py** — duplicate gate (same-submitter resubmit vs
  different-submitter possible theft, attributed to the earliest claim) and
  public-corpus theft gate (needs_review + ops evidence, never auto-reject —
  the likeliest matcher is the original creator).
- **venue_check.py** — claim → `services/venues` resolver → enriched
  `BusinessProfile` → `screening.py` business-mode prompt/schema/decide over
  the direct base64 `/analyze` path (classify's measured guards: 22MB gate,
  512-token floor, temperature 0) → cross-check against Discover corpus
  footage of the same business. Degrades cleanly when the corpus knows
  nothing (the launch-day common case).
- **pipeline.py + cli.py** — `submit / check-dupe / history / stats /
  index-corpus`. Free local gates always run before the one paid call;
  skipped gates are recorded as skipped.
- **calibrate.py** — regenerates the threshold measurements below.
- **tests/test_intake.py** — 63 checks, no network, fake screener counts
  paid calls.

## Measured calibration (real clips, `data/create_clips_eval`)

| pair type | median bits/frame |
|---|---|
| re-encode (crf 32) | 0–1 |
| downscale to 256px | 0–1 |
| trim 1.5s | 0 |
| trim 10% head+tail | 0–2 |
| crop 10% + re-encode | 10–12 |
| closest impostor (15 cross-pairs) | 27 |
| impostor median / max | 31 / 32 |

Thresholds: **match ≤ 14, near (human review) ≤ 20**. Separation gap 12→27.

Also measured: 15% crop = 14–17 (review band), 20% crop = 18–22 (partially
escapes), horizontal flip = 30 (**evades** — documented in README with the
cheap fix: also compare the column-reversed hash). A first fixed-count
(16-frame) design was measured failing on trims — a 10% trim rescaled the
sampling grid to 30 bits — and replaced with fixed-rate sampling, after
which the same trim scores 0–2.

Corpus-contradiction threshold raised 0.30 → 0.45 after tests caught the
OCR-tolerant name similarity scoring obviously unrelated venue names at
0.35–0.41 ("Bronx Pizza" vs "The Cauldron Ice Cream" = 0.41, measured in
services/venues/verify.py).

## Live end-to-end run (real TwelveLabs calls)

**TwelveLabs calls spent: 3 of the 20 budget.** All via direct `/analyze`
(inline base64, pegasus1.5) — tokens only, zero indexed minutes. Total
33,126 input tokens.

| submission | gates | verdict | paid? |
|---|---|---|---|
| Aloha Poke & Grill clip, `u_creator1` | all pass → screening | **approved** — `venue confirmed`, type review (high); 13,747 tok | yes |
| same clip re-encoded+downscaled, `u_thief` | duplicate gate, distance 1.0 | **rejected** `duplicate_submission_other_user`, `possible_theft: true`, original submitter recorded | no |
| Cauldron TikTok, `u_creator2` | all pass → screening + corpus cross-check | **approved** — venue confirmed, corroboration `corroborated` (similarity 0.646 vs corpus evidence "CALDROWN ICE CREAM"); 6,391 tok | yes |
| trimmed re-encode of same TikTok, `u_reposter` | duplicate gate | **rejected** `duplicate_submission_other_user` (dup gate outranks corpus gate — correct) | no |
| harvested peach-cobbler TikTok re-encoded, `u_reposter` | public-corpus gate, distance 1.0 | **needs_review** `possible_unowned_content` — evidence: TikTok URL, `@thefoodiediaries`, "verify the submitter controls @thefoodiediaries on tiktok" | no |
| Sonny's Pizzeria clip claimed as "Aloha Poke & Grill", `u_wrongclaim` | all pass → screening | **rejected** — `venue_match: mismatch`, evidence "Spoken name 'Sonny's Pizza'"; 12,988 tok | yes |

Store after the run: 6 submissions (2 approved / 1 review / 3 rejected),
2 corpus fingerprints. Rejections cost zero paid calls in every case.

## Open gaps

- **Horizontal flip evades the fingerprint** (measured 30 bits). Fix is one
  extra comparison against a mirrored hash; deferred, documented.
- **The theft index is only as big as what we fingerprint.** Discover
  deletes evaluation media after classification, so corpus fingerprinting
  belongs at download time inside Discover's pipeline — that touches
  Discover internals, which were off-limits tonight. `index-corpus`
  backfills whatever media still exists.
- **Corroboration in the live run partially self-matched**: the eval clips
  came from the harvested corpus, so the "independent" corpus video for the
  Cauldron check was the same TikTok's screening record. The mechanism is
  what matters (evidence-string similarity across records); a corpus with
  multiple videos per business is what makes it strong.
- **`venue_evidence` strings from pegasus1.5 direct are sometimes generic**
  ("spoken name", "menu items" rather than the name itself), which weakens
  corpus cross-checks. A schema description tweak in screening.py would
  likely fix it; left alone because screening.py is shared and the verdict
  itself was correct in all three live calls.
- Geo/EXIF and visual-reference checks (services/venues/verify.py) are not
  wired into intake — they need an indexed video and reference photos.
  The interface leaves room: gate 4 returns the full screening payload the
  CrossReferenceVerifier would consume.
