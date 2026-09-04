/* Campaigns — server half. */

import { campaigns } from "@/lib/queries";
import CampaignsView from "./CampaignsView";

export const dynamic = "force-dynamic";

export default async function CampaignsPage() {
  return <CampaignsView campaigns={await campaigns()} />;
}
