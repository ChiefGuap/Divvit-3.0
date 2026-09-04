/* Rewards — server half. */

import { rewards, tableCounts } from "@/lib/queries";
import RewardsView from "./RewardsView";

export const dynamic = "force-dynamic";

export default async function RewardsPage() {
  const [list, counts] = await Promise.all([rewards(), tableCounts()]);
  return <RewardsView rewards={list} redemptionCount={counts.redemptions} />;
}
