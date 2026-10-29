import type { Metadata } from "next";
import { MpSessionProvider } from "@/components/marketplace/session";
import "./marketplace.css";

export const metadata: Metadata = {
  title: { default: "Marketplace", template: "%s · Divvit Marketplace" },
  description: "Put your brand on coffee cups in the neighborhoods you care about — or earn from the cups your café already serves.",
};

/* marketplace.divvit.app — middleware rewrites that host onto /marketplace/*.
   Each page brings its own (minimal) top bar. The marketplace is set in Google
   Sans (the main site keeps its own fonts), so it's loaded here, not in the root layout. */
export default function MarketplaceLayout({ children }: { children: React.ReactNode }) {
  return (
    <MpSessionProvider>
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Google+Sans:ital,wght@0,400..700;1,400..700&display=swap" precedence="default" />
      <div className="mp">{children}</div>
    </MpSessionProvider>
  );
}
