# Divvit Classify — the five-category video model

One question, asked of every video: **what kind of video is this?**

| Category | What it is | What Create does with it |
|---|---|---|
| `review` | Someone vouches for the place on camera | payoff — the moment that persuades |
| `montage` | Fast multi-shot cuts; the structure is the point | body — carries the middle |
| `aesthetic` | No narrative: light, texture, steam, ASMR | b-roll — fills gaps, sets tone |
| `venue_vibe` | The room and its atmosphere, legible as *this* place | hook — establishes the place |
| `menu_item` | One dish or drink, held long enough to be the subject | body — the product shot |

The taxonomy is about *kind of video*, not *what is in frame* — a latte appears
in all five. A mislabel is not cosmetic: it puts b-roll where a payoff belongs.

## Why teacher/student

**There is no public dataset for these five categories.** HuggingFace and the
literature were checked; the nearest work uses hand-built sets of a few thousand
clips. VideoMAE and TimeSformer exist as bases but classify Kinetics-400 human
actions ("eating cake", "pouring"), not cafe-UGC genres.

So we build the dataset:

| Tier | What | Cost | State |
|---|---|---|---|
| **free** | Relabel from screening's existing `content_type` | nothing | works |
| **teacher** | `PegasusClassifier` — one focused TwelveLabs analyze call | 1 call per video, on footage screening already paid to index | works |
| **student** | `LocalClassifier` — fine-tuned VideoMAE, no API, any file | free after training | **not trained yet** |

`classify_cascade()` orders these by money: an existing screening verdict is
free, so it short-circuits before any spend. The keyword-archetype guess is a
last resort and is never returned as a trustworthy label — it exists so callers
can prioritise what is worth paying to classify properly.

The schema is deliberately four fields. Measured during style extraction: a
13-field Pegasus schema misreported audio for a video a focused 4-field schema
got right. One question at a time is worth the round-trip.

## Run it

```bash
# the five categories, in full
.venv/bin/python -m services.classify.cli taxonomy

# what a run would do and cost — spends nothing
.venv/bin/python -m services.classify.cli label --dry-run

# free pass only: relabel everything already screened
.venv/bin/python -m services.classify.cli label --no-api

# spend the teacher on up to 25 indexed videos
.venv/bin/python -m services.classify.cli label --limit 25

.venv/bin/python -m services.classify.cli stats
.venv/bin/python -m services.classify.cli readiness
.venv/bin/python -m services.classify.cli export --out data/training/classify.jsonl
```

`--limit` is a hard ceiling on API calls, not a target. Re-running spends
nothing: labelled videos are never recomputed unless you pass `--relabel`.

## Two honesty rules

A training set built from model output can quietly teach a student the
teacher's mistakes, so:

1. **Only confident labels export.** A `low` label with a close runner-up is
   exactly the example that would poison a small model. `--all-confidence`
   overrides, and says what it is costing you.
2. **`readiness()` reports per category**, against a 200-example floor, and
   counts exactly what the export would emit — never more. Nobody should train
   on 12 examples of one class and 300 of another and wonder why it collapsed.

Export rows carry `media_url`, not a local path. Harvested footage is
rights-gated and evaluation copies are deleted after screening, so the training
pipeline re-fetches under its own terms rather than us shipping a folder of
other people's video.

## Where the corpus stands

Measured 2026-08-16 against the 465-video corpus:

```
Review                    4
Montage                   0
Aesthetic / background    0
Venue vibe                1
Menu item                 5
unclassified            455   (3 of them indexed, so labellable now)
```

**The bottleneck is not the classifier — it is screening.** 452 of 455
unlabelled videos have never been indexed, and an unindexed video cannot be
labelled at any price. Getting to a fine-tune means screening far more of the
corpus first, and fixing supply before that: YouTube is a weak source for this
content (median audience leverage ~0.1), so labelling 465 mostly-YouTube videos
would train a student on the wrong distribution.

## Legacy mapping

Screening's original `content_type` vocabulary predates this taxonomy, so
already-screened videos relabel for free instead of paying to re-index:

| screening | category |
|---|---|
| `review` | `review` |
| `menu_item` | `menu_item` |
| `interior` | `venue_vibe` |
| `event` | `venue_vibe` (event footage is about the room being full) |
| `vlog`, `other` | **not mapped** — genuinely need a fresh look |

## Tests

```bash
.venv/bin/python -m services.classify.tests.test_classify
```

No network, no API keys. Weighted toward silent-wrong-answer territory: labels
surviving the round trip to the store, a re-harvest not wiping a label we paid
for, ambiguous legacy types not being mapped, and low-confidence output not
leaking into the training set.

## Training the student, when there is data

```
base    MCG-NJU/videomae-base-finetuned-kinetics   (80.9% top-1 on K400)
needs   ~200+ examples per category, class-balanced
output  a 5-way head replacing the Kinetics-400 head
```

`LocalClassifier` is a real object rather than a TODO so the call sites can be
written and tested now, and so `available()` states plainly why it cannot run
instead of failing somewhere deeper.
