# Overnight: roster hygiene — lifecycle states + the dashboard seed export

Branch `feat/discover-create-dashboard`, `services/venues/` only. All numbers
below are from live runs on 2026-08-19 (UTC) against `data/venues.db` and
`data/discover.db`, not estimates.

**Billing: 0 Google Places calls billed, 67 served from cache.** No new video
batches beyond one 40-cafe run — the whole budget for this task, spent once.

## The problem

The roster is built from OpenStreetMap, and OSM has no concept of a business
closing. A cafe shuts, the sign comes down, and the node stays exactly where a
mapper left it. That staleness had been showing up for a while as a block of
independents that simply could not be given a review signal, and the shape of
the failures was consistent enough to act on:

* Google reported some as `CLOSED_PERMANENTLY` / `CLOSED_TEMPORARILY`.
* For many more, the nearest same-name match sat past the 400m drift gate
  **with the OSM node already applied as a 5km location bias** — so not a
  matching bug. Google has no business of that name near that point.

Carrying those as permanently "unmeasurable" was the wrong shape twice over.
They polluted the pending queues, so every future pass re-attempted them; and
because Brand Health renormalizes over present components, a closed cafe with
a couple of YouTube videos and no reviews could still clear the 0.50 coverage
bar and walk into a prospect ranking. Fifteen of them had.

## What was built

| Module | Job |
|---|---|
| `services/venues/lifecycle.py` | **new** — assess `active` / `closed` / `unverifiable` from the cheapest evidence available; idempotent, reversible, reports transitions in both directions |
| `services/venues/export.py` | **new** — the versioned, documented seed contract behind `cli export`; schema lives in the module docstring |
| `services/venues/store.py` | `status` + confidence/reason/evidence/checked_at columns, additively migrated; `set_status()`; `status_counts()`; active-by-default filtering with `include_inactive` |
| `services/venues/roster.py` | `STATUS_*` constants, lifecycle fields on `CafeRecord`, `is_active` |
| `services/venues/brand_health.py` | `score_roster` drops non-active cafes itself — the second lock |
| `services/venues/social.py` | `run_metrics_pass(with_review_signal=…)` |
| `services/venues/cli.py` | `lifecycle` command (`--recheck`, `--dry-run`), `metrics --only-reviewed`, `health --include-inactive`, rewritten `export` |
| `services/venues/tests/test_lifecycle.py` | **new** — 97 no-network checks |

### Three states, not two

`closed` and `unverifiable` are deliberately separate, and this is the design
decision the rest of the work hangs off:

| State | Claim | Confidence | Source |
|---|---|---|---|
| `active` | no contrary evidence, or a live Google listing | high / low | Places, or nothing |
| `closed` | this business is not trading | high (`CLOSED_PERMANENTLY`), medium (`CLOSED_TEMPORARILY`) | Google `businessStatus` |
| `unverifiable` | **we** could not confirm it exists there | low, always | drift refusal or empty result |

The first is a first-party claim about the world. The second is an admission
about our own evidence: consistent with a quiet closure or a rename, and also
consistent with a cafe Google lists under a different name. Collapsing them
into one "retired" bucket would overstate what we know, and would leave the
confidence field as the only thing carrying a distinction that belongs in the
state itself. `CLOSED_TEMPORARILY` gets medium rather than high for the same
reason: temporary closures reverse, and a cafe that reopens should re-enter
the roster on the next assessment rather than stay retired on stale evidence.

### Properties the pass is built around

* **Nothing is deleted.** Record, reason, evidence JSON and assessment date
  all persist. `include_inactive` / `--include-inactive` restores the full
  view everywhere it is filtered. "Which cafes did we retire, and why" stays
  answerable — that is the difference between a finding and a lost row.
* **Idempotent and reversible.** The verdict is a pure function of the stored
  evidence, so a re-run changes nothing; new evidence moves a cafe back to
  `active` and the run reports it as a reactivation rather than only ever
  reporting retirements.
* **Silence is not an acquittal** — an evidence-free verdict never overwrites
  a non-active state. This was found by running the pass a second time
  against the live roster after it had already been applied. Retirements
  recorded via `--recheck` rest on a Places lookup, and 26 of them had no
  stored reason left for a plain re-run to replay; that run produced "no
  contrary evidence" for each and un-retired all 26 (262 → 288 active). The
  fix distinguishes "we have nothing to say" from "we looked and it is fine"
  and lets only the second overturn a recorded finding. Verified after the
  fix: `lifecycle` and `lifecycle --recheck` now both leave 262/21/76
  unchanged, and the original evidence and assessment date survive intact.
  Positive evidence still reactivates, so it did not become a one-way door.
* **An Overpass refresh cannot resurrect a closed cafe.** The status columns
  sit outside the OSM-derived column set `upsert_cafe` overwrites. OSM is
  precisely the stale source this exists to correct; letting it write back
  would undo the pass on the next `roster` run. Pinned by a test.
* **Exclusion holds at three layers** — `cafes()`, `pending_cafes()` /
  `pending_reviews()`, and `score_roster` itself. The scorer filtering on its
  own matters because it is the layer a future caller is most likely to reach
  past, and a closed cafe in a prospect's league table is the kind of error
  that ends a sales conversation.
* **Retired cafes leave the percentile cohort, not just the display.** Brand
  Health scores are percentiles within the measured cohort. Leaving 97
  mostly-video-less retired cafes in it would pad the bottom of the
  distribution and lift every real cafe's `social_volume` percentile for
  nothing.

## Measured results

### 1. Lifecycle pass

`cli lifecycle --recheck` over all 359 independents:

| | Before | After |
|---|---:|---:|
| active | 359 | **262** |
| closed | 0 | **21** |
| unverifiable | 0 | **76** |

Breakdown of the 97 retirements:

| Count | Evidence |
|---:|---|
| 17 | `CLOSED_PERMANENTLY` — closed, high confidence |
| 4 | `CLOSED_TEMPORARILY` — closed, medium confidence |
| 74 | drift refusal, location bias applied — unverifiable, low confidence |
| 2 | Places returned no business at all — unverifiable, low confidence |

Two cafes that had no review signal stayed **active**, correctly: Google lists
them and reports them operational, nobody has rated them yet. A new cafe with
no reviews is not a dead one, and the score already treats that as unmeasured
rather than as a bad rating.

**This corrected the README's own numbers.** It had recorded 70 drift refusals
and 18 closures. `cafe_signals.errors` is overwritten rather than merged, so
for 27 cafes a later video pass had replaced the review pass's recorded
reason. Re-reading those through `PlacesClient` recovered them at **0 billed
calls, 27 cache hits** — the cache is keyed on query + bias, and every one of
those queries had been made before. True split: 74 / 21 / 2 / 2.

### 2. Capped metrics run

`cli metrics --limit 40 --only-reviewed` — 40 cafes, the entire budget for
this task, spent in a single run.

The selection: 154 active cafes had a review signal but no video signal.
Brand Health needs ≥ 0.50 of its weight observed to rank a cafe; the video
pass supplies 0.75 of it (volume 0.30, engagement 0.25, recency 0.20) and
reviews the other 0.25. So those 154 cross the bar the moment the video pass
touches them, while a cafe with neither signal needs the video pass to also
*find* something — which on this roster it frequently does not.

Result: **40/40 became rankable.** 40 measured on YouTube, 99 relevant videos
landed in the corpus, 40 review signals re-served from cache, **0 billed
Places calls**. 114 cafes remain in that queue for a future run.

### 3. Ranked counts, before and after

| Stage | Active independents | Measured | Ranked |
|---|---:|---:|---:|
| Baseline (start of task) | 359 | 287 | **121** |
| After the lifecycle pass | 262 | 261 | **106** |
| After the 40-cafe metrics run | 262 | 261 | **146** |

The dip from 121 to 106 is the point of the work, not a regression: 15 of the
original 121 ranked cafes were closed or unverifiable, ranked on video signal
alone with no review component to contradict them. Net against the baseline:
**+25 ranked cafes, and 15 fewer wrong ones.**

Top of the current ranking (`cli health`), unchanged at the head: Coffee Dose
/ Costa Mesa 92.9, Kona Loa Coffee / Mission Viejo 80.6, Jam Jam Tea Lab 80.1.

### 4. The seed export

`cli export` → `data/roster_export.json`, schema version 2, 1.09 MB.

| | |
|---|---:|
| active cafes (`cafes`) | 262 |
| retired records (`retired`) | 97 |
| ranked | 146 |
| with a review signal | 260 |
| video-measured | 147 |
| videos attached | 387 (326 on active cafes, 61 on retired) |

Two arrays at the top level, never merged: `cafes` is the prospect set,
`retired` is the same shape with `brand_health: null`. Per cafe: identity,
lat/lon, website, instagram, the `status` block with its evidence and date,
Brand Health with the full per-component breakdown and assumptions, the review
signal (rating, count, `place_id`, matched name), the video signal summary,
and the cafe's videos joined from `data/discover.db` on
`business_id = cafe_id`.

Two rules the shape enforces, both aimed at the same failure — a consumer
`?? 0`-ing its way through the nulls:

* **Absent stays `null`, never `0`.** No review source answered → `null`, not
  a zero-star cafe. A video whose like count was never enriched → `null`
  likes, because yt-dlp's flat search returns views only and "0 likes" is a
  claim we did not measure. The one honest zero is `video_count: 0`: we
  searched and found nothing, which is a real measurement. A test scans the
  entire payload for zero-filled review values.
* **ISO-8601 UTC with an explicit offset, everywhere.** SQLite's
  `CURRENT_TIMESTAMP` writes naive strings while our own writers write aware
  ones, and both land in the same columns.

Brand Health is recomputed at export time rather than read back from
`brand_health_snapshots`: the score is a percentile within the measured
cohort, and a stored snapshot was normalized against whatever cohort existed
that night. Mixing them puts scores from two distributions on one axis. The
snapshot history stays in the DB and its most recent timestamp rides along as
`previous_snapshot_at`.

## Tests

`services/venues/tests/test_lifecycle.py`, 97 checks, no network, no keys, in
the existing `check()` style. All nine suites pass:

```
test_places  test_roster  test_venues  test_lifecycle
test_intake  test_discover  test_create  test_review  test_classify
```

Weighted toward the two failures that are expensive in a sales conversation
and invisible in a green pipeline: a closed cafe reaching a ranking (pinned at
the store, the scorer, the queues *and* the export, including the cohort-size
check), and a null read as a zero. Also covered: the confidence split between
permanent and temporary closures, a drift refusal classified as unverifiable
rather than closed, an unparseable reason retiring nobody, idempotent
re-runs, reactivation, an evidence-free verdict failing to overturn a
retirement, an Overpass refresh failing to resurrect a retired cafe, the
review-first selection, the `discover.db` video join and its fallback, and
timestamp normalization.

The stored `places:` reason strings are pinned verbatim in the test file,
because parsing them is how a lifecycle pass replays a finding without
re-billing Places — if their format drifts, the tests should be what notices.

## Open gaps

1. **Video evidence is not used as counter-evidence, and it should be.**
   Three retired cafes have YouTube videos published in 2025 or 2026:
   *If You Know You Know* (8 videos, newest 2026-03-20), *The Vintage 1979*
   (9 videos, 2026-01-01), and *Kit Coffee* (4 videos, 2025-07-30) — all
   `unverifiable`, none `closed`. A cafe people are still filming this year is
   almost certainly trading under a name Google indexes differently. A recent
   video should block an `unverifiable` retirement, or downgrade it to a
   "needs review" state. The other 12 retired cafes with videos have nothing
   newer than 2024, which corroborates their retirement.
2. **`cafe_signals.errors` is overwritten, not merged.** This is what
   destroyed 27 reasons and made the README's numbers wrong. The cache made it
   recoverable this time; it will not always. `set_signals` should append to a
   per-source error list, or errors should be split per source the way
   `reviews_checked_at` and `video_checked_at` already are.
3. **Nothing re-checks a retired cafe on a schedule.** The pass is idempotent
   and reversible, but only re-derives from *stored* evidence — a
   `CLOSED_TEMPORARILY` cafe that reopened will not be noticed until something
   re-queries Places for it. A `--force-recheck` that bypasses the disk cache
   for `closed`/`unverifiable` rows would fix it, at the cost of ~97 billed
   calls per sweep.
4. **The unverifiable bucket is not diagnosed further.** 74 cafes are a
   meaningful chunk of the roster, and "renamed" vs "closed" vs "OSM node in
   the wrong place" are three different stories with three different fixes.
   A second Places query on the OSM address rather than the name would
   separate at least the third from the first two.
5. **The 400m drift gate is untuned against ground truth.** Every
   `unverifiable` verdict inherits it. Nobody has checked a sample by hand to
   see whether 400m is generous or strict, and the retirements now depend on
   it more than the review signal ever did.
6. **`schema_version: 2` has one consumer and no consumer test.** Nothing on
   the dashboard side yet asserts the shape it reads, so a rename here still
   breaks silently over there.
