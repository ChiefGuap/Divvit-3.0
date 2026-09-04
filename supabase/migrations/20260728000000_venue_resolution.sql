-- Venue resolution support.
--
-- Screening reads venue names off signage, cups and speech. Resolving those
-- noisy strings to a specific business needs more than a name: corroborating
-- signals (city, menu, cuisine) are what make an automatic attach defensible
-- when a reward is riding on it.

ALTER TABLE businesses ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS cuisine TEXT;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS is_partner BOOLEAN DEFAULT false;

-- Every name the venue is actually called: trading name, sign text, what
-- customers say. Matching only the legal name misses most real evidence.
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS aliases TEXT[] DEFAULT '{}';

-- Menu items double as corroboration: a name match plus a menu match is far
-- stronger evidence than a name match alone.
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS menu_items TEXT[] DEFAULT '{}';

-- Distinctive visual identifiers (logo, cup design, interior notes). Feeds
-- both the screening prompt and resolution. Collect these at onboarding —
-- venue verification quality scales directly with what is stored here.
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS visual_cues TEXT[] DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_businesses_city ON businesses(city);
CREATE INDEX IF NOT EXISTS idx_businesses_partner ON businesses(is_partner);

-- Resolution outcome per submission. Kept separate from `submissions` because
-- a single video can legitimately resolve to several businesses (a "best pizza
-- in SD" ranking is about every shop it features).
CREATE TYPE venue_resolution_verdict AS ENUM ('confirmed', 'needs_review', 'unknown');

CREATE TABLE IF NOT EXISTS submission_venues (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  submission_id  UUID REFERENCES submissions(id) ON DELETE CASCADE,
  business_id    UUID REFERENCES businesses(id) ON DELETE CASCADE,
  verdict        venue_resolution_verdict NOT NULL,
  score          REAL,
  name_score     REAL,
  evidence       TEXT,            -- the raw string screening read
  signals        TEXT[] DEFAULT '{}',
  -- false when the video features several venues: show it as a mention on each
  -- dashboard, never as content made about that business alone.
  is_exclusive   BOOLEAN DEFAULT true,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (submission_id, business_id)
);

CREATE INDEX IF NOT EXISTS idx_submission_venues_business
  ON submission_venues(business_id);
CREATE INDEX IF NOT EXISTS idx_submission_venues_verdict
  ON submission_venues(verdict);

-- Venue names screening read that match no business we know about. Each row is
-- a business that exists, has customers filming it, and is not on Divvit yet.
CREATE TABLE IF NOT EXISTS unresolved_venues (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  evidence      TEXT NOT NULL,
  times_seen    INT DEFAULT 1,
  first_seen    TIMESTAMPTZ DEFAULT NOW(),
  last_seen     TIMESTAMPTZ DEFAULT NOW(),
  city_hint     TEXT,
  UNIQUE (evidence)
);

ALTER TABLE submission_venues ENABLE ROW LEVEL SECURITY;
