import { CampaignReport } from "@/components/marketplace/CampaignReport";

export const metadata = { title: "Campaign report" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CampaignReport id={id} />;
}
