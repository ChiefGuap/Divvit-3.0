import Link from "next/link";
import { createClient } from "@supabase/supabase-js";
import { NetworkMap } from "@/components/marketplace/NetworkMap";
import { CAFE_COLUMNS, type Cafe } from "@/lib/marketplace/types";
import { num } from "@/lib/marketplace/format";

export const revalidate = 300;

async function network() {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!);
  const { data } = await sb.from("mp_cafes").select(CAFE_COLUMNS);
  return (data as Cafe[]) ?? [];
}

export default async function MarketplaceHome() {
  const cafes = await network();
  const cities = new Set(cafes.map((c) => c.city)).size;
  const sleeves = cafes.reduce((s, c) => s + c.sleeves_per_month, 0);
  const demo = cafes.some((c) => c.is_demo);

  return (
    <div className="mp-page">
      <section className="mp-hero">
        <div className="mp-eyebrow">The Divvit Marketplace</div>
        <h1>Coffee cups, meet the brands<br />your neighborhood should know.</h1>
        <p>Startups book sleeve campaigns across cafés in the neighborhoods they care about. Cafés earn from the cups they already serve.</p>
      </section>

      <div className="mp-paths">
        <div className="mp-path startup">
          <span className="k">I&apos;m a startup</span>
          <h2>Get your brand into thousands of hands</h2>
          <ul>
            <li>Autofill your company in seconds</li>
            <li>Pick neighborhoods on a live map</li>
            <li>See your sleeve on a 3D cup before you pay</li>
            <li>Per-café pricing, checkout-style</li>
          </ul>
          <Link href="/startups" className="divvit-plainsm lg go"><span>Start a campaign</span></Link>
        </div>
        <div className="mp-path cafe">
          <span className="k" style={{ color: "var(--brand-primary)" }}>I run a café</span>
          <h2>Earn from cups you already serve</h2>
          <ul style={{ color: "var(--text-secondary)" }}>
            <li>Choose the kinds of brands you carry</li>
            <li>Decide how many sleeves you allocate</li>
            <li>Accept or pass on every offer</li>
            <li>See your potential monthly revenue now</li>
          </ul>
          <Link href="/cafes" className="divvit-plainsm lg go"><span>Join Divvit</span></Link>
        </div>
      </div>

      <div className="mp-network">
        <div className="mp-card pad mp-netstats">
          <h3>The network</h3>
          <div className="mp-roi" style={{ gridTemplateColumns: "1fr" }}>
            <div className="mp-stat"><span>Cafés</span><b>{num(cafes.length)}</b></div>
            <div className="mp-stat"><span>Cities</span><b>{num(cities)}</b></div>
            <div className="mp-stat"><span>Sleeves available / month</span><b>{num(sleeves)}</b></div>
          </div>
          {demo && <span className="mp-demo-badge">Sample network · demo café listings</span>}
        </div>
        <NetworkMap cafes={cafes} />
      </div>
    </div>
  );
}
