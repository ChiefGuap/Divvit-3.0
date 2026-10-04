import type { Metadata } from "next";
import { createClient } from "@supabase/supabase-js";
import { marketplace } from "@/lib/urls";
import { money, num } from "@/lib/marketplace/format";
import type { Quote } from "@/lib/marketplace/types";
import { Reveal } from "@/components/site/Reveal";
import "./how.css";

export const metadata: Metadata = {
  title: "How it works",
  description: "Startups book coffee-sleeve campaigns across cafés in the neighborhoods they care about. Cafés earn from the cups they already serve.",
};
export const revalidate = 3600;

/* A real quote from the live pricing engine (mp_quote), so the example on
   this page is exactly what the checkout would show. */
async function exampleQuote(): Promise<Quote | null> {
  try {
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!);
    const { data: cafes } = await sb.from("mp_cafes").select("id").eq("city", "Austin").order("weekly_cups", { ascending: false }).limit(3);
    if (!cafes?.length) return null;
    const { data } = await sb.rpc("mp_quote", { p_cafe_ids: cafes.map((c) => c.id), p_sleeves: 1000, p_weeks: 6, p_branded: true });
    return data as Quote;
  } catch {
    return null;
  }
}

const STARTUP_STEPS = [
  { n: "01", t: "Tell us who you are", d: "Type your company name or website. If you're in the YC directory or have a public site, we fill in the basics — you just check them.", art: "form" },
  { n: "02", t: "Pick your neighborhoods", d: "Search a city or neighborhood and the map zooms in to the cafés there. Every café shows what kind of brands it welcomes.", art: "map" },
  { n: "03", t: "Design your sleeve", d: "Upload artwork or build one with our generator — logo, colours, tagline, a QR code — and see it on a 3D cup before you pay.", art: "cup" },
  { n: "04", t: "Check out per café", d: "No rate cards. Your quote lists every café and what it costs, like a checkout. Start the campaign and cafés get your offer.", art: "receipt" },
] as const;

const CAFE_STEPS = [
  { n: "01", t: "Set what you'll carry", d: "Choose the kinds of brands you're happy to hand to your regulars, and how many sleeves a month you'll put toward campaigns." },
  { n: "02", t: "Accept what fits", d: "Campaigns land in your inbox with the brand, the artwork and the payout. Accept the ones you like; pass on the rest." },
  { n: "03", t: "Serve, and get paid", d: "We ship printed sleeves; you use them on the cups you already serve. Optional branded drinks pay extra." },
] as const;

const FAQ = [
  { q: "What does a campaign cost?", a: "It depends on the cafés you pick — their neighborhood, how busy they are and how many sleeves you want — plus how long it runs and whether you add a branded drink. The marketplace prices every café live as you build your campaign, so you see the total before you commit." },
  { q: "Can I use my own design?", a: "Yes. Upload a finished sleeve design, or use the in-house generator to build one from your logo, colours and tagline. Either way you'll see it on a 3D cup first." },
  { q: "How do I know it worked?", a: "Add a QR code or promo code to the sleeve and every scan or redemption is traceable to the campaign. The checkout shows estimated reach and engagement up front, with the assumptions behind them." },
  { q: "Which cafés can I advertise in?", a: "Any café in the network that's open to your category. Cafés choose the kinds of brands they carry, and the map shows which ones are a match for you." },
  { q: "I run a café — what's in it for me?", a: "Revenue from cups you're already serving. You decide what you carry and how many sleeves you allocate, and you see the payout on every offer before you accept it." },
];

export default async function HowItWorks() {
  const quote = await exampleQuote();

  return (
    <main className="hiw">
      {/* ---------------- hero ---------------- */}
      <section className="hiw-hero">
        <Reveal><div className="hiw-eyebrow">How it works</div></Reveal>
        <Reveal delay={0.06}><h1>Your brand, in the hand of every <span className="hiw-grad">coffee drinker</span> nearby.</h1></Reveal>
        <Reveal delay={0.12}>
          <p className="hiw-sub">Divvit puts startups on the coffee sleeves of cafés in the neighborhoods they care about. Startups book a campaign in minutes. Cafés earn from the cups they already serve.</p>
        </Reveal>
        <Reveal delay={0.18}>
          <div className="hiw-ctas">
            <a className="divvit-plainsm lg" href={marketplace("/startups")}><span>Start a campaign</span></a>
            <a className="divvit-ghost lg" href={marketplace("/cafes")}>List your café</a>
          </div>
        </Reveal>
      </section>

      {/* ---------------- startups ---------------- */}
      <section className="hiw-section" id="startups">
        <Reveal><div className="hiw-kicker">For startups</div></Reveal>
        <Reveal delay={0.05}><h2>From sign-up to sleeves in four steps</h2></Reveal>
        <div className="hiw-steps">
          {STARTUP_STEPS.map((s, i) => (
            <Reveal key={s.n} delay={0.06 * i} className="hiw-step">
              <div className={`hiw-art hiw-art-${s.art}`} aria-hidden="true">
                {s.art === "form" && (
                  <div className="art-form">
                    <div className="art-field"><span>Company</span><b>Lumen</b></div>
                    <div className="art-field"><span>HQ</span><b>Austin, TX</b></div>
                    <div className="art-chip">✦ Filled from your website</div>
                  </div>
                )}
                {s.art === "map" && (
                  <div className="art-map">
                    {Array.from({ length: 22 }, (_, k) => (
                      <i key={k} style={{ left: `${(k * 37) % 88 + 6}%`, top: `${(k * 53) % 76 + 12}%` }} className={k % 3 === 0 ? "on" : ""} />
                    ))}
                    <div className="art-ring" />
                  </div>
                )}
                {s.art === "cup" && (
                  <div className="art-cup"><div className="art-cup-body"><div className="art-cup-sleeve">YOUR BRAND</div></div></div>
                )}
                {s.art === "receipt" && (
                  <div className="art-receipt">
                    {[["Café one", 58], ["Café two", 46], ["Café three", 64]].map(([n, w]) => (
                      <div key={n}><span>{n}</span><i style={{ width: `${w}px` }} /></div>
                    ))}
                    <div className="art-total"><span>Total</span><i style={{ width: "72px" }} /></div>
                  </div>
                )}
              </div>
              <div className="hiw-n">{s.n}</div>
              <h3>{s.t}</h3>
              <p>{s.d}</p>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ---------------- cafés ---------------- */}
      <section className="hiw-section hiw-band" id="cafes">
        <div className="hiw-band-inner">
          <div>
            <Reveal><div className="hiw-kicker">For cafés</div></Reveal>
            <Reveal delay={0.05}><h2>Earn from the cups you already serve</h2></Reveal>
            <Reveal delay={0.1}>
              <p className="hiw-lede">You stay in control: what you carry, how many sleeves, and every offer you accept.</p>
            </Reveal>
            <Reveal delay={0.15}><a className="divvit-plainsm lg" href={marketplace("/cafes")}><span>See what you could earn</span></a></Reveal>
          </div>
          <ol className="hiw-list">
            {CAFE_STEPS.map((s, i) => (
              <Reveal as="li" key={s.n} delay={0.08 * i}>
                <span className="hiw-n">{s.n}</span>
                <div><h3>{s.t}</h3><p>{s.d}</p></div>
              </Reveal>
            ))}
          </ol>
        </div>
      </section>

      {/* ---------------- pricing ---------------- */}
      <section className="hiw-section" id="pricing">
        <div className="hiw-pricing">
          <div>
            <Reveal><div className="hiw-kicker">Pricing</div></Reveal>
            <Reveal delay={0.05}><h2>A line per café, not a rate card</h2></Reveal>
            <Reveal delay={0.1}>
              <p className="hiw-lede">Every café is priced on its own, so you see exactly what you&apos;re buying. What goes into a café&apos;s price:</p>
            </Reveal>
            <Reveal delay={0.15}>
              <ul className="hiw-factors">
                <li><b>Neighborhood</b> — busier, pricier metros cost more to reach.</li>
                <li><b>Foot traffic</b> — how many cups the café serves a week.</li>
                <li><b>Sleeves &amp; length</b> — how many sleeves, over how many weeks.</li>
                <li><b>Branded drink</b> — optional: a drink named for you on the menu.</li>
                <li><b>Volume</b> — campaigns across 10+ cafés get a discount automatically.</li>
              </ul>
            </Reveal>
          </div>
          <Reveal delay={0.1} className="hiw-receipt">
            <div className="hiw-receipt-head">
              <span>Example quote</span>
              <small>3 Austin cafés · 1,000 sleeves each · 6 weeks · branded drink</small>
            </div>
            {quote ? (
              <>
                {quote.lines.map((l) => (
                  <div className="hiw-line" key={l.cafe_id}>
                    <div><b>{l.name}</b><small>{l.neighborhood} · {num(l.sleeves)} sleeves{l.branded_drink ? " · branded drink" : ""}</small></div>
                    <span>{money(l.price_cents)}</span>
                  </div>
                ))}
                <div className="hiw-line sub"><span>Service fee</span><span>{money(quote.fee_cents)}</span></div>
                <div className="hiw-line total"><span>Total</span><span>{money(quote.total_cents)}</span></div>
                <p className="hiw-note">Live from the marketplace&apos;s pricing engine, using sample cafés.</p>
              </>
            ) : (
              <p className="hiw-note">Open the marketplace to get a live quote.</p>
            )}
            <a className="divvit-plainsm" href={marketplace("/startups")}><span>Build your own quote</span></a>
          </Reveal>
        </div>
      </section>

      {/* ---------------- FAQ ---------------- */}
      <section className="hiw-section" id="faq">
        <Reveal><h2 className="hiw-center">Questions</h2></Reveal>
        <div className="hiw-faq">
          {FAQ.map((f, i) => (
            <Reveal key={f.q} delay={0.04 * i}>
              <details>
                <summary>{f.q}</summary>
                <p>{f.a}</p>
              </details>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ---------------- CTA ---------------- */}
      <section className="hiw-cta">
        <Reveal><h2>Ready to get on the cup?</h2></Reveal>
        <Reveal delay={0.06}>
          <div className="hiw-ctas">
            <a className="divvit-plainsm lg" href={marketplace("/startups")}><span>Start a campaign</span></a>
            <a className="divvit-ghost lg" href={marketplace("/cafes")}>Join as a café</a>
          </div>
        </Reveal>
      </section>
    </main>
  );
}
