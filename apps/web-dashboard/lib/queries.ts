/**
 * Every read the dashboard makes against Postgres.
 *
 * Two rules hold everywhere in this file, both inherited from the measurement
 * pipeline that produced the data (services/venues/brand_health.py):
 *
 *   1. **Absent is not zero.** A cafe with no review signal has
 *      `review_rating === null`, not 0. Callers must render "—", never a
 *      number they invented. Any helper here returns `null` rather than a
 *      fallback value.
 *   2. **Thin scores are not ranked.** `rankable` gates entry to a league
 *      table: a score built from one measured component is real, but it is not
 *      comparable to one built from four. `rankedVenues()` enforces that;
 *      `venueById()` deliberately does not, because a cafe's own dashboard
 *      should show its own score even when it is thin.
 */
import { createClient } from "@/utils/supabase/server";
import { cookies } from "next/headers";

export type ComponentKey =
  | "social_volume"
  | "engagement_quality"
  | "recency"
  | "review_signal";

export type BrandHealthComponent = {
  raw: number | null;
  weight: number;
  percentile?: number;
  status?: "absent";
};

export type BrandHealthSnapshot = {
  score: number | null;
  confidence: "low" | "medium" | "high" | "none";
  rankable: boolean;
  coverage: number | null;
  cohort_size: number | null;
  captured_at: string;
  components: Record<ComponentKey, BrandHealthComponent> | null;
  assumptions: Record<string, unknown> | null;
};

export type Venue = {
  id: string;
  name: string;
  city: string | null;
  address: string | null;
  website: string | null;
  instagram: string | null;
  cuisine: string | null;
  lifecycle_status: string;
  organic_brand_health_score: number | null;
  latitude: number | null;
  longitude: number | null;
};

export type VenueSignal = {
  review_rating: number | null;
  review_count: number | null;
  review_provider: string | null;
  review_matched_name: string | null;
  review_business_status: string | null;
  youtube_video_count: number | null;
  reviews_checked_at: string | null;
  youtube_checked_at: string | null;
};

export type RankedVenue = Venue & {
  snapshot: BrandHealthSnapshot | null;
  signal: VenueSignal | null;
};

async function db() {
  return createClient(await cookies());
}

/** Human label + the copy the UI shows for each measured component. */
export const COMPONENT_LABELS: Record<ComponentKey, { label: string; iconKey: string; barColor: string }> = {
  social_volume: { label: "Organic Video Inflow", iconKey: "video", barColor: "#6346cd" },
  engagement_quality: { label: "Engagement Quality", iconKey: "radar", barColor: "#8c52ff" },
  recency: { label: "Content Recency", iconKey: "megaphone", barColor: "#8c52ff" },
  review_signal: { label: "Review Signal", iconKey: "gift", barColor: "#b79aff" },
};

export const COMPONENT_ORDER: ComponentKey[] = [
  "social_volume",
  "engagement_quality",
  "recency",
  "review_signal",
];

/**
 * The county league table. Only `rankable` snapshots, best first.
 *
 * The `rankable` filter is not cosmetic: without it, cafes scored on reviews
 * alone outrank cafes measured on all four components, which put eight
 * review-only cafes above the most-filmed cafe in Orange County the first time
 * this ran.
 */
export async function rankedVenues(limit = 25): Promise<RankedVenue[]> {
  const supabase = await db();
  const { data, error } = await supabase
    .from("businesses")
    .select(
      `id, name, city, address, website, instagram, cuisine, lifecycle_status,
       organic_brand_health_score, latitude, longitude,
       brand_health_snapshots ( score, confidence, rankable, coverage, cohort_size, captured_at, components, assumptions ),
       venue_signals ( review_rating, review_count, review_provider, review_matched_name,
                       review_business_status, youtube_video_count, reviews_checked_at, youtube_checked_at )`,
    )
    .eq("lifecycle_status", "active");

  if (error) throw new Error(`rankedVenues: ${error.message}`);

  // Sorting happens after the fetch because the score lives on an embedded
  // row, which PostgREST cannot order by. So the fetch must NOT be limited:
  // limiting first and sorting second returns the best of an arbitrary slice,
  // which is how this screen briefly showed the county's 8th-best cafe as its
  // top one. The roster is in the hundreds, so pulling it whole is cheap; if
  // it ever reaches thousands, move the score onto `businesses` and order
  // there.
  const rows = (data ?? []).map(shape).filter((v) => v.snapshot?.rankable);
  rows.sort((a, b) => (b.snapshot?.score ?? -1) - (a.snapshot?.score ?? -1));
  return rows.slice(0, limit);
}

/** One cafe, with its own score even if that score is too thin to rank. */
export async function venueById(id: string): Promise<RankedVenue | null> {
  const supabase = await db();
  const { data, error } = await supabase
    .from("businesses")
    .select(
      `id, name, city, address, website, instagram, cuisine, lifecycle_status,
       organic_brand_health_score, latitude, longitude,
       brand_health_snapshots ( score, confidence, rankable, coverage, cohort_size, captured_at, components, assumptions ),
       venue_signals ( review_rating, review_count, review_provider, review_matched_name,
                       review_business_status, youtube_video_count, reviews_checked_at, youtube_checked_at )`,
    )
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(`venueById: ${error.message}`);
  return data ? shape(data) : null;
}

/** The highest-scoring cafe — what the demo dashboard opens on. */
export async function leadVenue(): Promise<RankedVenue | null> {
  const [top] = await rankedVenues(1);
  return top ?? null;
}

export type CreatorRow = {
  id: string;
  display_name: string | null;
  handle: string | null;
  platform: string | null;
  follower_count: number | null;
  videos_seen: number | null;
  videos_approved: number | null;
  videos_rejected: number | null;
  status: string | null;
};

/** Creators by reach. `follower_count` is null when we never resolved it. */
export async function creators(limit = 25): Promise<CreatorRow[]> {
  const supabase = await db();
  const { data, error } = await supabase
    .from("creators")
    .select("id, display_name, handle, platform, follower_count, videos_seen, videos_approved, videos_rejected, status")
    .order("follower_count", { ascending: false, nullsFirst: false })
    .limit(limit);

  if (error) throw new Error(`creators: ${error.message}`);
  return data ?? [];
}

export type VideoRow = {
  id: string;
  business_id: string | null;
  canonical_id: string | null;
  platform: string | null;
  url: string | null;
  title: string | null;
  view_count: number | null;
  like_count: number | null;
  comment_count: number | null;
  published_at: string | null;
  creator_handle: string | null;
  creator_display_name: string | null;
};

export async function videosForVenue(businessId: string, limit = 24): Promise<VideoRow[]> {
  const supabase = await db();
  const { data, error } = await supabase
    .from("discovered_videos")
    .select("id, business_id, canonical_id, platform, url, title, view_count, like_count, comment_count, published_at, creator_handle, creator_display_name")
    .eq("business_id", businessId)
    .order("view_count", { ascending: false, nullsFirst: false })
    .limit(limit);

  if (error) throw new Error(`videosForVenue: ${error.message}`);
  return data ?? [];
}

/** Corpus-wide counts, used to say plainly how much of the roster is measured. */
export async function coverage() {
  const supabase = await db();
  const [venues, rankable, videos] = await Promise.all([
    supabase.from("businesses").select("id", { count: "exact", head: true }).eq("lifecycle_status", "active"),
    // Snapshots are a history: one venue accumulates many rows over time, so
    // counting them answers "how many rankable measurements exist", not "how
    // many venues are rankable". Counting the rows reported 435 rankable
    // against 265 active venues — a figure that cannot be true and read as
    // one on the page. Distinct business_id is the number actually meant.
    supabase.from("brand_health_snapshots").select("business_id").eq("rankable", true).limit(5000),
    supabase.from("discovered_videos").select("id", { count: "exact", head: true })
      .in("platform", FEED_PLATFORMS as unknown as string[]),
  ]);

  const distinct = new Set(
    ((rankable.data ?? []) as { business_id: string | null }[])
      .map((r) => r.business_id)
      .filter(Boolean),
  );

  return {
    activeVenues: venues.count ?? 0,
    rankedVenues: distinct.size,
    videos: videos.count ?? 0,
  };
}

/** Supabase returns embedded rows as arrays; collapse to the latest one. */
function shape(row: Record<string, unknown>): RankedVenue {
  const snaps = (row.brand_health_snapshots ?? []) as BrandHealthSnapshot[];
  const signals = (row.venue_signals ?? []) as VenueSignal[];
  const snapshot =
    snaps.length > 0
      ? [...snaps].sort((a, b) => (b.captured_at ?? "").localeCompare(a.captured_at ?? ""))[0]
      : null;

  return {
    id: row.id as string,
    name: row.name as string,
    city: (row.city as string) ?? null,
    address: (row.address as string) ?? null,
    website: (row.website as string) ?? null,
    instagram: (row.instagram as string) ?? null,
    cuisine: (row.cuisine as string) ?? null,
    lifecycle_status: (row.lifecycle_status as string) ?? "active",
    organic_brand_health_score: (row.organic_brand_health_score as number) ?? null,
    latitude: (row.latitude as number) ?? null,
    longitude: (row.longitude as number) ?? null,
    snapshot,
    signal: signals[0] ?? null,
  };
}

/** Formats a possibly-absent number without ever inventing a value. */
// Formatting moved to lib/format.ts so client components can use it without
// pulling `next/headers` into the browser bundle. Re-exported here so existing
// server-side imports keep working.
export { orDash, compactCount } from "./format";

export type SnapshotPoint = { captured_at: string; score: number | null; confidence: string; coverage: number | null };

/**
 * A venue's score over time, oldest first.
 *
 * Snapshots are append-only, so this is a real series — but it is a series of
 * *measurement runs*, not of weeks. Two runs on the same evening are two
 * points an hour apart, and labelling them as weekly would be a lie about
 * cadence. Callers should render the actual timestamps.
 */
export async function snapshotHistory(businessId: string, limit = 24): Promise<SnapshotPoint[]> {
  const supabase = await db();
  const { data, error } = await supabase
    .from("brand_health_snapshots")
    .select("captured_at, score, confidence, coverage")
    .eq("business_id", businessId)
    .order("captured_at", { ascending: true })
    .limit(limit);

  if (error) throw new Error(`snapshotHistory: ${error.message}`);
  return data ?? [];
}

/* ------------------------------------------------------ creator leaderboard */

export type LeaderboardCreator = {
  id: string;
  display_name: string | null;
  handle: string | null;
  platform: string | null;
  follower_count: number | null;
  /** Videos of this creator that we have actually discovered. */
  video_count: number;
  /**
   * Summed views across those videos, or null when not one of them carries a
   * view count. Absent is not zero: a creator whose videos we have never
   * measured must not be shown level with one measured at zero views.
   */
  total_views: number | null;
  /** Most recent publish date among their videos, ISO, or null. */
  last_published_at: string | null;
};

/**
 * Creators ranked by the reach we can actually attribute to them.
 *
 * Sorting is by measured views rather than follower count, because followers
 * are what a creator claims and views are what their posts did. A creator
 * with no measured views sorts last rather than at zero — the two are
 * different facts, and the row renders "—" for the first.
 *
 * The videos are embedded in one request rather than fetched per creator: the
 * aggregate is computed here because Supabase disables PostgREST's aggregate
 * functions, and an N+1 over a leaderboard is worse than summing a few
 * hundred rows in memory.
 *
 * `limit` defaults high enough to cover the whole corpus, because the count
 * of returned rows is displayed as a total. A limit below the real number
 * would silently turn "how many creators are there" into "how many did we
 * ask for" — which is what it did at 200 against 313.
 */
export async function creatorLeaderboard(limit = 1000): Promise<LeaderboardCreator[]> {
  const supabase = await db();
  const { data, error } = await supabase
    .from("creators")
    .select("id, display_name, handle, platform, follower_count, discovered_videos(view_count, published_at, platform)")
    .limit(limit);

  if (error) throw new Error(`creatorLeaderboard: ${error.message}`);

  // supabase-js cannot infer an embedded relationship without generated
  // database types, so the row shape is stated here rather than inferred.
  type Embedded = { view_count: number | null; published_at: string | null;
                    platform: string | null };
  type Row = {
    id: string;
    display_name: string | null;
    handle: string | null;
    platform: string | null;
    follower_count: number | null;
    discovered_videos?: Embedded[];
  };

  const rows: LeaderboardCreator[] = ((data ?? []) as unknown as Row[]).map((row) => {
    // Filtered here rather than in the select: an embedded filter would drop
    // the creator row entirely, and a creator with only YouTube videos should
    // disappear from the leaderboard, not appear with a phantom zero.
    const videos = (row.discovered_videos ?? []).filter(
      (v) => v.platform !== null && (FEED_PLATFORMS as readonly string[]).includes(v.platform),
    );
    const measured = videos.filter((v) => typeof v.view_count === "number");
    const dates = videos.map((v) => v.published_at).filter(Boolean) as string[];

    return {
      id: row.id,
      display_name: row.display_name,
      handle: row.handle,
      platform: row.platform,
      follower_count: row.follower_count,
      video_count: videos.length,
      total_views: measured.length
        ? measured.reduce((sum, v) => sum + (v.view_count ?? 0), 0)
        : null,
      last_published_at: dates.length ? dates.sort().at(-1)! : null,
    };
  });

  // Creators we have discovered nothing for carry no signal at all; they are
  // rows in the corpus, not people who posted about a venue.
  return rows
    .filter((r) => r.video_count > 0)
    .sort((a, b) => {
      if (a.total_views === b.total_views) return b.video_count - a.video_count;
      if (a.total_views === null) return 1;
      if (b.total_views === null) return -1;
      return b.total_views - a.total_views;
    });
}

/** Newest discovered videos across every venue, for the Discover feed. */
export async function recentVideos(limit = 24): Promise<VideoRow[]> {
  const supabase = await db();
  const { data, error } = await supabase
    .from("discovered_videos")
    // One string literal, not a concatenation: supabase-js parses the select
    // at the TYPE level, and "a" + "b" widens to `string`, which collapses the
    // inferred row type to GenericStringError.
    .select("id, business_id, canonical_id, platform, url, title, view_count, like_count, comment_count, published_at, creator_handle, creator_display_name")
    .order("published_at", { ascending: false, nullsFirst: false })
    .limit(limit);

  if (error) throw new Error(`recentVideos: ${error.message}`);
  return data ?? [];
}

/**
 * Platforms the product actually cares about.
 *
 * YouTube is excluded deliberately. The harvest reached it because it is the
 * only source that yields to keyless tooling, but a five-minute segment from a
 * news channel is not the customer-filmed vertical video this product is
 * about, and showing it implies a supply that does not exist.
 *
 * Enforced in the query rather than the view, so a new page cannot
 * accidentally surface YouTube by forgetting to filter.
 *
 * Consequence, stated plainly: the corpus is 387 YouTube rows and nothing
 * else, so every feed filtered through this is empty until TikTok or
 * Instagram harvesting exists.
 */
export const FEED_PLATFORMS = ["tiktok", "instagram"] as const;

/** Videos for the Discover feed, newest first, with the venue they are about. */
export type FeedVideo = VideoRow & {
  thumbnail_url: string | null;
  duration_seconds: number | null;
  business_name: string | null;
  business_city: string | null;
};

export async function discoverFeed(limit = 60): Promise<FeedVideo[]> {
  const supabase = await db();
  const { data, error } = await supabase
    .from("discovered_videos")
    .select("id, business_id, canonical_id, platform, url, title, view_count, like_count, comment_count, published_at, creator_handle, creator_display_name, thumbnail_url, duration_seconds, businesses(name, city)")
    .in("platform", FEED_PLATFORMS as unknown as string[])
    .order("published_at", { ascending: false, nullsFirst: false })
    .limit(limit);

  if (error) throw new Error(`discoverFeed: ${error.message}`);

  type Row = Omit<FeedVideo, "business_name" | "business_city"> & {
    businesses?: { name: string | null; city: string | null } | null;
  };

  return ((data ?? []) as unknown as Row[]).map(({ businesses, ...v }) => ({
    ...v,
    business_name: businesses?.name ?? null,
    business_city: businesses?.city ?? null,
  }));
}

/**
 * How the discovered corpus splits by platform, counted from rows.
 *
 * Returned as counts rather than percentages: a share computed here would
 * hide how small some of these are, and "2 of 387" is a different claim from
 * "0.5%".
 */
export async function platformMix(): Promise<{ platform: string; count: number }[]> {
  const supabase = await db();
  const { data, error } = await supabase
    .from("discovered_videos")
    .select("platform")
    .in("platform", FEED_PLATFORMS as unknown as string[])
    .limit(5000);

  if (error) throw new Error(`platformMix: ${error.message}`);
  const tally = new Map<string, number>();
  for (const row of (data ?? []) as { platform: string | null }[]) {
    const key = row.platform ?? "unknown";
    tally.set(key, (tally.get(key) ?? 0) + 1);
  }
  return [...tally.entries()]
    .map(([platform, count]) => ({ platform, count }))
    .sort((a, b) => b.count - a.count);
}

/* ------------------------------------------------- tables nothing writes yet

   Each of these has a schema and zero rows. They are queried rather than
   stubbed so the page proves the read path works: when something finally
   writes a row, it appears without a code change. `count` is what the UI
   needs to tell "not built" apart from "filtered to nothing". */

export type TableState = { rows: number };

async function countOf(table: string): Promise<number> {
  const supabase = await db();
  const { count, error } = await supabase
    .from(table)
    .select("id", { count: "exact", head: true });
  // A missing table is a real error worth surfacing; an empty one is not.
  if (error) throw new Error(`${table}: ${error.message}`);
  return count ?? 0;
}

export type SubmissionRow = {
  id: string;
  business_id: string | null;
  user_id: string | null;
  campaign_id: string | null;
  video_url: string | null;
  source: string | null;
  status: string | null;
  category: string | null;
  created_at: string | null;
};

export async function submissions(limit = 50): Promise<SubmissionRow[]> {
  const supabase = await db();
  const { data, error } = await supabase
    .from("submissions")
    .select("id, business_id, user_id, campaign_id, video_url, source, status, category, created_at")
    .order("created_at", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) throw new Error(`submissions: ${error.message}`);
  return (data ?? []) as SubmissionRow[];
}

export type CampaignRow = {
  id: string;
  business_id: string | null;
  title: string | null;
  instructions: string | null;
  is_active: boolean | null;
  created_at: string | null;
};

export async function campaigns(limit = 50): Promise<CampaignRow[]> {
  const supabase = await db();
  const { data, error } = await supabase
    .from("campaigns")
    .select("id, business_id, title, instructions, is_active, created_at")
    .order("created_at", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) throw new Error(`campaigns: ${error.message}`);
  return (data ?? []) as CampaignRow[];
}

export type ContentItemRow = {
  id: string;
  business_id: string | null;
  title: string | null;
  creator_label: string | null;
  state: string | null;
  poster_url: string | null;
  video_url: string | null;
  source_platform: string | null;
  duration_seconds: number | null;
  view_count: number | null;
  like_count: number | null;
  times_used: number | null;
  created_at: string | null;
};

export async function contentItems(limit = 50): Promise<ContentItemRow[]> {
  const supabase = await db();
  const { data, error } = await supabase
    .from("content_items")
    .select("id, business_id, title, creator_label, state, poster_url, video_url, source_platform, duration_seconds, view_count, like_count, times_used, created_at")
    .order("created_at", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) throw new Error(`contentItems: ${error.message}`);
  return (data ?? []) as ContentItemRow[];
}

/** One round trip per table, run together. Used by pages that need to say
 *  which of several things is missing rather than a single blank screen. */
export async function tableCounts() {
  const [subs, camps, rewards, redemptions, content, cuts, events] =
    await Promise.all([
      countOf("submissions"), countOf("campaigns"), countOf("rewards"),
      countOf("reward_redemptions"), countOf("content_items"),
      countOf("editor_cuts"), countOf("activity_events"),
    ]);
  return { submissions: subs, campaigns: camps, rewards, redemptions,
           contentItems: content, editorCuts: cuts, activityEvents: events };
}

export type RewardRow = {
  id: string;
  business_id: string | null;
  title: string | null;
  reward_type: string | null;
  description: string | null;
  created_at: string | null;
};

export async function rewards(limit = 50): Promise<RewardRow[]> {
  const supabase = await db();
  const { data, error } = await supabase
    .from("rewards")
    .select("id, business_id, title, reward_type, description, created_at")
    .order("created_at", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) throw new Error(`rewards: ${error.message}`);
  return (data ?? []) as RewardRow[];
}

export type EditorCutRow = {
  id: string;
  business_id: string | null;
  title: string | null;
  state: string | null;
  clip_count: number | null;
  duration_seconds: number | null;
  poster_url: string | null;
  video_url: string | null;
  view_count: number | null;
  created_at: string | null;
};

export async function editorCuts(limit = 50): Promise<EditorCutRow[]> {
  const supabase = await db();
  const { data, error } = await supabase
    .from("editor_cuts")
    .select("id, business_id, title, state, clip_count, duration_seconds, poster_url, video_url, view_count, created_at")
    .order("created_at", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) throw new Error(`editorCuts: ${error.message}`);
  return (data ?? []) as EditorCutRow[];
}

export type ActivityEvent = {
  id: string;
  business_id: string | null;
  kind: string | null;
  actor_name: string | null;
  headline: string | null;
  detail: string | null;
  occurred_at: string | null;
};

/**
 * The live activity strip.
 *
 * Returns whatever the table holds, which today is nothing. The strip that
 * this replaced invented people sending clips and redeeming rewards, ticking
 * on a timer on every page — a fabricated feed that animates is read as a
 * working system, which is a worse lie than a static placeholder.
 */
export async function activityEvents(limit = 12): Promise<ActivityEvent[]> {
  const supabase = await db();
  const { data, error } = await supabase
    .from("activity_events")
    .select("id, business_id, kind, actor_name, headline, detail, occurred_at")
    .order("occurred_at", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) throw new Error(`activityEvents: ${error.message}`);
  return (data ?? []) as ActivityEvent[];
}

/** Total discovered videos. Split out so pages never build their own client. */
export async function videoCount(): Promise<number> {
  const supabase = await db();
  const { count, error } = await supabase
    .from("discovered_videos")
    .select("id", { count: "exact", head: true })
    .in("platform", FEED_PLATFORMS as unknown as string[]);
  if (error) throw new Error(`videoCount: ${error.message}`);
  return count ?? 0;
}

/* ------------------------------------------------------------- onboarding */

export type VenueSearchResult = {
  id: string;
  name: string;
  city: string | null;
  address: string | null;
  cuisine: string | null;
  website: string | null;
  instagram: string | null;
  tiktok: string | null;
  organic_brand_health_score: number | null;
  is_partner: boolean | null;
};

/**
 * Find a venue in the roster by name, for onboarding.
 *
 * This is the step the rest of the flow hangs off: a cafe signing up should
 * find itself already there, with its brand health computed, rather than
 * typing its own details into an empty form. 1,869 venues are seeded, so for
 * most of Orange County that lookup succeeds.
 *
 * Matching is a case-insensitive contains rather than full text search:
 * someone typing "coffee dose" should find "Coffee Dose", and Postgres FTS
 * would need an index and a tsquery for no gain at this size.
 */
export async function searchVenues(query: string, limit = 8): Promise<VenueSearchResult[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const supabase = await db();
  const { data, error } = await supabase
    .from("businesses")
    .select("id, name, city, address, cuisine, website, instagram, tiktok, organic_brand_health_score, is_partner")
    .ilike("name", `%${q}%`)
    .eq("lifecycle_status", "active")
    // Scored venues first: a cafe that finds itself WITH a score sees the
    // point of the product immediately.
    .order("organic_brand_health_score", { ascending: false, nullsFirst: false })
    .limit(limit);

  if (error) throw new Error(`searchVenues: ${error.message}`);
  return (data ?? []) as VenueSearchResult[];
}

/** One venue's prefilled profile for the claim step. */
export async function venueForClaim(id: string): Promise<RankedVenue | null> {
  return venueById(id);
}
