import type { Metadata } from "next";
import { SiteBackground } from "@/components/site/SiteBackground";
import { MpHeader } from "@/components/marketplace/MpHeader";
import { MpSessionProvider } from "@/components/marketplace/session";
import "./marketplace.css";

export const metadata: Metadata = {
  title: { default: "Marketplace", template: "%s · Divvit Marketplace" },
  description: "Book coffee-sleeve campaigns across cafés in the neighborhoods you care about — or earn from the cups your café already serves.",
};

/* marketplace.divvit.app — middleware rewrites that host onto /marketplace/*. */
export default function MarketplaceLayout({ children }: { children: React.ReactNode }) {
  return (
    <MpSessionProvider>
      <SiteBackground />
      <MpHeader />
      <div className="mp">{children}</div>
    </MpSessionProvider>
  );
}
