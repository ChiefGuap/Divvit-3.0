# Divvit Venues — cafe roster & Brand Health

Two jobs in one service:

1. **Venue identity** (`catalog.py`, `resolver.py`, `reference.py`,
   `verify.py`) — resolving what screening reads off a sign to the business it
   refers to. Unchanged; see the resolver's own docstrings.
2. **The cafe roster** (`roster.py`, `overpass.py`, `store.py`, `social.py`,
   `brand_health.py`, `cli.py`) — Discover, pivoted cafe-first. Instead of
   starting from videos and working backwards to venues, build a roster of
   every independent cafe in a county, measure the public signal about each,
   and score its **Brand Health** — so Divvit can show a prospect its own
   dashboard before it signs anything.

## Quick start

```bash
# build the county roster (Overpass / OpenStreetMap — free, no key, cached)
.venv/bin/python -m services.venues.cli roster --county "Orange County"

# measure public signal for pending cafes; resumes across runs
.venv/bin/python -m services.venues.cli metrics --limit 40

# ...or spend that budget only on cafes that already have a review signal,
# which is the cheapest path to a *rankable* cafe
.venv/bin/python -m services.venues.cli metrics --limit 40 --only-reviewed

# decide which roster cafes are still real businesses (free — reads evidence
# already on cafe_signals; --recheck falls back to the Places cache)
.venv/bin/python -m services.venues.cli lifecycle --recheck

# score, rank, snapshot, and write the dated report
.venv/bin/python -m services.venues.cli health

# push one roster cafe through the full Discover video pipeline
.venv/bin/python -m services.venues.cli harvest --cafe "Hidden House Coffee"

# the dashboard seed contract
.venv/bin/python -m services.venues.cli export --json data/roster_export.json
```

Outputs mirror Discover's conventions:

| Path | What |
|---|---|
| `data/venues.db` | roster + signals + score snapshots, accumulates across runs |
| `data/overpass/<county>.json` | cached raw Overpass response — re-runs are free |
| `data/reports/brand-health-<date>-run<n>.json` | immutable dated report |
| `data/roster_export.json` | the versioned seed contract for the dashboard |

## The roster — measured, Orange County, 2026-08-16

One bounded Overpass query (`amenity=cafe` ∪ `shop=coffee` ∪ `shop=tea` ∪
coffee/boba `fast_food`) against the county admin boundary returned **698 OSM
elements → 684 named venues → 357 independents** after chain exclusion
(327 chains excluded, 14 nameless elements dropped). The raw response is
cached; a re-run costs Overpass nothing.

Chain exclusion is three independent tests, any of which excludes:

1. **OSM brand tags** — `brand` or `brand:wikidata` present.
2. **Name/operator blocklist** — the coffee/boba/bakery chains actually in
   Southern California (Starbucks through Ding Tea), word-boundary matched on
   normalized names so "Scooterville Cafe" survives "Scooter's".
3. **Multi-location detection** — the same name at 3+ sites in one county is
   a brand whatever its tags say. This caught what the first two missed:
   Bodhi Leaf Coffee Traders (7 locations) and Lollicup arrived with no brand
   tag and off-blocklist. Two locations stays independent.

No test catches a national chain with a *single* local site and no brand tag
— Bluestone Lane and Kolache Factory both leaked into the first live ranking
and are now blocklisted by name. The durable fix is checking names against an
external brand register (e.g. the OSM Name Suggestion Index), not a longer
hand list.

Excluded cafes are stored with `is_chain=1` and the reason, not dropped —
"how many chains did we filter and why" stays answerable.

**Known roster limits:** OSM is a floor, not a census — a cafe nobody mapped
is not on the roster. 218 of 377 initially-independent records carry no
`addr:city` (searches fall back to county level). Coordinates for ways use
the computed centroid.

## Lifecycle — which of these are still real businesses

OSM has no concept of a business closing. A cafe shuts, the sign comes down,
and the node stays where a mapper left it in 2019. That staleness was showing
up as "unmeasurable" cafes, and the shape of the failures was consistent
enough to act on. Every independent now carries an explicit `status`
(`lifecycle.py`), with the evidence and the date that produced it.

| State | What it means | Confidence | Measured, 2026-08-19 |
|---|---|---|---:|
| `active` | no contrary evidence, or a live Google listing | high / low | **262** |
| `closed` | Google's `businessStatus` says it is not trading | high (`CLOSED_PERMANENTLY`, 17) / medium (`CLOSED_TEMPORARILY`, 4) | **21** |
| `unverifiable` | we looked and could not confirm it exists there | low, always | **76** |

`closed` and `unverifiable` are deliberately not the same state. One is a
first-party claim about the world; the other is an admission about our
evidence. 74 of the 76 unverifiable cafes are drift refusals — Google's
nearest same-name match sat past the 400m gate *with the OSM node already
applied as a 5km location bias* — and the remaining 2 returned nothing at all.
That is consistent with a quiet closure or a rename, and it is also consistent
with a cafe Google lists under a different name. Retiring both under one label
would overstate what we actually know, and the confidence field would be the
only thing left to carry the difference.

Three properties this pass is built around:

* **Nothing is deleted.** The record, the reason, the evidence JSON and the
  assessment date all stay. `--include-inactive` brings the full roster back
  wherever it is filtered. "Which cafes did we retire, and why" has to stay
  answerable — that is the difference between a finding and a lost row.
* **Retirement is reversible and the pass is idempotent.** The verdict is a
  pure function of the stored evidence, so re-running changes nothing; new
  evidence (a temporary closure lifting, a rename Google catches up with)
  moves a cafe back to `active` and the run reports it as a reactivation.
* **Silence is not an acquittal.** An evidence-free verdict never overwrites
  an existing non-active state. This was a live bug first: retirements
  recorded by a `--recheck` run rest on a Places lookup, and 26 of them had no
  stored reason for the *next* plain run to replay — which duly produced "no
  contrary evidence" and un-retired all 26. "We have nothing to say" and "we
  looked and it is fine" are different findings, and only the second may
  overturn a recorded one.
* **An Overpass refresh cannot resurrect a closed cafe.** The status columns
  are deliberately outside the OSM-derived column set that `upsert_cafe`
  overwrites. OSM is exactly the stale source this exists to correct, so
  letting it write back would undo the pass on the next `roster` run.

Non-active cafes are excluded from `cafes()`, `pending_cafes()`,
`pending_reviews()`, the ranking, and the export's active set. `score_roster`
drops them itself as a second lock, rather than trusting every caller to pass
the right flag: a closed cafe in a prospect's league table is the kind of
error that ends a sales conversation. It also keeps them out of the percentile
cohort, which is the subtler half — 97 retired cafes, most with no videos,
would otherwise pad the bottom of the distribution and lift everyone else's
`social_volume` percentile for free.

**Cost: 0 billed Places calls.** The pass reads the reason each earlier run
already wrote to `cafe_signals.errors`. 27 of those rows had been clobbered by
a later write to the same column, so `--recheck` re-queried them through
`PlacesClient` — all 27 served from the on-disk query+bias cache.

## The metrics pass — what we can and cannot see

Per cafe, zero paid APIs, metadata only (media is never downloaded):

| Source | Status (measured 2026-08-16) | Signal |
|---|---|---|
| YouTube via yt-dlp | **works** | videos about the cafe: views, likes, comments, publish date |
| Google Places (New) v1 | **works — keyed** | rating × review volume, plus `businessStatus` and a `place_id` that confirms identity |
| Yelp public pages | **blocked — HTTP 403 from the first request** | superseded by Places; kept as a fallback for rows measured before the key existed |
| Instagram | **skipped entirely** | no unauthenticated surface (measured 2026-07-25); OSM handles captured as future Graph-API seeds |
| TikTok keyword search | **skipped** | broken without a key (request signing); creator pages work but need known handles |

YouTube search reuses Discover's `business_queries` (the two highest-precision
variants), gates results on a relevance test — every distinctive token of the
cafe's name, or the full name as a phrase, in title+description — and enriches
the top 3 videos per cafe for engagement and dates. Kept rows land in the
Discover corpus with `business_id = osm:<type>:<id>` and default
`unlicensed_reference` rights, so the roster and the video corpus share one
spine.

A Yelp 403 streak opens a circuit breaker for the rest of the run: the block
is IP-level, and 350 more requests against a host that said no is neither
polite nor useful. Places supersedes it entirely when a key is present.

### Places, and why identity matters more than the rating

Text search on a bare cafe name returns the best match *anywhere*. Measured on
this roster: "Sergio's" matched an auto repair shop **575km away**, and
"La Terraza Cafe" one **639km away**. Attaching a confident 4.8 to the wrong
business is worse in a sales conversation than showing nothing, so every match
passes two gates:

* **Drift** — Google's pin must sit within **400m** of the OSM node.
* **Name** — when there are no coordinates to check against, token overlap
  must clear **0.6**. Possessive debris is stripped first: "Sergio's" tokenizes
  to `{sergio, s}`, and that stray single character is a free point of overlap
  against every other possessive name.

The root fix was passing the OSM node's coordinates as a `locationBias`
circle (5km). 218 roster records carry no `addr:city`, so their query is a
bare `"<name> CA"` — without the bias, text search answers with the same-named
business in another county. With it, Sergio's resolves to the real cafe:
4.5 stars over 188 reviews.

Responses are cached on disk keyed by **query + bias**, so a resumed pass
re-bills nothing. Measured: re-running the 99 unmatched cafes cost **0 billed
calls, 99 cache hits**. The field mask is deliberately minimal (id, name,
address, location, rating, count, status) to stay in the cheaper SKU and never
touch the expensive ones.

**Resume, not restart:** cafes are processed in deterministic `cafe_id` order
and every *attempt* writes a `cafe_signals` row; the next run picks up from
`pending_cafes()`. Kill it any time.

### Which cafes to spend a capped run on

`metrics --only-reviewed` narrows the queue to cafes that already carry a
review signal. Brand Health needs ≥ 0.50 of its weight observed to *rank* a
cafe; the video pass supplies 0.75 of that (volume 0.30, engagement 0.25,
recency 0.20) and reviews the other 0.25. So a cafe with a review signal
already crosses the bar the moment the video pass touches it, while a cafe
with neither needs the video pass to also *find* something — which, on this
roster, it often does not. Same ~15s of yt-dlp per cafe, strictly better odds,
which is what matters when the run is budget-capped rather than exhaustive.

Measured 2026-08-19, one 40-cafe run against that queue: **40/40 became
rankable.** 40 measured on YouTube (99 relevant videos), 40 review signals
re-served from cache, **0 billed Places calls**. Ranked cafes went
**106 → 146**. Walking the roster in `cafe_id` order instead would have spent
the same budget partly on cafes that stay unrankable afterwards.

## Brand Health — the score

The scrape-only P0/P1 slice of `docs/brand-health-design.md`, honest about
what it can see:

| Component | Raw metric | Weight |
|---|---|---:|
| `social_volume` | relevant YouTube videos found | 0.30 |
| `engagement_quality` | median (likes+comments)/views | 0.25 |
| `recency` | 0.5^(age of freshest video / 90d) | 0.20 |
| `review_signal` | rating × log10(1+reviews) | 0.25 |

Every raw value becomes a **percentile within the measured county cohort**
(Discover's `percentile_ranks`, shared not re-implemented), then the composite
renormalizes over whichever components are present — `roi.py`'s pattern
exactly. The score ships with a per-component breakdown (raw value,
percentile, weight, or `absent`) and an assumptions block, because a bare
number gets ignored or disputed.

The missing-vs-zero contract, which the tests pin down:

- Metrics never ran, or every source failed → **no score**. Absent from the
  ranking, not at the bottom of it.
- We searched and found nothing → `social_volume = 0`, a real measured number
  that scores (deservedly) low.
- Videos found and reviews present → full coverage, confidence `high`.
- Videos found but no review source → scored on present components, weights
  renormalized, confidence capped at `medium` (high needs ≥ 0.9 coverage).
  This was every cafe's state while Yelp was the only review source.

Scores are appended to `brand_health_snapshots`, never overwritten — "are we
improving" is the renewal question and a single current value cannot answer
it.

**The cohort is the active roster.** Retired cafes are dropped before scoring,
not just before display: percentiles are computed within the measured cohort,
so leaving 97 mostly-video-less closed and unverifiable cafes in it would pad
the bottom of the distribution and lift every real cafe's `social_volume`
percentile for nothing.

Measured 2026-08-19, after the lifecycle pass and one 40-cafe metrics run:
**146 ranked of 262 active independents** (1 unmeasured, 115 scored but too
thin to compare).

**What the score is not:** with TikTok and Instagram still dark, it measures
*YouTube word of mouth plus Google reviews, relative to other OC
independents*. That is a real, defensible ranking signal for a sales motion,
and it is also about half of the design doc's five-pillar model. The score's
`assumptions.sources` says exactly this on every record.

## The seed export — `data/roster_export.json`

`cli export` writes the file another service seeds Supabase from, so it is a
contract, not a dump. The schema lives at the top of `export.py` and is
versioned (`schema_version`); adding a field is fine, renaming one is not.

Two arrays at the top level, and the split is the point: `cafes` is the active
independents — the prospect set — and `retired` is the closed and unverifiable
records in the identical shape. They are never merged, because the whole
reason the lifecycle exists is that a closed cafe must not reach a ranking.

Per cafe: identity (`cafe_id`, name, city, lat/lon, website, instagram), the
`status` block with its evidence and date, Brand Health with the full
per-component breakdown and the assumptions block, the review signal
(rating, count, `place_id`, matched name), the video signal summary, and the
cafe's videos joined from `data/discover.db` on `business_id = cafe_id` — the
spine the roster and the video corpus already share.

Two rules the shape enforces, both aimed at the same failure:

* **Absent stays `null`, never `0`.** A cafe with no review signal is not a
  zero-star cafe, and a video whose like count was never enriched is not a
  video with no likes. The one honest zero is `video_count: 0` — we searched
  and found nothing, which is a measurement. The tests scan the whole payload
  for zero-filled review values.
* **ISO-8601 UTC, with an offset, everywhere.** SQLite's `CURRENT_TIMESTAMP`
  writes naive strings and our own writers write aware ones; both land in the
  same columns, so the export normalizes rather than making every consumer
  handle two formats.

Brand Health is recomputed at export time rather than read back from
`brand_health_snapshots`. The score is a percentile within the measured
cohort, and a stored snapshot was normalized against whatever cohort existed
that night — mixing the two puts scores from different distributions on one
axis. The snapshot history stays in the DB; its most recent timestamp rides
along as `previous_snapshot_at`.

## Tests

```bash
.venv/bin/python -m services.venues.tests.test_venues     # venue resolution
.venv/bin/python -m services.venues.tests.test_roster     # roster + brand health
.venv/bin/python -m services.venues.tests.test_places     # review signal + identity
.venv/bin/python -m services.venues.tests.test_lifecycle  # lifecycle + export
```

No network, no keys. The suites cover the expensive silent failures: a chain
on the independents roster, duplicate-key collapse, a blocked scrape read as a
zero-star cafe, renormalization drift, a metrics re-run that restarts instead
of resuming, a closed cafe reaching a prospect's ranking (pinned at the store,
the scorer *and* the export), an Overpass refresh resurrecting a retired cafe,
and an absent value exported as a zero.

## What needs a paid/keyed API to do properly

- ~~**Reviews**~~ — **done.** Google Places (New) v1, keyed. **260 of 359**
  independents carry a rating. The other 99, with reasons recorded per cafe:

  | | |
  |---|---|
  | 74 | nearest same-name match too far — refused by the drift gate |
  | 21 | closed permanently or temporarily, per `businessStatus` |
  | 2 | no Places result at all |
  | 2 | found, but nobody has rated it yet (absent, *not* zero stars) |

  (The earlier reading of this table said 70/18. Those two rows were
  undercounted because `cafe_signals.errors` is overwritten rather than
  merged, so 27 review-pass reasons had been replaced by a later video pass.
  Re-reading them from the Places cache — 0 billed calls — gave the numbers
  above.)

  The 74 refusals are with location bias already applied, so they are not a
  matching bug: Google has no business of that name near that point. 97 of
  these 99 are now retired from the roster with their evidence; see
  **Lifecycle** above. The 2 unrated ones are correctly `active` — a cafe
  Google lists but nobody has reviewed is new, not dead.
- **TikTok mentions** — Research API or a vendor; keyword discovery is dead
  without it.
- **Instagram anything** — Graph API. The roster already carries handles for
  17 cafes as seeds.
- **YouTube at scale** — yt-dlp search works keyless at roughly 10–20s per
  cafe (two searches + up to three enrich calls); the compliant YouTube Data
  API path covers ~30 cafes/day on a default-quota key.
