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
  const [venues, ranked, videos] = await Promise.all([
    supabase.from("businesses").select("id", { count: "exact", head: true }).eq("lifecycle_status", "active"),
    supabase.from("brand_health_snapshots").select("id", { count: "exact", head: true }).eq("rankable", true),
    supabase.from("discovered_videos").select("id", { count: "exact", head: true }),
  ]);
  return {
    activeVenues: venues.count ?? 0,
    rankedVenues: ranked.count ?? 0,
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
export function orDash(n: number | null | undefined, digits = 0): string {
  return n === null || n === undefined ? "—" : n.toFixed(digits);
}

export function compactCount(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
