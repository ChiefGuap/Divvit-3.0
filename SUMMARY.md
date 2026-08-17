# Overnight: cafe-first Discover — Orange County roster + Brand Health

Branch `agents/discover-brand-health`, worktree-only, zero TwelveLabs tokens
and zero indexed minutes spent. All numbers below are measured from live runs
on 2026-08-16/17 (UTC), not estimates.

## What was built

New in `services/venues/` (Discover touched only additively — one public
alias in `roi.py`):

| Module | Job |
|---|---|
| `roster.py` | Overpass/OSM element parsing → `CafeRecord`, stable `osm:<type>:<id>` keys, three-test chain exclusion |
| `overpass.py` | polite Overpass client: one bounded county query, raw response cached to `data/overpass/`, retry/backoff on 429/504 |
| `store.py` | `RosterStore` SQLite (`data/venues.db`): `cafes`, `cafe_signals`, append-only `brand_health_snapshots`; CorpusStore conventions (additive self-migration, deterministic order, `export_rows()`) |
| `social.py` | per-cafe metrics pass: yt-dlp search via Discover's `business_queries`, two-tier relevance gate, capped enrichment, rows landed in the Discover corpus with `business_id` = cafe key; best-effort Yelp with circuit breaker; resume-not-restart |
| `brand_health.py` | 0–100 composite over cohort percentiles, renormalized over present components, per-component breakdown + assumptions on every score |
| `cli.py` | `roster` / `metrics` / `health` / `harvest` / `export` + dated JSON reports |
| `tests/test_roster.py` | 50 no-network checks |

Per-cafe video harvest wiring: `cli harvest --cafe <id|name>` runs any roster
cafe through the existing `business_queries` → `Harvester` → corpus pipeline
(metadata only, `rights_status=unlicensed_reference`; media never downloaded).

## What was measured

**Roster (Overpass, free, one query, cached):**
- 698 OSM elements → 684 named venues → **357 independent cafes**, 327 chains
  excluded with stored reasons, 14 nameless dropped.
- Exclusion breakdown: OSM `brand`/`brand:wikidata` tags + a 50-entry SoCal
  blocklist caught 307; the same-name-at-3+-sites test caught 17 more
  (Bodhi Leaf ×7, Lollicup, Blk Dot, Donut Star — none carried brand tags);
  2 single-site national chains (Bluestone Lane, Kolache Factory) leaked into
  the first ranking and were blocklisted by name.
- Coverage gaps: 218/377 initially-independent records had no `addr:city`;
  100 have websites, 17 have Instagram handles (future Graph-API seeds).

**Metrics pass (yt-dlp, keyless, metadata only):**
- **120 cafes measured** (deterministic order, resumable; 237 still pending —
  the pass is designed to continue across nights).
- **297 relevant videos** kept by the relevance gate; 71 cafes (59%) have at
  least one video about them; 292 rows landed in the Discover corpus, 136
  enriched with likes/comments/publish dates.
- Throughput ~10–20s per cafe once the Yelp circuit opened.

**Brand Health:** 118 of 357 independents scored (the 2 late-flagged chains
dropped out). Every score carries per-component percentiles + assumptions.
Unmeasured cafes have **no score** — absent from the ranking, not zero.

## Top 25 OC independent cafes by Brand Health (2026-08-17, run 2)

| # | Score | Videos | Eng% | Cafe | City |
|---|---|---|---|---|---|
| 1 | 92.2 | 8 | 13.0 | Coffee Dose | Costa Mesa |
| 2 | 87.8 | 5 | 8.2 | greenhouse | — |
| 3 | 87.5 | 9 | 4.5 | The Vintage 1979 | Garden Grove |
| 4 | 85.5 | 3 | 7.9 | Alley | — |
| 5 | 80.7 | 6 | 4.3 | Kit Coffee | Newport Beach |
| 6 | 79.6 | 4 | 4.2 | AT230 Cars and Coffee | — |
| 7 | 79.1 | 8 | 2.9 | If You Know You Know | — |
| 8 | 79.1 | 3 | 4.8 | Kona Loa Coffee | Mission Viejo |
| 9 | 78.4 | 1 | 10.1 | The Sketch Pad Café | — |
| 10 | 77.5 | 2 | 6.3 | Ape Coffee | Orange |
| 11 | 74.9 | 2 | 5.8 | Seven Seas Roasting Co. | Aliso Viejo |
| 12 | 74.7 | 9 | 3.1 | Da Vien Coffee | Garden Grove |
| 13 | 74.6 | 1 | 5.4 | Jedidiah Coffee | — |
| 14 | 73.3 | 6 | 3.3 | The Mugs | — |
| 15 | 71.9 | 1 | 8.6 | Micha Boba Tea Bar | Stanton |
| 16 | 70.8 | 3 | 3.4 | Inc Coffee Roasters | — |
| 17 | 69.4 | 6 | 2.2 | Ma Juicy | Westminster |
| 18 | 68.9 | 1 | 10.0 | Melted Vinyl Coffee | — |
| 19 | 68.8 | 5 | 3.9 | Canyon Coffee | — |
| 20 | 67.2 | 2 | 3.1 | Scratch Bakery Cafe | Newport Beach |
| 21 | 65.4 | 2 | 5.4 | Jax Donuts | — |
| 22 | 65.4 | 9 | 3.3 | Hidden House Coffee | — |
| 23 | 65.4 | 1 | 3.5 | Chè Góc Phố | Westminster |
| 24 | 64.7 | 2 | 4.9 | Cafe 86 | — |
| 25 | 64.6 | 2 | 4.3 | Kawaii Boba | — |

All at `medium` confidence: coverage is capped at 0.75 of weights because the
review component is dark (below). "—" city = OSM record had no `addr:city`.

Artifacts: `data/venues.db`, `data/discover.db` (292 business-intent rows),
`data/overpass/orange-county-california.json`,
`data/reports/brand-health-2026-08-17-run{1,2}.json` (run2 is canonical),
`data/roster_export.json`.

## What failed or degraded

- **Yelp blocked everything: HTTP 403 from the very first request** (IP-level,
  measured on 3 different cafes before a circuit breaker was added). The
  review component is recorded as *absent* (None, never zero) for all 120
  measured cafes; scores renormalize over the remaining three components and
  confidence caps at medium. This was anticipated by
  `docs/brand-health-design.md`.
- **Instagram skipped entirely** by design — no unauthenticated surface
  (measured 2026-07-25). 17 OSM Instagram handles captured as seeds.
- **TikTok skipped** — keyword search fails on request signing; creator pages
  work but we have no handles per cafe yet.
- **Relevance-gate leaks, found and fixed live:** "Sergio's" initially
  attached a Miami Cuban restaurant and an engagement-ring shop (single-token
  names match same-named businesses nationwide). Fixed with a two-tier gate:
  distinctive multi-token names match on tokens/phrase; ambiguous names also
  need a geo cue (city/county/California marker). The 18 affected cafes were
  purged and re-measured (70 polluted corpus rows → 25 clean ones). Residual
  known leak: one music video ("I Gotcha") still attached to the cafe
  "Gotcha" — name-based matching has a floor; TwelveLabs venue verification
  is the real precision layer and costs indexed minutes we deliberately did
  not spend tonight.
- **Chain detection has a blind spot** for national chains with one local
  site and no OSM brand tag; two leaked and were hand-blocklisted. Durable
  fix: match against the OSM Name Suggestion Index.

## What needs a paid/keyed API to do properly

1. **Reviews** — Yelp Fusion or (better, per the design doc) Google Places.
   Single highest-value key; turns on the fourth score component and lifts
   confidence to high.
2. **TikTok mentions** — Research API or a vendor (Apify/Bright Data/
   EnsembleData). Keyword discovery is impossible without it.
3. **Instagram** — Graph API; multi-week approval, start now.
4. **YouTube at scale** — Data API (~30 cafes/day/key on default quota) for
   the compliant path; yt-dlp remains the fallback.

## Test status

All five suites green at final commit: `services.venues.tests.test_roster`
(new, 50 checks), `services.venues.tests.test_venues`,
`services.discover.tests.test_discover`, `services.create.tests.test_create`,
`services.classify.tests.test_classify`.
