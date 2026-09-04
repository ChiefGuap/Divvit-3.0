-- Dashboard schema.
--
-- What the restaurant dashboard (apps/web-dashboard) actually reads. Built on
-- top of the initial schema rather than beside it: `businesses`, `campaigns`,
-- `submissions` and `rewards` keep their names and grow the columns the nine
-- routes need, and the roster/Brand Health/video-corpus tables that
-- services/venues and services/discover produce arrive as new tables.
--
-- The contract that governs every column here, inherited from
-- services/venues/brand_health.py: **absent is NULL, never 0.** A cafe we
-- never measured has `youtube_video_count IS NULL`; a cafe we searched and
-- found nothing about has `youtube_video_count = 0`. The dashboard has to be
-- able to tell those apart, so no column that can be unmeasured carries a
-- non-null default.

-- ---------------------------------------------------------------- businesses

-- Stable identity from the roster: `osm:<type>:<id>`. This is the natural key
-- every seed upserts on — UUIDs are generated here, so nothing outside this
-- database can address a row without it.
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS external_id TEXT;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS source TEXT;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS county TEXT;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS street TEXT;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS housenumber TEXT;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS postcode TEXT;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS website TEXT;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS instagram TEXT;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS facebook TEXT;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS tiktok TEXT;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS opening_hours TEXT;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS is_chain BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS exclusion_reason TEXT;
-- active | closed | unmeasurable — a retired cafe stays on the roster with a
-- reason instead of vanishing, so "how many did we drop and why" stays
-- answerable (services/venues/README.md).
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS lifecycle_status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS osm_tags JSONB;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS first_seen TIMESTAMPTZ;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_businesses_external_id
  ON businesses(external_id) WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_businesses_lifecycle ON businesses(lifecycle_status);
CREATE INDEX IF NOT EXISTS idx_businesses_chain ON businesses(is_chain);

-- The initial schema defaulted this to 100, which is a fabricated perfect
-- score for a business nobody has measured. Unmeasured must read as NULL.
ALTER TABLE businesses ALTER COLUMN organic_brand_health_score DROP DEFAULT;
COMMENT ON COLUMN businesses.organic_brand_health_score IS
  'Denormalised copy of the latest rankable brand_health_snapshots.score, rounded. NULL when unmeasured. The snapshot table is authoritative.';

-- ------------------------------------------------------------- venue signals

-- One row per business per measurement pass: what the scrape could actually
-- see. Mirrors services/venues cafe_signals, flattened so the dashboard can
-- query a rating without unpacking JSON.
CREATE TABLE IF NOT EXISTS venue_signals (
  id                     UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id            UUID NOT NULL UNIQUE REFERENCES businesses(id) ON DELETE CASCADE,
  collected_at           TIMESTAMPTZ,

  -- NULL = never searched. 0 = searched, found nothing (a real, bad number).
  youtube_video_count    INT,
  youtube_queries        TEXT[],
  youtube_checked_at     TIMESTAMPTZ,

  review_provider        TEXT,        -- google_places | yelp
  review_rating          NUMERIC(2,1),
  review_count           INT,
  review_place_id        TEXT,
  review_matched_name    TEXT,
  review_address         TEXT,
  review_business_status TEXT,
  review_distance_m      NUMERIC,
  reviews_checked_at     TIMESTAMPTZ,

  -- What degraded during collection (e.g. 'yelp: HTTP 403'). Kept because a
  -- blocked scrape and a zero-star cafe must never look the same.
  errors                 TEXT[]
);

CREATE INDEX IF NOT EXISTS idx_venue_signals_business ON venue_signals(business_id);

-- ------------------------------------------------------ brand health history

-- Appended, never overwritten: "are we improving" is the renewal question and
-- a single current value cannot answer it.
CREATE TABLE IF NOT EXISTS brand_health_snapshots (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id  UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  captured_at  TIMESTAMPTZ NOT NULL,

  -- NULL when nothing was measurable. Absent from the ranking, not at the
  -- bottom of it.
  score        NUMERIC(4,1),
  confidence   TEXT NOT NULL CHECK (confidence IN ('none','low','medium','high')),
  -- Enough of the model observed to compare this business against others.
  rankable     BOOLEAN NOT NULL DEFAULT false,
  coverage     NUMERIC(4,3),
  cohort_size  INT,

  -- Per component: raw value + percentile + weight, or {"status":"absent"}.
  components   JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Weights, cohort, half-life, per-source caveats. A bare number gets
  -- ignored or disputed; this is what makes it arguable.
  assumptions  JSONB NOT NULL DEFAULT '{}'::jsonb,

  UNIQUE (business_id, captured_at)
);

CREATE INDEX IF NOT EXISTS idx_bh_business_time
  ON brand_health_snapshots(business_id, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_bh_rankable
  ON brand_health_snapshots(rankable, score DESC);

-- -------------------------------------------------------------- creators

CREATE TABLE IF NOT EXISTS creators (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  key             TEXT NOT NULL UNIQUE,      -- platform:handle
  platform        TEXT NOT NULL,
  handle          TEXT NOT NULL,
  display_name    TEXT,
  url             TEXT,
  follower_count  INT,
  videos_seen     INT,
  videos_approved INT,
  videos_rejected INT,
  status          TEXT,                      -- candidate | seeded | blocked
  first_seen      TIMESTAMPTZ,
  last_seen       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_creators_platform ON creators(platform);

-- ------------------------------------------------------- discovered videos

-- The public video corpus: videos found *about* a business, not submitted to
-- it. Distinct from `submissions`, which is content a guest gave Divvit.
-- Default rights are `unlicensed_reference` — nothing here is licensed to
-- repost.
CREATE TABLE IF NOT EXISTS discovered_videos (
  id                     UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  canonical_id           TEXT NOT NULL UNIQUE,     -- platform:video_id
  business_id            UUID REFERENCES businesses(id) ON DELETE SET NULL,
  creator_id             UUID REFERENCES creators(id) ON DELETE SET NULL,

  platform               TEXT NOT NULL,
  platform_video_id      TEXT NOT NULL,
  url                    TEXT NOT NULL,
  title                  TEXT,
  description            TEXT,
  hashtags               TEXT[],
  duration_seconds       NUMERIC,
  published_at           TIMESTAMPTZ,
  thumbnail_url          TEXT,
  language               TEXT,
  width                  INT,
  height                 INT,

  creator_handle         TEXT,
  creator_display_name   TEXT,
  creator_follower_count INT,

  -- NULL = not collected. Never coerced to 0.
  view_count             BIGINT,
  like_count             BIGINT,
  comment_count          BIGINT,
  share_count            BIGINT,
  metrics_collected_at   TIMESTAMPTZ,

  connector              TEXT,
  intent                 TEXT,                      -- business | trend
  source_query           TEXT,
  discovered_at          TIMESTAMPTZ,
  rights_status          TEXT NOT NULL DEFAULT 'unlicensed_reference',

  style                  JSONB,
  classification         JSONB,
  screening              JSONB,
  roi                    JSONB
);

CREATE INDEX IF NOT EXISTS idx_dv_business   ON discovered_videos(business_id);
CREATE INDEX IF NOT EXISTS idx_dv_creator    ON discovered_videos(creator_id);
CREATE INDEX IF NOT EXISTS idx_dv_intent     ON discovered_videos(intent);
CREATE INDEX IF NOT EXISTS idx_dv_platform   ON discovered_videos(platform);
CREATE INDEX IF NOT EXISTS idx_dv_published  ON discovered_videos(business_id, published_at DESC);

-- ---------------------------------------------------- submissions (Collection)

ALTER TABLE submissions ADD COLUMN IF NOT EXISTS creator_id UUID REFERENCES creators(id) ON DELETE SET NULL;
-- general | instructions | social — how the clip arrived, which decides the
-- reward it earns.
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS submission_kind TEXT;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS platform TEXT;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS duration_seconds NUMERIC;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS file_size_bytes BIGINT;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS poster_url TEXT;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS summary TEXT;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS highlights TEXT[];
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS view_count BIGINT;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS like_count BIGINT;

CREATE INDEX IF NOT EXISTS idx_submissions_business_status
  ON submissions(business_id, status, created_at DESC);

-- ------------------------------------------------------------- campaigns

ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft'
  ;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS starts_at TIMESTAMPTZ;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS ends_at TIMESTAMPTZ;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS reward_id UUID;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS audience_label TEXT;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS audience_size INT;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS requests_sent INT;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS rewards_claimed INT;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS videos_received INT;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS video_target INT;

CREATE INDEX IF NOT EXISTS idx_campaigns_business ON campaigns(business_id, status);

-- --------------------------------------------------------------- rewards

ALTER TABLE rewards ADD COLUMN IF NOT EXISTS submission_kind TEXT;
ALTER TABLE rewards ADD COLUMN IF NOT EXISTS points_cost INT;
ALTER TABLE rewards ADD COLUMN IF NOT EXISTS redemption_cap INT;
ALTER TABLE rewards ADD COLUMN IF NOT EXISTS is_live BOOLEAN NOT NULL DEFAULT false;
-- What one claim costs the venue, in dollars. The CPM the dashboard shows is
-- always computed (value * claims) / views * 1000 — never stored, so it can
-- never drift from the numbers it claims to be derived from.
ALTER TABLE rewards ADD COLUMN IF NOT EXISTS value_usd NUMERIC(10,2);
ALTER TABLE rewards ADD COLUMN IF NOT EXISTS image_url TEXT;

ALTER TABLE campaigns
  DROP CONSTRAINT IF EXISTS campaigns_reward_id_fkey;
ALTER TABLE campaigns
  ADD CONSTRAINT campaigns_reward_id_fkey
  FOREIGN KEY (reward_id) REFERENCES rewards(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_rewards_business ON rewards(business_id, is_live);

DO $$ BEGIN
  CREATE TYPE redemption_status AS ENUM ('pending','fulfilled','expired','cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS reward_redemptions (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  reward_id     UUID REFERENCES rewards(id) ON DELETE CASCADE,
  business_id   UUID REFERENCES businesses(id) ON DELETE CASCADE,
  profile_id    UUID REFERENCES profiles(id) ON DELETE SET NULL,
  creator_id    UUID REFERENCES creators(id) ON DELETE SET NULL,
  status        redemption_status NOT NULL DEFAULT 'pending',
  points_spent  INT,
  value_usd     NUMERIC(10,2),
  redeemed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  fulfilled_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_redemptions_business
  ON reward_redemptions(business_id, redeemed_at DESC);

-- ------------------------------------------------------- content manager

DO $$ BEGIN
  CREATE TYPE content_state AS ENUM ('ready','published','archived');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS content_items (
  id                   UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id          UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  submission_id        UUID REFERENCES submissions(id) ON DELETE SET NULL,
  creator_id           UUID REFERENCES creators(id) ON DELETE SET NULL,
  title                TEXT NOT NULL,
  creator_label        TEXT,
  state                content_state NOT NULL DEFAULT 'ready',
  accepted_at          TIMESTAMPTZ,
  published_at         TIMESTAMPTZ,
  archived_at          TIMESTAMPTZ,
  -- Archive retention is 14 days; the UI counts down from archived_at rather
  -- than storing a number that goes stale the moment it is written.
  duration_seconds     NUMERIC,
  file_size_bytes      BIGINT,
  poster_url           TEXT,
  video_url            TEXT,
  source_platform      TEXT,

  view_count           BIGINT,
  like_count           BIGINT,
  comment_count        BIGINT,
  save_count           BIGINT,
  share_count          BIGINT,
  metrics_collected_at TIMESTAMPTZ,

  times_used           INT NOT NULL DEFAULT 0,
  last_used_at         TIMESTAMPTZ,
  used_on              TEXT[],
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_content_business_state
  ON content_items(business_id, state);

-- ------------------------------------------------------------- editor cuts

CREATE TABLE IF NOT EXISTS editor_cuts (
  id                   UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id          UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  title                TEXT NOT NULL,
  style_id             TEXT,
  -- draft | queued | rendering | rendered | posted | failed
  state                TEXT NOT NULL DEFAULT 'draft',
  clip_count           INT,
  duration_seconds     NUMERIC,
  poster_url           TEXT,
  video_url            TEXT,
  -- Handle on the render job, once a render service exists to issue one.
  render_job_id        TEXT,
  render_started_at    TIMESTAMPTZ,
  render_finished_at   TIMESTAMPTZ,
  render_error         TEXT,
  posted_at            TIMESTAMPTZ,
  posted_to            TEXT[],
  view_count           BIGINT,
  like_count           BIGINT,
  comment_count        BIGINT,
  metrics_collected_at TIMESTAMPTZ,
  -- CPM numerator. NULL until a reward spend is actually attributed to a cut.
  rewards_paid_usd     NUMERIC(10,2),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_editor_cuts_business
  ON editor_cuts(business_id, state);

-- ---------------------------------------------------------- activity feed

-- The Live Feed's backing table. The dashboard subscribes to inserts here via
-- Realtime, so the feed is a real stream that happens to be empty rather than
-- a setInterval over a pool of invented events.
CREATE TABLE IF NOT EXISTS activity_events (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,     -- clip_submitted | reward_redeemed
  actor_name  TEXT,
  headline    TEXT,
  detail      TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_activity_business_time
  ON activity_events(business_id, occurred_at DESC);
