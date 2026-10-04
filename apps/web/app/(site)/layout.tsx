import { SiteBackground } from "@/components/site/SiteBackground";
import { SiteHeader } from "@/components/site/SiteHeader";

/* divvit.app — the marketing site. */
export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteBackground />
      <SiteHeader />
      {children}
    </>
  );
}
