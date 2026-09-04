/* Discover — server half: count and fetch, then hand measured rows to the view. */

import { coverage, discoverFeed, platformMix } from "@/lib/queries";
import DiscoverView from "./DiscoverView";

export const dynamic = "force-dynamic";

export default async function DiscoverPage() {
  const [videos, mix, counts] = await Promise.all([
    discoverFeed(120),
    platformMix(),
    coverage(),
  ]);

  const venuesWithVideos = new Set(
    videos.map((v) => v.business_id).filter(Boolean),
  ).size;

  return (
    <DiscoverView
      videos={videos}
      mix={mix}
      venueCount={venuesWithVideos}
      videoTotal={counts.videos}
    />
  );
}
