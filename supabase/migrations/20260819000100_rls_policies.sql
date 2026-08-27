-- Row Level Security for every public table.
--
-- The dashboard authenticates with the *publishable* key, which ships to the
-- browser. It is public by design, so a table without RLS is world-readable
-- and world-writable by anyone who opens devtools. Policies, not obscurity,
-- are the access control here.
--
-- Posture, deliberately narrow:
--
--   * SELECT is granted to `anon` and `authenticated` on the tables the
--     prospect-facing demo has to render. All of that content is already
--     public information (OpenStreetMap venue records, Google Places ratings,
--     public video metadata) or is currently empty.
--   * No INSERT / UPDATE / DELETE policy exists on any table. With RLS on and
--     no write policy, every write through the publishable key is rejected.
--     Seeding runs through the service role, which bypasses RLS.
--   * `profiles` is never anon-readable: a person's row is theirs.
--
-- WHAT MUST CHANGE BEFORE REAL CUSTOMER DATA LANDS — the anon SELECT grants on
-- `submissions`, `content_items`, `reward_redemptions`, `activity_events`,
-- `editor_cuts`, `campaigns` and `rewards` are only defensible while those
-- tables are empty. Each of them will hold one venue's private operating data
-- and, in the first three cases, identifiable guest activity. They need a
-- membership table (profile -> business) and policies scoped
-- `business_id IN (SELECT business_id FROM business_members WHERE profile_id = auth.uid())`
-- before a single real row is written.

ALTER TABLE profiles              ENABLE ROW LEVEL SECURITY;
ALTER TABLE businesses            ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaigns             ENABLE ROW LEVEL SECURITY;
ALTER TABLE submissions           ENABLE ROW LEVEL SECURITY;
ALTER TABLE rewards               ENABLE ROW LEVEL SECURITY;
ALTER TABLE submission_venues     ENABLE ROW LEVEL SECURITY;
ALTER TABLE unresolved_venues     ENABLE ROW LEVEL SECURITY;
ALTER TABLE venue_signals         ENABLE ROW LEVEL SECURITY;
ALTER TABLE brand_health_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE creators              ENABLE ROW LEVEL SECURITY;
ALTER TABLE discovered_videos     ENABLE ROW LEVEL SECURITY;
ALTER TABLE reward_redemptions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_items         ENABLE ROW LEVEL SECURITY;
ALTER TABLE editor_cuts           ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_events       ENABLE ROW LEVEL SECURITY;

-- profiles: owner only, both directions. No anon access at all.
DROP POLICY IF EXISTS profiles_select_own ON profiles;
CREATE POLICY profiles_select_own ON profiles
  FOR SELECT TO authenticated USING (auth.uid() = id);

DROP POLICY IF EXISTS profiles_update_own ON profiles;
CREATE POLICY profiles_update_own ON profiles
  FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- Public reference data: the roster and everything measured about it from
-- public sources.
DROP POLICY IF EXISTS businesses_read ON businesses;
CREATE POLICY businesses_read ON businesses
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS venue_signals_read ON venue_signals;
CREATE POLICY venue_signals_read ON venue_signals
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS brand_health_read ON brand_health_snapshots;
CREATE POLICY brand_health_read ON brand_health_snapshots
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS creators_read ON creators;
CREATE POLICY creators_read ON creators
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS discovered_videos_read ON discovered_videos;
CREATE POLICY discovered_videos_read ON discovered_videos
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS submission_venues_read ON submission_venues;
CREATE POLICY submission_venues_read ON submission_venues
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS unresolved_venues_read ON unresolved_venues;
CREATE POLICY unresolved_venues_read ON unresolved_venues
  FOR SELECT TO anon, authenticated USING (true);

-- Per-venue operating data. Empty today; see the header note before it is not.
DROP POLICY IF EXISTS campaigns_read ON campaigns;
CREATE POLICY campaigns_read ON campaigns
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS rewards_read ON rewards;
CREATE POLICY rewards_read ON rewards
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS submissions_read ON submissions;
CREATE POLICY submissions_read ON submissions
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS reward_redemptions_read ON reward_redemptions;
CREATE POLICY reward_redemptions_read ON reward_redemptions
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS content_items_read ON content_items;
CREATE POLICY content_items_read ON content_items
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS editor_cuts_read ON editor_cuts;
CREATE POLICY editor_cuts_read ON editor_cuts
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS activity_events_read ON activity_events;
CREATE POLICY activity_events_read ON activity_events
  FOR SELECT TO anon, authenticated USING (true);

-- The Live Feed subscribes to inserts here, so the stream is real even while
-- it is empty. Realtime still applies the SELECT policy above per subscriber.
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE activity_events;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
