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

There is a sixth answer, `not_cafe`, deliberately **outside** `CATEGORIES`. See
"The forced-choice trap" below; it is the single most important thing in this
module.

## Why teacher/student

**There is no public dataset for these five categories.** HuggingFace and the
literature were checked; the nearest work uses hand-built sets of a few thousand
clips. VideoMAE and TimeSformer exist as bases but classify Kinetics-400 human
actions ("eating cake", "pouring"), not cafe-UGC genres.

So we build the dataset:

| Tier | What | Cost | State |
|---|---|---|---|
| **free** | Relabel from screening's existing `content_type` | nothing | works |
| **teacher (indexed)** | Pegasus 1.2 against an indexed video | 1 call | works |
| **teacher (direct)** | Pegasus 1.5 against the file itself | 1 call, **no indexing** | works |
| **student** | Fine-tuned VideoMAE, no API, any file | free after training | **not trained yet** |

### The direct path is what makes this possible at all

Until it existed, a video could only be labelled if screening had already
indexed it — **3 of 465** in the live corpus. Everything else was unreachable at
any price, because indexing bills against a 600-minute allowance.

`/analyze` accepts the video inline (`base64_string`, 30MB ceiling), so a file
can be classified without ever entering an index. Measured 2026-08-16 on a
2.8MB / 30s clip: **200 OK in 8.4s, 6.4k input tokens, zero indexed minutes.**

That turns the pipeline into:

```
download (yt-dlp)  ->  classify from the file  ->  delete the file
```

The media exists for the seconds it takes to classify it, which is exactly what
`internal_eval` rights are for. Nothing is left on disk or in our TwelveLabs
account. A video only needs to be *indexed* if something downstream will
**search** it.

Two constraints found the hard way, both now encoded: the direct path rejects
`max_tokens` below **512**, and a YouTube page URL is not a media URL — it comes
back `video_file_broken`. Hence download-then-inline rather than pass-the-link.

## The forced-choice trap

A five-way schema with no escape hatch does not report "I don't know". It picks
the nearest bucket and reports **high confidence** doing it. Measured on this
corpus:

| Video | Old label | What it actually is |
|---|---|---|
| "He's almost there 😂 Somebody come help Dad" | `venue_vibe` (low) | a man dancing in a living room |
| "Whaaaaooouuuuoooh #pov #hinesfamily" | `venue_vibe` **(high)** | a father and daughter dancing in a living room |
| "Gursha or full-course meal?" | `menu_item` **(high)** | a **home kitchen**, not a venue |

Three poisoned examples in the first five videos. A student trained on those
learns that "venue vibe" means any interior and that "menu item" includes home
cooking — and it learns it *confidently*, because the teacher was confident.

The fix is a mandatory `is_cafe_content` boolean decided **before** the
category. When it is false the label becomes `not_cafe`, which is outside
`CATEGORIES`, so every existing gate (`export_training_set`, `readiness`,
`coverage`, Create's slot filling) excludes it for free. All three videos above
now come back `not_cafe` with the evidence naming the living room.

## Verified, not just labelled

A model's confidence is its opinion of itself. A model that is confidently wrong
reports `"high"` exactly as loudly as one that is right. So `verified` is a
separate field with a separate source, and only `is_pushable`
(**confident AND verified**) means a label may be acted on.

| Source | What it proves | Worth |
|---|---|---|
| `gold` | A human watched the video and said what it is | measures **accuracy** — the number that decides whether to train |
| `agreement` | A different model (Pegasus 1.2 vs 1.5) reached the same answer | measures **stability** only; two models fail together on the same hard cases |

Agreement is cheap and automatic; gold is the one that counts. The honest use is
both — gold on a sample to measure the error rate, agreement on the bulk to
surface the unstable ones. A **disputed** label keeps its original value and
stays unverified: a newer model is not automatically a righter one.

## Run it

```bash
# the five categories, in full
.venv/bin/python -m services.classify.cli taxonomy

# free pass: relabel everything already screened, no API calls
.venv/bin/python -m services.classify.cli label --no-api

# the one that reaches every video: download -> classify -> delete
.venv/bin/python -m services.classify.cli media --dry-run --limit 20
.venv/bin/python -m services.classify.cli media --limit 20

# is any of it trustworthy?
.venv/bin/python -m services.classify.cli coverage
.venv/bin/python -m services.classify.cli verify --limit 25      # stability
.venv/bin/python -m services.classify.cli gold sample --size 40  # -> a human
.venv/bin/python -m services.classify.cli gold apply --from data/classify_review_sample.json
.venv/bin/python -m services.classify.cli gold score             # accuracy

.venv/bin/python -m services.classify.cli stats
.venv/bin/python -m services.classify.cli review
.venv/bin/python -m services.classify.cli export --verified-only
```

`--limit` is a hard ceiling, not a target. Re-running spends nothing: labelled
videos are never recomputed without `--relabel`. `--dry-run` on `media` lists
the batch without fetching a byte.

## Two honesty rules

A training set built from model output can quietly teach a student the
teacher's mistakes, so:

1. **Only confident labels export**, and `--verified-only` requires that
   something outside the model agreed. `--all-confidence` overrides, and says
   what it is costing you.
2. **`readiness()` counts exactly what the export would emit** — never more.
   Otherwise it reports "ready" for a set the export then drops rows from,
   which is the one thing it exists to prevent.

Export rows carry `media_url`, not a local path: harvested footage is
rights-gated and evaluation copies are deleted, so the training pipeline
re-fetches under its own terms rather than us shipping other people's video.

## Where the corpus stands

Measured 2026-08-16, 38 videos looked at out of 465:

```
Review                    7
Montage                   0
Aesthetic / background    0
Venue vibe                2
Menu item                 5
not cafe content         24   (63% of everything looked at)
unclassified            427
```

**The corpus is mostly not cafe content.** Two samples, deliberately drawn
differently:

| Sample | Junk rate |
|---|---|
| Top 16 by view count | **15/16 — 94%** |
| Random 8 | **6/8 — 75%** |

The top-by-views figure is worse than random, which is the part that matters:
**the corpus ranks junk highest.** Format ROI scores computed over this corpus
have been computed largely over video that is not about food at all.

At a 75% junk rate, 465 harvested videos contain roughly 115 usable ones spread
across five categories — about 23 each, against a floor of 200. Labelling
harder does not fix that. **Supply does.** YouTube keyword harvesting is the
wrong source (independently measured: median audience leverage ~0.1); TikTok
creator harvesting works unauthenticated and is the higher-yield surface.

Also measured: **~20% of YouTube downloads fail with HTTP 403**, so a labelling
run reaches about four videos in five. Cost runs ~4–7k input tokens per video
and **zero** indexed minutes.

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

Note that legacy labels predate the `not_cafe` check, so a junk video screened
before this module existed can still be carrying a category. `media --relabel`
re-examines them.

## Tests

```bash
.venv/bin/python -m services.classify.tests.test_classify
```

No network, no API keys. Weighted toward silent-wrong-answer territory: labels
surviving the round trip to the store, a re-harvest not wiping a label we paid
for, permanent failures being retired instead of retried forever, evaluation
copies being deleted even when classification failed, junk not reaching the
training set, and a disputed label not being overwritten by the challenger.

## Training the student, when there is data

```
base    MCG-NJU/videomae-base-finetuned-kinetics   (80.9% top-1 on K400)
needs   ~200+ examples per category, class-balanced
output  a 5-way head replacing the Kinetics-400 head
```

`LocalClassifier` is a real object rather than a TODO so the call sites can be
written and tested now, and so `available()` states plainly why it cannot run
instead of failing somewhere deeper.
