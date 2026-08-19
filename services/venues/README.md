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

# score, rank, snapshot, and write the dated report
.venv/bin/python -m services.venues.cli health

# push one roster cafe through the full Discover video pipeline
.venv/bin/python -m services.venues.cli harvest --cafe "Hidden House Coffee"

# everything as JSON
.venv/bin/python -m services.venues.cli export --json data/roster_export.json
```

Outputs mirror Discover's conventions:

| Path | What |
|---|---|
| `data/venues.db` | roster + signals + score snapshots, accumulates across runs |
| `data/overpass/<county>.json` | cached raw Overpass response — re-runs are free |
| `data/reports/brand-health-<date>-run<n>.json` | immutable dated report |

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

## The metrics pass — what we can and cannot see

Per cafe, zero paid APIs, metadata only (media is never downloaded):

| Source | Status (measured 2026-08-16) | Signal |
|---|---|---|
| YouTube via yt-dlp | **works** | videos about the cafe: views, likes, comments, publish date |
| Yelp public pages | **blocked — HTTP 403 from the first request** | would be rating × review volume; recorded as *absent*, never zero |
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
polite nor useful. The real fix is the Yelp Fusion API key (or Google Places,
which the design doc ranks higher anyway).

**Resume, not restart:** cafes are processed in deterministic `cafe_id` order
and every *attempt* writes a `cafe_signals` row; the next run picks up from
`pending_cafes()`. Kill it any time.

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
- Videos found but Yelp blocked → scored on present components, weights
  renormalized, confidence capped at `medium` (high needs ≥ 0.9 coverage).

Scores are appended to `brand_health_snapshots`, never overwritten — "are we
improving" is the renewal question and a single current value cannot answer
it.

**What the score is not:** with Yelp blocked and TikTok/Instagram dark, it
currently measures *YouTube word of mouth relative to other OC independents*.
That is a real, defensible ranking signal for a sales motion, and it is also
roughly a quarter of the design doc's five-pillar model. The score's
`assumptions.sources` says exactly this on every record.

## Tests

```bash
.venv/bin/python -m services.venues.tests.test_venues   # venue resolution
.venv/bin/python -m services.venues.tests.test_roster   # roster + brand health
```

No network, no keys. The roster suite covers the expensive silent failures:
a chain on the independents roster, duplicate-key collapse, a blocked scrape
read as a zero-star cafe, renormalization drift, and a metrics re-run that
restarts instead of resuming.

## What needs a paid/keyed API to do properly

- **Reviews** — Yelp Fusion or Google Places. Blocks the review component
  entirely today; the single highest-value key to obtain.
- **TikTok mentions** — Research API or a vendor; keyword discovery is dead
  without it.
- **Instagram anything** — Graph API. The roster already carries handles for
  17 cafes as seeds.
- **YouTube at scale** — yt-dlp search works keyless at roughly 10–20s per
  cafe (two searches + up to three enrich calls); the compliant YouTube Data
  API path covers ~30 cafes/day on a default-quota key.
