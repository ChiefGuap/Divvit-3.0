# Local database

A Supabase-shaped stack in Docker, so the dashboard can be developed and
verified without touching a hosted project.

## Why not `supabase start`

The CLI's own local stack failed on this machine: CLI 2.58.5 pulls a newer
storage-api image and then cannot migrate it (`Migration
fix-search-by-timestamp-sqli not found`). Upgrading needs `brew trust
supabase/tap`, which is a trust decision for the repo owner, not tooling.

Bare Postgres was also unusable — the Homebrew instance wants a password.

So the stack is three small containers instead, which is enough for every
read the dashboard makes.

## Start

```bash
docker run -d --name divvit-pg -e POSTGRES_PASSWORD=divvit -e POSTGRES_DB=divvit \
  -p 54329:5432 postgres:15

docker run -d --name divvit-rest --link divvit-pg:pg -p 54321:3000 \
  -e PGRST_DB_URI="postgres://postgres:divvit@pg:5432/divvit" \
  -e PGRST_DB_SCHEMAS="public" -e PGRST_DB_ANON_ROLE="anon" \
  -e PGRST_JWT_SECRET="super-secret-jwt-token-with-at-least-32-characters-long" \
  postgrest/postgrest:v12.2.3

docker run -d --name divvit-gw --link divvit-rest:rest -p 54331:8000 \
  -v "$PWD/supabase/local/nginx.conf:/etc/nginx/conf.d/default.conf:ro" nginx:alpine
```

Then load the schema — the shim first, then the real migrations unchanged:

```bash
docker exec -i divvit-pg psql -U postgres -d divvit -q < supabase/local/00_supabase_shim.sql
for m in supabase/migrations/*.sql; do
  docker exec -i divvit-pg psql -U postgres -d divvit -q < "$m"
done
```

Stop with `docker rm -f divvit-pg divvit-rest divvit-gw`.

## The three pieces

**postgres** holds the data. **postgrest** is the REST layer Supabase runs;
`supabase-js` speaks to it, not to Postgres. **nginx** exists only to present
PostgREST at Supabase's `/rest/v1` path, because `supabase-js` hard-codes that
prefix. The app therefore has no idea it is running locally — no code branches
on the environment, which is the point.

## The shim, and why it is not in migrations/

`00_supabase_shim.sql` creates the four things the migrations reference that a
bare Postgres lacks: the `auth` schema, `auth.users`, `auth.uid()`, and the
anon/authenticated/service_role roles — plus the table grants Supabase applies
automatically. Those were found by grepping the migrations, not guessed.

It is **local-only** and deliberately outside `supabase/migrations/`, so
`supabase db push` never sends it to a real project, which already has all of
it.

`auth.uid()` returns NULL locally. That means RLS policies written as
`owner = auth.uid()` deny by default here — the correct thing to develop
against, since a policy that accidentally allowed everything would fail
locally too.

Grants and RLS are separate gates: a grant decides whether a role may touch
the table, a policy decides which rows. Reproducing only the policies would
test half the access path, which is why the shim does both.

## Auth

PostgREST needs a JWT secret, because `supabase-js` always sends a bearer
token and PostgREST errors on one it cannot verify (`Server lacks JWT
secret`). The anon key in `.env.local` is a real HS256 JWT with
`{"role":"anon"}`, signed with the secret above — the same shape Supabase
issues, so the role switch behaves identically.

There is no local GoTrue: `/auth/v1/user` returns 401. Every dashboard read is
anonymous, so an empty session is the honest answer rather than a fabricated
user.

## State

Seeded from `supabase/migrations/20260819060000_seed_oc_roster.sql`:

| table | rows |
|---|---|
| businesses | 359 |
| brand_health_snapshots | 584 |
| creators | 351 |
| discovered_videos | 387 |
| venue_signals | 359 |

Empty: `activity_events`, `campaigns`, `content_items`, `editor_cuts`,
`profiles`, `reward_redemptions`, `rewards`, `submissions`,
`submission_venues`, `unresolved_venues`.

All nine dashboard routes return 200 against this stack, but only
`/discover/brand-health` actually reads it — the other eight still render
fixtures from `lib/data.ts`.
