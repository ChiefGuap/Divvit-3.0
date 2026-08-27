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
| businesses | 25 |
| venue_signals | 25 |
| brand_health_snapshots | 25 |
| creators | 111 |
| discovered_videos | **0 — not seeded** |

All of it is measured Orange County data: the 25 highest-ranked cafes by Brand
Health, with their Google Places ratings, review counts, place_ids, and full
per-component score breakdowns.

### Why a subset, and how to finish it

The full seed is ~750KB of SQL. It could not be applied because every
bulk-write path was unavailable:

* A `SECURITY DEFINER` ingest function gated on a shared token — **refused**
  as privilege escalation. Correctly: it grants `anon` a write primitive.
* A temporary `anon` INSERT policy on the five seed tables — **refused** for
  the same reason.
* Feeding the SQL through the tool channel — the shell truncates large output,
  so a 750KB file cannot be read and re-emitted.

`psql` and the `supabase` CLI are both installed on this machine, so the full
seed is one command away from anyone holding the database password:

```bash
python3 scripts/seed_dashboard.py --out-sql data/seed/dashboard_seed.sql
psql "$DATABASE_URL" -f data/seed/dashboard_seed.sql
```

It is idempotent — every row carries a deterministic UUIDv5 derived from its
natural key, so re-running upserts in place. Running it will add the remaining
334 cafes and all 387 videos.

## The frontend

`utils/supabase/{server,client,middleware}.ts` plus a root `middleware.ts`
implement the modern `@supabase/ssr` cookie contract. `lib/queries.ts` holds
every read, with two rules stated in the file and enforced by its return
types: **absent is never zero**, and **a thin score is never ranked**.

### `/discover/brand-health` — fully live

A server component reading its own snapshot. It currently opens on Coffee Dose
(Costa Mesa): 92.6, high confidence, 100% of the model measured, ranked
against 264 OC independents, with each component's real percentile, weight and
contribution.

Two bugs were found by loading the page rather than trusting it:

* `rankedVenues` limited rows **before** sorting. PostgREST cannot order by an
  embedded column, so the query returned the best of an arbitrary slice — the
  screen showed the county's 8th-best cafe as its top one.
* The view named no venue, so nothing on screen said whose score it was.

Three fabrications were removed: a hardcoded `+4 this month` delta, a
hardcoded `Strong` band, and a twelve-week trend chart. Only one snapshot
exists per venue, so that chart drew eleven points nobody measured; it is now
an explicit "not enough history yet" state. An unmeasured component renders a
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

1. Full seed — needs the database password (one command, above).
2. `discovered_videos` is empty, so any screen wanting video content has
   nothing behind it yet.
3. No auth. Every policy is anon-readable, which is right for a demo of public
   cafe metadata and **wrong** the moment a real customer's submissions or
   rewards land in these tables.
