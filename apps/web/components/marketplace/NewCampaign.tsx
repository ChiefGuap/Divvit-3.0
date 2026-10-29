"use client";

/* New campaign — one question per screen, prefilled from the startup's profile.
     where → how many cafés → sleeves → how long → branded drink → sleeve → review
   Prices come from the database (mp_quote); the sleeve is generated from the
   profile (name, one-liner, logo, website QR) and shown on the 3D cup. */

import Link from "next/link";
import { useRouter } from "next/navigation";
import React from "react";
import { useMp } from "./session";
import { useNetwork } from "./useNetwork";
import { AreaPicker, Choices, FlowBar, Question, useSteps } from "./flow";
import { Art, CheckIcon, Rings } from "./art";
import { CupMockup } from "./CupMockup";
import { downloadTemplate, newScanCode, renderSleeve, sleeveBase, type Brand, type SleeveChoice } from "@/lib/marketplace/design";
import { eligibleCafes, type Area } from "@/lib/marketplace/network";
import { SLEEVE_STOCKS } from "@/lib/cup/textures";
import { money, num, plural } from "@/lib/marketplace/format";
import { ROI_ASSUMPTIONS } from "@/lib/marketplace/roi";
import type { Quote } from "@/lib/marketplace/types";
import { campaignDraftKey } from "@/lib/marketplace/drafts";
import { site, SITE_URL } from "@/lib/urls";

type Startup = Brand & { id: string; category: string; areas: Area[] };
const STEPS = ["where", "count", "sleeves", "weeks", "drink", "sleeve", "review"] as const;
/** "Save & exit" keeps the answers on this device until the campaign launches */
type Draft = { i: number; areas: Area[]; count: number | null; sleeves: number | null; weeks: number | null; start: string; branded: boolean | null; stock: string;
  /** cafés hand-picked on the home page; when set they are the campaign, instead of the busiest N */
  cafeIds?: string[] | null };

const inTwoWeeks = () => {
  const d = new Date();
  d.setDate(d.getDate() + 14 + ((8 - d.getDay()) % 7));
  return d.toISOString().slice(0, 10);
};
const shortDate = (iso: string) => new Date(`${iso}T12:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });

export function NewCampaign() {
  const { supabase, user, profile, loading } = useMp();
  const router = useRouter();
  const cafes = useNetwork();
  const [startup, setStartup] = React.useState<Startup | null>(null);
  const steps = useSteps(STEPS.length);
  const i = steps.i;
  const [areas, setAreas] = React.useState<Area[]>([]);
  const [count, setCount] = React.useState<number | null>(null);
  const [chosen, setChosen] = React.useState<string[] | null>(null);
  const [sleeves, setSleeves] = React.useState<number | null>(null);
  const [weeks, setWeeks] = React.useState<number | null>(null);
  const [start, setStart] = React.useState(inTwoWeeks());
  const [branded, setBranded] = React.useState<boolean | null>(null);
  const [choice, setChoice] = React.useState<SleeveChoice>({ stock: "kraft", upload: null });
  const [design, setDesign] = React.useState<HTMLCanvasElement | null>(null);
  // the sleeve's QR link, divvit.app/s/<code>: scans are counted for the campaign report. Only on a
  // real (https) site address; a sleeve made in local dev links straight to the website instead
  const [scanCode] = React.useState(newScanCode);
  const scanUrl = SITE_URL.startsWith("https://") ? site(`/s/${scanCode}`) : undefined;
  const [quote, setQuote] = React.useState<Quote | null>(null);
  const [showLines, setShowLines] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState(false);
  const [restored, setRestored] = React.useState(false);
  const upload = React.useRef<HTMLInputElement>(null);
  const next = () => { setError(null); steps.next(); };
  const back = () => { setError(null); steps.back(); };

  // the saved profile drives everything
  React.useEffect(() => {
    if (loading) return;
    if (!user) { router.replace("/signin?next=/campaigns/new"); return; }
    if (profile?.role === "cafe") { router.replace("/cafes/inbox"); return; }
    supabase.from("mp_startups").select("id,name,description,website,logo_url,category,areas").eq("owner_id", user.id).order("created_at").limit(1).maybeSingle()
      .then(({ data }) => {
        if (!data) { router.replace("/start/startup"); return; }
        setStartup(data as Startup);
        setAreas((data.areas as Area[]) ?? []);
        try {
          const raw = localStorage.getItem(campaignDraftKey(user.id));
          if (raw) {
            const dr = JSON.parse(raw) as Draft;
            if (dr.areas?.length) setAreas(dr.areas);
            setCount(dr.count); setSleeves(dr.sleeves); setWeeks(dr.weeks); setBranded(dr.branded);
            if (dr.cafeIds?.length) setChosen(dr.cafeIds);
            if (dr.start && dr.start >= new Date().toISOString().slice(0, 10)) setStart(dr.start);
            if (dr.stock) setChoice({ stock: dr.stock as SleeveChoice["stock"], upload: null });
            steps.jump(Math.min(dr.i ?? 0, STEPS.indexOf("sleeve")));
          }
        } catch { /* start fresh */ }
        setRestored(true);
      });
  }, [loading, user, profile?.role, supabase, router]);

  const eligible = React.useMemo(() => (startup ? eligibleCafes(cafes, areas, startup.category) : []), [cafes, areas, startup]);
  const picked = React.useMemo(() => (chosen
    ? eligible.filter((c) => chosen.includes(c.id)).map((c) => c.id)
    : eligible.slice(0, Math.min(count ?? Math.min(10, eligible.length), eligible.length)).map((c) => c.id)), [eligible, chosen, count]);
  const n = picked.length;

  React.useEffect(() => {
    if (!restored || done || !user) return;
    if (i === 0 && count === null && sleeves === null && weeks === null && branded === null) return;  // nothing answered yet
    const dr: Draft = { i, areas, count, sleeves, weeks, start, branded, stock: choice.stock, cafeIds: chosen };
    try { localStorage.setItem(campaignDraftKey(user.id), JSON.stringify(dr)); } catch { /* ignore */ }
  }, [restored, done, user, i, areas, count, sleeves, weeks, start, branded, choice.stock, chosen]);

  // live price for the current answers
  const key = `${picked.join(",")}|${sleeves ?? 1000}|${weeks ?? 4}|${branded ?? false}`;
  React.useEffect(() => {
    if (!picked.length) { setQuote(null); return; }
    let stale = false;
    const t = setTimeout(async () => {
      const { data } = await supabase.rpc("mp_quote", { p_cafe_ids: picked, p_sleeves: sleeves ?? 1000, p_weeks: weeks ?? 4, p_branded: branded ?? false });
      if (!stale) setQuote(data as Quote);
    }, 200);
    return () => { stale = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, supabase]);

  // the sleeve, regenerated when they change the stock or upload artwork
  React.useEffect(() => {
    if (!startup || i < 5) return;
    let stale = false;
    renderSleeve(startup, choice, scanUrl).then((c) => { if (!stale) setDesign(c); }).catch(() => {});
    return () => { stale = true; };
  }, [startup, choice, i, scanUrl]);

  async function launch() {
    if (!startup || !quote) return;
    setBusy(true); setError(null);
    try {
      let designUrl: string | null = null;
      if (design) {
        const blob = await new Promise<Blob | null>((res) => design.toBlob(res, "image/png"));
        if (blob) {
          const path = `${user!.id}/${Date.now()}-sleeve.png`;
          const { error } = await supabase.storage.from("mp-sleeve-designs").upload(path, blob, { contentType: "image/png" });
          if (error) throw error;
          designUrl = supabase.storage.from("mp-sleeve-designs").getPublicUrl(path).data.publicUrl;
        }
      }
      // remember where they like to be seen
      await supabase.from("mp_startups").update({ areas }).eq("id", startup.id);
      const { error } = await supabase.rpc("mp_submit_campaign", {
        p_startup_id: startup.id, p_name: `${startup.name} · ${areas.map((a) => a.label.split(",")[0]).join(", ")}`,
        p_cafe_ids: picked, p_sleeves: sleeves ?? 1000, p_weeks: weeks ?? 4, p_branded: branded ?? false, p_start_date: start,
        p_design: { stock: choice.stock, uploaded: Boolean(choice.upload), ...(scanUrl && startup.website && !choice.upload ? { scan_code: scanCode } : {}) },
        p_design_url: designUrl,
        p_locations: areas.map(({ label, bbox }) => ({ label, bbox })),
        p_roi: { impressions: Math.round((quote.lines.reduce((s, l) => s + l.sleeves, 0)) * ROI_ASSUMPTIONS.impressionsPerSleeve) },
      });
      if (error) throw error;
      try { localStorage.removeItem(campaignDraftKey(user!.id)); } catch { /* ignore */ }
      // let the Divvit team know (the database already queued the email; this sends it)
      fetch("/api/campaigns/notify", { method: "POST" }).catch(() => {});
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong — try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!startup) return <FlowBar />;
  if (done) {
    return (
      <>
        <FlowBar progress={1} />
        <Question title="You're all set" sub="Someone from the Divvit team will reach out to you within 24 hours."
          cta="Go to home" onContinue={() => router.push("/home#campaigns")}>
          <div className="mp-done"><CheckIcon /></div>
          <p className="mp-note" style={{ textAlign: "center" }}>You haven&apos;t been charged. Once we approve your campaign, we&apos;ll email you and let you know on your dashboard — then you pay and it goes to your {plural(picked.length, "café")}.</p>
        </Question>
      </>
    );
  }

  const step = STEPS[i];
  const totalSleeves = quote ? quote.lines.reduce((s, l) => s + l.sleeves, 0) : picked.length * (sleeves ?? 1000);
  const price = quote ? money(quote.total_cents, { cents: true }) : "—";
  const exact = (c: number) => money(c, { cents: true });

  return (
    <>
      <FlowBar progress={(i + 1) / STEPS.length} right={<Link href="/home" className="mp-link">Save & exit</Link>} />
      <div key={step} className={steps.stage}>
        {step === "where" && (
          <Question title="Where should this campaign run?" sub="We've started with the places on your profile." wide
            onContinue={next} canContinue={eligible.length > 0}>
            <AreaPicker areas={areas} onChange={(a) => { setAreas(a); setCount(null); setChosen(null); }} cafes={cafes} category={startup.category} />
          </Question>
        )}

        {step === "count" && chosen && (
          <Question title="Your cafés" sub="You picked these on your home page." onBack={back} onContinue={next} canContinue={n > 0}>
            <div className="mp-stepper"><b>{n}<span>{n === 1 ? "café" : "cafés"}</span></b></div>
            <p className="mp-note" style={{ textAlign: "center" }}>About {price} so far · <button type="button" className="mp-link accent" onClick={() => setChosen(null)}>Let Divvit pick the busiest instead</button></p>
          </Question>
        )}

        {step === "count" && !chosen && (
          <Question title="How many cafés?" sub="We'll start with the busiest ones." onBack={back} onContinue={next}>
            <div className="mp-stepper">
              <button type="button" disabled={n <= 1} onClick={() => setCount(Math.max(1, n - 1))}>−</button>
              <b>{n}<span>{n === 1 ? "café" : "cafés"}</span></b>
              <button type="button" disabled={n >= eligible.length} onClick={() => setCount(Math.min(eligible.length, n + 1))}>+</button>
            </div>
            <p className="mp-note" style={{ textAlign: "center" }}>{num(eligible.length)} available · about {price} so far</p>
          </Question>
        )}

        {step === "sleeves" && (
          <Question title="How many sleeves at each café?" onBack={back} onContinue={next} canContinue={sleeves !== null}>
            <Choices cols={2} center value={sleeves} onChange={(v) => { setSleeves(v); setTimeout(next, 220); }}
              options={([500, 1000, 2000, 3000] as const).map((v, k) => ({ value: v as number, label: num(v), hint: `≈ ${num(v * ROI_ASSUMPTIONS.impressionsPerSleeve)} people see it`, art: <Rings level={(k + 1) as 1 | 2 | 3 | 4} /> }))} />
          </Question>
        )}

        {step === "weeks" && (
          <Question title="How long should it run?" sub={`Starting ${shortDate(start)}`} onBack={back} onContinue={next} canContinue={weeks !== null}>
            <Choices cols={4} center value={weeks} onChange={(v) => setWeeks(v)}
              options={[2, 4, 6, 8].map((v) => ({ value: v, label: String(v), hint: "weeks", art: <Art name="calendar" /> }))} />
            <label className="mp-note" style={{ display: "flex", alignItems: "center", gap: 10 }}>
              Start date
              <input className="mp-input" style={{ width: 180, height: 40 }} type="date" value={start} min={new Date().toISOString().slice(0, 10)} onChange={(e) => setStart(e.target.value || inTwoWeeks())} />
            </label>
          </Question>
        )}

        {step === "drink" && (
          <Question title="Add a branded drink?" sub="Cafés that offer it put your drink on the menu for the campaign." onBack={back} onContinue={next} canContinue={branded !== null}>
            <Choices cols={1} value={branded} onChange={(v) => { setBranded(v); setTimeout(next, 220); }} options={[
              { value: true, label: `Yes — “The ${startup.name} Latte”`, art: <Art name="soda" /> },
              { value: false, label: "No, just sleeves", art: <Art name="coffee" /> },
            ]} />
          </Question>
        )}

        {step === "sleeve" && (
          <Question title="Here's your sleeve" sub="Made from your profile. Pick a color, or upload your own." onBack={back} onContinue={next} canContinue={Boolean(design)} wide>
            <CupMockup design={design} base={sleeveBase(choice)} hint />
            {!choice.upload && (
              <div className="mp-swatches">
                {SLEEVE_STOCKS.map((s) => (
                  <button key={s.id} type="button" aria-label={s.label} title={s.label} className={`mp-swatch${choice.stock === s.id ? " on" : ""}`}
                    style={{ background: `linear-gradient(135deg, ${s.base} 60%, ${s.ink} 60%)` }} onClick={() => setChoice({ stock: s.id, upload: null })} />
                ))}
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "center", gap: 16 }}>
              {choice.upload
                ? <button type="button" className="mp-link accent" onClick={() => setChoice({ ...choice, upload: null })}>Use the generated one</button>
                : <button type="button" className="mp-link accent" onClick={() => upload.current?.click()}>Upload your own design</button>}
              <button type="button" className="mp-link" onClick={downloadTemplate}>Download template</button>
            </div>
            {error && <div className="mp-error">{error}</div>}
            <input ref={upload} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";  // picking the same file again should still work
              if (!f) return;
              if (f.size > 8 * 1024 * 1024) { setError("That file is over 8 MB — export a smaller PNG or JPG."); return; }
              setError(null);
              const r = new FileReader();
              r.onload = () => setChoice({ ...choice, upload: String(r.result) });
              r.readAsDataURL(f);
            }} />
          </Question>
        )}

        {step === "review" && (
          <Question title="Ready to send?" sub="The Divvit team reviews every campaign before it goes to cafés." onBack={back} cta="Send for review"
            onContinue={launch} canContinue={Boolean(quote)} busy={busy}>
            <div className="mp-summary">
              <div className="row"><span>Where</span><b>{areas.map((a) => a.label.split(",")[0]).join(", ")}</b></div>
              <div className="row"><span>Cafés</span><b>{num(picked.length)}</b></div>
              <div className="row"><span>Sleeves</span><b>{num(totalSleeves)}</b></div>
              <div className="row"><span>When</span><b>{shortDate(start)} · {plural(weeks ?? 4, "week")}</b></div>
              <div className="row"><span>Branded drink</span><b>{branded ? "Yes" : "No"}</b></div>
              <div className="row"><span>People who&apos;ll see it</span><b>≈ {num(totalSleeves * ROI_ASSUMPTIONS.impressionsPerSleeve)}</b></div>
              {quote && quote.discount_cents > 0 && <div className="row"><span>Volume discount</span><b style={{ color: "#1f9d63" }}>−{exact(quote.discount_cents)}</b></div>}
              <div className="row total"><span>Projected price</span><b>{price}</b></div>
            </div>
            {quote && (
              <>
                <button type="button" className="mp-link" style={{ alignSelf: "flex-start" }} onClick={() => setShowLines((s) => !s)}>
                  {showLines ? "Hide" : "See"} price for each café
                </button>
                {showLines && (
                  <div className="mp-lines">
                    {quote.lines.map((l) => (
                      <div key={l.cafe_id}><span>{l.name}<small>{[l.neighborhood, `${num(l.sleeves)} sleeves`].filter(Boolean).join(" · ")}</small></span><b>{exact(l.price_cents)}</b></div>
                    ))}
                    {quote.discount_cents > 0 && <div><span>Volume discount</span><b style={{ color: "#1f9d63" }}>−{exact(quote.discount_cents)}</b></div>}
                    <div><span>Service fee</span><b>{exact(quote.fee_cents)}</b></div>
                    <div className="total"><span>Total</span><b>{exact(quote.total_cents)}</b></div>
                  </div>
                )}
              </>
            )}
            {quote && quote.lines.some((l) => l.is_demo) && (
              <div className="mp-found"><span>
                {quote.lines.every((l) => l.is_demo)
                  ? (quote.lines.length === 1 ? "This is a sample café" : "These are all sample cafés")
                  : plural(quote.lines.filter((l) => l.is_demo).length, "of these is a sample café", "of these are sample cafés")}.
                {" "}Sample cafés show what&apos;s possible in this area but can&apos;t run campaigns. The Divvit team will match you with real cafés nearby, and you only ever pay for real ones.
              </span></div>
            )}
            <p className="mp-note">You won&apos;t be charged now. The Divvit team confirms the final price, then you pay on your dashboard and we send the campaign to your cafés.</p>
            {error && <div className="mp-error">{error}</div>}
          </Question>
        )}
      </div>
    </>
  );
}
