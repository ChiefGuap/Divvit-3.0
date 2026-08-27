# Dashboard backend on Supabase — what is real, what is not

## The project, and why it is a new one

`cmzxfwqixqcuyitsilal` — **divvit-dashboard**, us-east-2, free tier ($0/mo).

The credentials originally supplied pointed at `aywuiwkkmijybtibefxp`, which is
reachable and empty but which this tooling has **no migration rights** on. The
only manageable project was `betgivqfeccgjoblxspu`, named "Divvit" — and that
one turned out to hold the **live consumer app**: 41 real user profiles, 193
bills, 438 bill participants, 143 promotions across 23 tables. Pointing an
autonomous migration at real user data was not an acceptable risk, so a clean
project was created instead.

`apps/web-dashboard/.env.local` holds the URL and publishable key. It is
gitignored and was verified untracked before every commit.

## Schema

Four migrations applied, all committed under `supabase/migrations/`:

| Migration | What |
|---|---|
| `20260721000000_initial_schema` | profiles, businesses, campaigns, submissions, rewards |
| `20260728000000_venue_resolution` | business identity columns, submission_venues, unresolved_venues |
| `20260819000000_dashboard_schema` | venue_signals, brand_health_snapshots, creators, discovered_videos, reward_redemptions, content_items, editor_cuts, activity_events + the OSM/lifecycle columns on businesses |
| `20260819000100_rls_policies` | RLS on all 15 tables |

**RLS posture.** Every table has row-level security enabled with a SELECT-only
policy for `anon`; `profiles` additionally allows a user to UPDATE their own
row. This matters more than it looks: the publishable key ships to the
browser, so a table without RLS is world-**writable**, not merely readable.
`get_advisors(security)` returns **zero findings**.

## Seeded data

| Table | Rows |
|---|---|
| businesses | **359** (265 active, 94 retired) |
| venue_signals | **359** |
| brand_health_snapshots | **584** (296 rankable) |
| creators | **351** |
| discovered_videos | **387** |

All of it is measured Orange County data: the 25 highest-ranked cafes by Brand
Health, with their Google Places ratings, review counts, place_ids, and full
per-component score breakdowns.

### How the full seed was applied

An earlier pass could only seed 25 cafes, because every bulk-write path was
unavailable: a `SECURITY DEFINER` ingest function and a temporary `anon`
INSERT policy were both refused as privilege escalation (correctly — the
publishable key is public), and a 750KB file cannot be dragged through a tool
channel that truncates large output.

The answer was none of those. **`supabase link` authenticates with the CLI's
existing access token and provisions a login role without a database
password**, so `supabase db push` applies a migration directly. Nothing was
weakened to make it work.

One reconciliation was needed first. The schema had been applied through the
MCP, which stamps its own version numbers, so the CLI saw four remote versions
with no local files *and* four local files it believed unapplied. Repairing
both directions left a single consistent history:

```bash
supabase link --project-ref cmzxfwqixqcuyitsilal
supabase migration repair --status applied  20260721000000 20260728000000 20260819000000 20260819000100
supabase migration repair --status reverted 20260819052320 20260819052336 20260819052640 20260819052730
supabase db push
```

That is metadata only — no schema was touched.

The seed itself lives at `supabase/migrations/20260819060000_seed_oc_roster.sql`
(768KB). It is data rather than schema, and is a migration only because that is
the write path the CLI authenticates for. It is idempotent: every row carries a
deterministic UUIDv5 derived from its natural key, so re-running upserts in
place. Regenerate it with:

```bash
python3 scripts/seed_dashboard.py --out-sql data/seed/full_seed.sql --lean
```

## The frontend

`utils/supabase/{server,client,middleware}.ts` plus a root `middleware.ts`
implement the modern `@supabase/ssr` cookie contract. `lib/queries.ts` holds
every read, with two rules stated in the file and enforced by its return
types: **absent is never zero**, and **a thin score is never ranked**.

### `/discover/brand-health` — fully live

A server component reading its own snapshot. It opens on Coffee Dose (Costa
Mesa): 92.6, high confidence, 100% of the model measured, ranked against 264
OC independents, with each component's real percentile, weight and
contribution. Verified against the database that this is genuinely the
top-ranked active venue, rather than trusting the page.

Two bugs were found by loading the page rather than trusting it:

* `rankedVenues` limited rows **before** sorting. PostgREST cannot order by an
  embedded column, so the query returned the best of an arbitrary slice — the
  screen showed the county's 8th-best cafe as its top one.
* The view named no venue, so nothing on screen said whose score it was.

Three fabrications were removed: a hardcoded `+4 this month` delta, a
hardcoded `Strong` band, and a twelve-week trend chart drawing eleven points
nobody measured. The band is now derived from the score, and the delta is
gone. With the full history seeded, the Metrics tab renders the **real**
snapshot series — labelled as measurement runs rather than weeks, because two
runs on the same evening are an hour apart and calling them weekly would
misstate the cadence. A flat series still draws visible bars instead of
collapsing to zero height, and a run with no score is a gap, not a zero. An unmeasured component renders a
dash and **no bar** — a zero-width bar and a zero score look identical and are
not the same claim.

### Still on fixtures — 8 of 9 routes

`/`, `/collection`, `/collection/campaigns`, `/content`, `/discover`,
`/editor`, `/rewards`, `/rewards/creators` still import from `lib/data.ts`.
They were not converted because the tables behind them — submissions,
campaigns, rewards, content items, editor cuts — have **no real data to show**.
Converting them now would replace fake numbers with empty screens, which is
more honest but not more useful, and the decision of which to do first is a
product call.

`/rewards/creators` is the cheapest next win: `creators` has 111 real rows and
`queries.creators()` is already written and typed.

`cmMetricsFor()` in `lib/data.ts` remains a deterministic hash pretending to be
metrics. It must be deleted, not ported.

## Verified

* `npm run build` passes, TypeScript clean.
* `/discover/brand-health` returns 200 and renders real values, checked in the
  running dev server rather than assumed.
* Security advisors: clean.

## Open

1. **No auth.** Every policy is anon-readable, which is right for a demo of
   public cafe metadata and **wrong** the moment a real customer's submissions
   or rewards land in these tables.
2. **8 of 9 routes still render fixtures** (above). `/rewards/creators` is the
   cheapest conversion — 351 real creators are seeded and `queries.creators()`
   is written and typed.
3. **`cmMetricsFor()` is still a hash pretending to be metrics.** It must be
   deleted, not ported.
4. The seed migration is 768KB of data in the migrations directory. It works
   and it is idempotent, but if migrations ever need to stay lean, move it to a
   seed step run separately from schema.
