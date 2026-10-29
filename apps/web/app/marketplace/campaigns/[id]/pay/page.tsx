import { Suspense } from "react";
import { CampaignPay } from "@/components/marketplace/CampaignPay";

export const metadata = { title: "Pay for your campaign" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Suspense><CampaignPay id={id} /></Suspense>;
}
