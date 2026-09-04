-- Local-only shim: the pieces of Supabase the migrations depend on.
--
-- The migrations target a Supabase database, which ships an `auth` schema,
-- an `auth.uid()` function, and the anon/authenticated/service_role roles.
-- A bare Postgres container has none of those, so applying the real
-- migrations locally fails on the first reference.
--
-- This recreates exactly what they reference and nothing more — the four
-- symbols found by grepping the migrations, not a guess at what Supabase
-- contains. It is never applied to a real project: Supabase already has all
-- of this, and `supabase db push` only sends supabase/migrations/.
--
-- auth.uid() returns NULL here, which means RLS policies written as
-- "owner = auth.uid()" deny by default locally. That is the correct
-- behaviour to develop against: a policy that accidentally allows everything
-- should fail here too.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS auth;

-- Minimal stand-in for auth.users; migrations only reference its id.
CREATE TABLE IF NOT EXISTS auth.users (
    id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email text
);

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
    LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        CREATE ROLE anon NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        CREATE ROLE authenticated NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        CREATE ROLE service_role NOLOGIN BYPASSRLS;
    END IF;
END $$;

-- Supabase grants these automatically; a bare Postgres does not. Without them
-- PostgREST returns "permission denied" before RLS is ever consulted, which
-- looks like a policy bug and is not one.
--
-- Grants and RLS are two different gates: a grant says the role may touch the
-- table at all, a policy says which rows. Reproducing only the policies
-- locally would test half the access path.
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT ON TABLES TO anon, authenticated;
