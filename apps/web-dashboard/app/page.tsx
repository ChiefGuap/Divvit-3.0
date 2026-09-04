/* Dashboard home — server half. */

import { coverage, discoverFeed, leadVenue, tableCounts } from "@/lib/queries";
import HomeView from "./HomeView";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const [venue, videos, counts, tables] = await Promise.all([
    leadVenue(), discoverFeed(8), coverage(), tableCounts(),
  ]);

  return (
    <HomeView
      venue={venue}
      videos={videos}
      counts={counts}
      submissionCount={tables.submissions}
    />
  );
}
