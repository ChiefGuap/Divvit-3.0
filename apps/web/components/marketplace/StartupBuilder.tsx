"use client";

/* Startup side of the marketplace: build a coffee-sleeve campaign.
     1 Company    — basic info, autofilled from the YC directory / their website
     2 Locations  — pick cities or neighborhoods; the map zooms to them
     3 Campaign   — how many cafés, sleeves, weeks, branded drink; live price + ROI
     4 Design     — generator or upload, previewed on a 3D cup
     5 Checkout   — a line per café, then "Start a campaign"
   The draft is saved on this device as you go. Prices come from mp_quote(). */

import Link from "next/link";
import React from "react";
import { useMp } from "./session";
import { CafeMap } from "./CafeMap";
import { CupMockup } from "./CupMockup";
import { PlaceSearch, type Place } from "./PlaceSearch";
import { Range } from "./Range";
import { AuthPanel } from "./AuthPanel";
import { SleeveDesigner, defaultDesign, renderDesign, type DesignState } from "./SleeveDesigner";
import { proxied } from "@/lib/marketplace/images";
import { CATEGORIES, cafeAccepts, categoryLabel, guessCategory } from "@/lib/marketplace/categories";
import { estimateRoi, ROI_ASSUMPTIONS } from "@/lib/marketplace/roi";
import { money, num, plural } from "@/lib/marketplace/format";
import { CAFE_COLUMNS, type Cafe, type Quote } from "@/lib/marketplace/types";

const STEPS = ["Company", "Locations", "Campaign", "Design", "Checkout"] as const;
const FUNDING = ["Bootstrapped", "Pre-seed", "Seed", "Series A", "Series B", "Series C+", "Public / later stage"];
const DRAFT_KEY = "divvit.mp.startup-draft.v1";

type BBox = [number, number, number, number];
type Company = {
  name: string; website: string; hq: string; funding_stage: string; funding_total: string;
  description: string; category: string; logo_url: string | null; source: string[];
};
type Area = { id: string; label: string; bbox: BBox };
type Draft = {
  step: number; company: Company; areas: Area[]; cafeCount: number; picked: string[] | null;
  sleeves: number; weeks: number; start: string; branded: boolean; design: DesignState;
  campaignName: string; roiSignup: number; roiValue: number; startupId?: string;
};

type YcMatch = { name: string; domain: string; website: string; hq: string; oneLiner: string; description: string; logo: string; batch: string; industry: string; tags: string[]; url: string };
type SiteMeta = { website: string; domain: string; name: string; description: string; logo: string };
type Enrichment = { name: string; hq: string; fundingTotal: number | null; fundingStage: string; description: string; industry: string } | null;

const nextMonday = () => {
  const d = new Date();
  d.setDate(d.getDate() + 14 + ((8 - d.getDay()) % 7));
  return d.toISOString().slice(0, 10);
};

const emptyDraft = (): Draft => ({
  step: 0,
  company: { name: "", website: "", hq: "", funding_stage: "", funding_total: "", description: "", category: "tech", logo_url: null, source: [] },
  areas: [], cafeCount: 10, picked: null, sleeves: 1000, weeks: 6, start: nextMonday(), branded: false,
  design: defaultDesign(), campaignName: "", roiSignup: 0.2, roiValue: 100,
});

const inBox = (c: Cafe, [w, s, e, n]: BBox) => {
  const px = (e - w) * 0.15, py = (n - s) * 0.15;   // a little slack around the searched area
  return c.lng >= w - px && c.lng <= e + px && c.lat >= s - py && c.lat <= n + py;
};
const unionBox = (boxes: BBox[]): BBox | null => boxes.length
  ? [Math.min(...boxes.map((b) => b[0])), Math.min(...boxes.map((b) => b[1])), Math.max(...boxes.map((b) => b[2])), Math.max(...boxes.map((b) => b[3]))]
  : null;
const fmtMoneyShort = (usd: number) => (usd >= 1000 ? `$${(usd / 1000).toFixed(usd >= 10000 ? 0 : 1)}k` : `$${Math.round(usd)}`);

export function StartupBuilder() {
  const { supabase, user, profile, ensureProfile } = useMp();
  const [draft, setDraft] = React.useState<Draft>(emptyDraft);
  const [hydrated, setHydrated] = React.useState(false);
  const [cafes, setCafes] = React.useState<Cafe[]>([]);
  const [quote, setQuote] = React.useState<Quote | null>(null);
  const [quoting, setQuoting] = React.useState(false);
  const [designCanvas, setDesignCanvas] = React.useState<HTMLCanvasElement | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [submitError, setSubmitError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState<{ id: string; total: number; cafes: number } | null>(null);

  const patch = React.useCallback((p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p })), []);
  const patchCompany = (p: Partial<Company>) => setDraft((d) => ({ ...d, company: { ...d.company, ...p } }));

  /* ---------- draft persistence ---------- */
  React.useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) setDraft({ ...emptyDraft(), ...JSON.parse(raw) });
    } catch { /* private mode / bad JSON — start fresh */ }
    setHydrated(true);
  }, []);
  React.useEffect(() => {
    if (!hydrated) return;
    const t = setTimeout(() => {
      try { localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); }
      catch { try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...draft, design: { ...draft.design, upload: null } })); } catch { /* full */ } }
    }, 300);
    return () => clearTimeout(t);
  }, [draft, hydrated]);

  /* ---------- the network ---------- */
  React.useEffect(() => {
    supabase.from("mp_cafes").select(CAFE_COLUMNS).then(({ data }) => setCafes((data as Cafe[]) ?? []));
  }, [supabase]);

  const { company, areas } = draft;
  const inAreas = React.useMemo(() => cafes.filter((c) => c.sleeves_per_month > 0 && areas.some((a) => inBox(c, a.bbox))), [cafes, areas]);
  const eligible = React.useMemo(() => inAreas.filter((c) => cafeAccepts(c, company.category)), [inAreas, company.category]);
  const eligibleIds = React.useMemo(() => new Set(eligible.map((c) => c.id)), [eligible]);
  const isEligible = React.useCallback((c: Cafe) => eligibleIds.has(c.id) || (!areas.length && cafeAccepts(c, company.category)), [eligibleIds, areas.length, company.category]);

  const selectedIds = React.useMemo(() => {
    if (draft.picked) return draft.picked.filter((id) => eligibleIds.has(id));
    return [...eligible].sort((a, b) => b.weekly_cups - a.weekly_cups).slice(0, draft.cafeCount).map((c) => c.id);
  }, [draft.picked, draft.cafeCount, eligible, eligibleIds]);
  const selected = React.useMemo(() => new Set(selectedIds), [selectedIds]);

  const toggleCafe = (id: string) => {
    if (!eligibleIds.has(id)) return;
    const cur = new Set(selectedIds);
    if (cur.has(id)) cur.delete(id); else cur.add(id);
    patch({ picked: [...cur], cafeCount: Math.max(1, cur.size) });
  };

  /* ---------- live quote (server-side pricing) ---------- */
  const quoteKey = `${selectedIds.join(",")}|${draft.sleeves}|${draft.weeks}|${draft.branded}`;
  React.useEffect(() => {
    if (!selectedIds.length) { setQuote(null); return; }
    let stale = false;
    setQuoting(true);
    const t = setTimeout(async () => {
      const { data, error } = await supabase.rpc("mp_quote", { p_cafe_ids: selectedIds, p_sleeves: draft.sleeves, p_weeks: draft.weeks, p_branded: draft.branded });
      if (!stale) { setQuote(error ? null : (data as Quote)); setQuoting(false); }
    }, 250);
    return () => { stale = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quoteKey, supabase]);

  const totalSleeves = quote ? quote.lines.reduce((s, l) => s + l.sleeves, 0) : selectedIds.length * draft.sleeves;
  const roi = estimateRoi({ totalSleeves, totalCents: quote?.total_cents ?? 0, signupRate: draft.roiSignup, customerValue: draft.roiValue });

  /* ---------- sleeve design → canvas ---------- */
  React.useEffect(() => {
    if (draft.step < 3) return;
    let stale = false;
    const t = setTimeout(() => {
      renderDesign(draft.design).then((c) => { if (!stale) setDesignCanvas(c); }).catch(() => {});
    }, 220);
    return () => { stale = true; clearTimeout(t); };
  }, [draft.design, draft.step]);

  const goTo = (step: number) => {
    // seed the generator from the company the first time they reach Design
    if (step >= 3 && !draft.design.headline) {
      patch({ design: { ...draft.design, ...defaultDesign(company.name, company.description.split(/[.!]/)[0].slice(0, 60), company.website, proxied(company.logo_url)),
        mode: draft.design.mode, upload: draft.design.upload } });
    }
    patch({ step });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const canAdvance = [
    company.name.trim().length > 0 && Boolean(company.category),
    selectedIds.length > 0,
    selectedIds.length > 0 && Boolean(quote),
    Boolean(designCanvas),
    true,
  ];

  const cities = React.useMemo(() => {
    const m = new Map<string, { n: number; box: BBox }>();
    for (const c of cafes) {
      const cur = m.get(c.city);
      if (!cur) m.set(c.city, { n: 1, box: [c.lng, c.lat, c.lng, c.lat] });
      else { cur.n++; cur.box = [Math.min(cur.box[0], c.lng), Math.min(cur.box[1], c.lat), Math.max(cur.box[2], c.lng), Math.max(cur.box[3], c.lat)]; }
    }
    return [...m.entries()].sort((a, b) => b[1].n - a[1].n);
  }, [cafes]);

  /* ---------- submit ---------- */
  async function submit() {
    setSubmitting(true); setSubmitError(null);
    try {
      await ensureProfile("startup");
      const { data: { user: u } } = await supabase.auth.getUser();
      if (!u) throw new Error("Sign in to start the campaign.");

      const upload = async (blob: Blob, name: string) => {
        const path = `${u.id}/${Date.now()}-${name}`;
        const { error } = await supabase.storage.from("mp-sleeve-designs").upload(path, blob, { contentType: blob.type, upsert: false });
        if (error) throw error;
        return supabase.storage.from("mp-sleeve-designs").getPublicUrl(path).data.publicUrl;
      };
      const dataUrlToBlob = async (d: string) => (await fetch(d)).blob();

      let logoUrl = company.logo_url;
      if (logoUrl?.startsWith("data:")) logoUrl = await upload(await dataUrlToBlob(logoUrl), "logo.png");

      const row = {
        name: company.name.trim(), website: company.website.trim() || null, hq: company.hq.trim() || null,
        funding_stage: company.funding_stage || null, funding_total: company.funding_total.trim() || null,
        description: company.description.trim() || null, category: company.category, logo_url: logoUrl,
        autofill_source: company.source.length ? { sources: company.source } : null,
      };
      let startupId = draft.startupId;
      if (startupId) {
        const { error } = await supabase.from("mp_startups").update(row).eq("id", startupId);
        if (error) startupId = undefined;
      }
      if (!startupId) {
        const { data, error } = await supabase.from("mp_startups").insert(row).select("id").single();
        if (error) throw error;
        startupId = data.id as string;
        patch({ startupId });
      }

      let designUrl: string | null = null;
      if (designCanvas) {
        const blob = await new Promise<Blob | null>((res) => designCanvas.toBlob(res, "image/png"));
        if (blob) designUrl = await upload(blob, "sleeve.png");
      }
      const { upload: _u, logo: _l, ...designMeta } = draft.design;

      const { data: campaignId, error } = await supabase.rpc("mp_submit_campaign", {
        p_startup_id: startupId,
        p_name: draft.campaignName || `${company.name} · ${areas.map((a) => a.label.split(",")[0]).join(", ") || "Sleeve campaign"}`,
        p_cafe_ids: selectedIds, p_sleeves: draft.sleeves, p_weeks: draft.weeks, p_branded: draft.branded,
        p_start_date: draft.start || null,
        p_design: { ...designMeta, logo_url: logoUrl },
        p_design_url: designUrl,
        p_locations: areas.map(({ label, bbox }) => ({ label, bbox })),
        p_roi: { impressions: Math.round(roi.impressions), engagements_mid: Math.round(roi.engagements.mid), assumptions: ROI_ASSUMPTIONS },
      });
      if (error) throw error;
      setDone({ id: campaignId as string, total: quote?.total_cents ?? 0, cafes: selectedIds.length });
      try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "Something went wrong — try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="mp-page mp-narrow">
        <div className="mp-card mp-success">
          <div className="tick">✓</div>
          <h2 className="mp-title" style={{ marginTop: 0 }}>Your campaign is live in {plural(done.cafes, "café")}&apos; inboxes</h2>
          <p className="mp-lede" style={{ textAlign: "center" }}>
            Each café accepts or passes on your offer. We&apos;ll print your sleeves for the cafés that accept, and you can follow every response from your campaigns page.
          </p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center", marginTop: 8 }}>
            <Link href="/startups/campaigns" className="divvit-plainsm lg"><span>See my campaigns</span></Link>
            <button className="divvit-ghost lg" onClick={() => { setDone(null); setDraft({ ...emptyDraft(), company, startupId: draft.startupId }); }}>Start another</button>
          </div>
        </div>
      </div>
    );
  }

  const step = draft.step;
  const focus = unionBox(areas.map((a) => a.bbox));
  const anyDemo = cafes.some((c) => c.is_demo);
  const addArea = (a: Area) => {
    if (areas.some((x) => x.id === a.id)) return;
    patch({ areas: [...areas, a], picked: null });
  };

  return (
    <div className="mp-page">
      <div className="mp-eyebrow">For startups</div>
      <h1 className="mp-title">Put your brand on coffee cups</h1>
      <p className="mp-lede">Pick the neighborhoods, design the sleeve, check out per café. Cafés in the network get your offer the moment you start.</p>

      <div className="mp-stepper">
        {STEPS.map((s, i) => (
          <button key={s} className={`${i === step ? "on" : ""} ${i < step ? "done" : ""}`}
            disabled={i > step && !canAdvance.slice(0, i).every(Boolean)} onClick={() => goTo(i)}>
            <i>{i < step ? "✓" : i + 1}</i>{s}
          </button>
        ))}
      </div>

      {/* ============ 1 · Company ============ */}
      {step === 0 && (
        <div className="mp-builder">
          <div className="mp-panel">
            <Autofill onFill={(c) => patchCompany(c)} />
            <div className="mp-card pad">
              <h3>About your startup</h3>
              {company.source.length > 0 && (
                <div className="mp-source">✦ Filled from <b>{company.source.join(" + ")}</b> — check everything below.</div>
              )}
              <div className="mp-logo-row">
                {company.logo_url ? <img src={proxied(company.logo_url)!} alt="" style={{ objectFit: "contain", background: "#fff" }} /> : <span className="mp-logo-ph">{(company.name || "?")[0]}</span>}
                <LogoPicker onPick={(d) => patchCompany({ logo_url: d })} hasLogo={Boolean(company.logo_url)} onClear={() => patchCompany({ logo_url: null })} />
              </div>
              <div className="mp-grid2">
                <label className="mp-field"><span>Startup name *</span><input className="mp-input" value={company.name} onChange={(e) => patchCompany({ name: e.target.value })} placeholder="Lumen" /></label>
                <label className="mp-field"><span>Website</span><input className="mp-input" value={company.website} onChange={(e) => patchCompany({ website: e.target.value })} placeholder="https://lumen.ai" /></label>
                <label className="mp-field"><span>Headquarters</span><input className="mp-input" value={company.hq} onChange={(e) => patchCompany({ hq: e.target.value })} placeholder="Austin, TX" /></label>
                <label className="mp-field"><span>What you do *</span>
                  <select className="mp-select" value={company.category} onChange={(e) => patchCompany({ category: e.target.value })}>
                    {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                  </select>
                </label>
                <label className="mp-field"><span>Funding stage <small>(if any)</small></span>
                  <select className="mp-select" value={company.funding_stage} onChange={(e) => patchCompany({ funding_stage: e.target.value })}>
                    <option value="">Prefer not to say</option>
                    {FUNDING.map((f) => <option key={f}>{f}</option>)}
                  </select>
                </label>
                <label className="mp-field"><span>Total raised <small>(optional)</small></span><input className="mp-input" value={company.funding_total} onChange={(e) => patchCompany({ funding_total: e.target.value })} placeholder="$2.5M" /></label>
              </div>
              <label className="mp-field"><span>In a sentence or two, what does it do?</span>
                <textarea className="mp-textarea" value={company.description} maxLength={1200} onChange={(e) => patchCompany({ description: e.target.value })} placeholder="AI meeting notes that write themselves." />
                <small>Cafés see this when your offer lands in their inbox.</small>
              </label>
            </div>
          </div>
          <div className="mp-side">
            <div className="mp-card pad">
              <h3>Why we ask</h3>
              <p className="mp-small mp-muted" style={{ margin: 0, lineHeight: 1.6 }}>
                Cafés choose what kinds of brands they hand to their regulars. Your category decides which cafés you can book; your description is what they read before they accept.
              </p>
              <div className="mp-chips">{CATEGORIES.map((c) => <span key={c.id} className={`mp-chip${c.id === company.category ? " on" : ""}`} onClick={() => patchCompany({ category: c.id })}>{c.label}</span>)}</div>
            </div>
          </div>
        </div>
      )}

      {/* ============ 2 · Locations ============ */}
      {step === 1 && (
        <div className="mp-builder">
          <div className="mp-panel">
            <div className="mp-card pad">
              <h3>Where should people see you?</h3>
              <PlaceSearch autoFocus placeholder="Search a city or neighborhood — e.g. Williamsburg, Austin, the Mission"
                onPick={(p: Place) => addArea({ id: p.id, label: p.label, bbox: p.bbox })} />
              {areas.length > 0 && (
                <div className="mp-chips">
                  {areas.map((a) => (
                    <button key={a.id} className="mp-chip on" onClick={() => patch({ areas: areas.filter((x) => x.id !== a.id), picked: null })}>
                      {a.label.split(",").slice(0, 2).join(",")} <span className="x">×</span>
                    </button>
                  ))}
                </div>
              )}
              <div className="mp-field">
                <span className="mp-label">Cities in the network</span>
                <div className="mp-chips">
                  {cities.map(([city, { n, box }]) => (
                    <button key={city} className="mp-chip" onClick={() => addArea({ id: `city:${city}`, label: city, bbox: box })}>
                      {city} <small>{n}</small>
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="mp-card pad">
              <div className="mp-roi">
                <div className="mp-stat"><span>Cafés in your areas</span><b>{num(inAreas.length)}</b></div>
                <div className="mp-stat"><span>Open to {categoryLabel(company.category).toLowerCase()}</span><b>{num(eligible.length)}</b></div>
              </div>
              {areas.length > 0 && eligible.length === 0 && (
                <p className="mp-small mp-muted" style={{ margin: 0 }}>No cafés here carry {categoryLabel(company.category).toLowerCase()} yet. Try a nearby neighborhood or another city.</p>
              )}
              {anyDemo && <span className="mp-demo-badge">Sample network · cafés shown are demo listings</span>}
            </div>
          </div>
          <div className="mp-side">
            <CafeMap cafes={cafes} selected={selected} isEligible={isEligible} areas={areas} focus={focus} onToggle={toggleCafe} />
          </div>
        </div>
      )}

      {/* ============ 3 · Campaign ============ */}
      {step === 2 && (
        <div className="mp-builder">
          <div className="mp-panel">
            <div className="mp-card pad">
              <h3>Campaign preferences</h3>
              <Range label="Cafés in this campaign" value={Math.min(selectedIds.length || draft.cafeCount, Math.max(1, eligible.length))} min={1} max={Math.max(1, eligible.length)}
                onChange={(v) => patch({ cafeCount: v, picked: null })} format={(v) => plural(v, "café")} />
              <Range label="Sleeves per café" value={draft.sleeves} min={250} max={3000} step={50} onChange={(v) => patch({ sleeves: v })} format={(v) => num(v)} />
              <Range label="Campaign length" value={draft.weeks} min={1} max={12} onChange={(v) => patch({ weeks: v })} format={(v) => plural(v, "week")} />
              <div className="mp-grid2">
                <label className="mp-field"><span>Start date</span><input className="mp-input" type="date" value={draft.start} min={new Date().toISOString().slice(0, 10)} onChange={(e) => patch({ start: e.target.value })} /></label>
                <div className="mp-field"><span>Total sleeves</span><div className="mp-input" style={{ background: "transparent" }}>{num(totalSleeves)}</div></div>
              </div>
              <label className="mp-toggle">
                <input type="checkbox" checked={draft.branded} onChange={(e) => patch({ branded: e.target.checked })} />
                <span className="sw" />
                <span><b>Add a branded drink</b><small>Cafés that offer it put “The {company.name || "Your Brand"} Latte” on the menu for the campaign. Priced per café, per week.</small></span>
              </label>
            </div>
            <div className="mp-card pad">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <h3>Your cafés</h3>
                {draft.picked ? <button className="mp-filebtn" onClick={() => patch({ picked: null })}>Reset to busiest</button> : <span className="mp-small mp-muted">Busiest matches first</span>}
              </div>
              <div className="mp-cafelist">
                {[...eligible].sort((a, b) => Number(selected.has(b.id)) - Number(selected.has(a.id)) || b.weekly_cups - a.weekly_cups).map((c) => (
                  <label key={c.id}>
                    <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggleCafe(c.id)} />
                    <span>{c.name}</span>
                    <small>{c.neighborhood} · ~{num(c.weekly_cups)} cups/wk</small>
                  </label>
                ))}
                {!eligible.length && <p className="mp-small mp-muted">Add a location first.</p>}
              </div>
            </div>
          </div>
          <div className="mp-side mp-panel">
            <CafeMap cafes={cafes} selected={selected} isEligible={isEligible} areas={areas} focus={focus} onToggle={toggleCafe} className="short" />
            <RoiCard roi={roi} quote={quote} quoting={quoting} draft={draft} patch={patch} />
          </div>
        </div>
      )}

      {/* ============ 4 · Design ============ */}
      {step === 3 && (
        <div className="mp-builder">
          <div className="mp-panel">
            <SleeveDesigner value={draft.design} onChange={(design) => patch({ design })} />
          </div>
          <div className="mp-side mp-panel">
            <CupMockup design={designCanvas} base={draft.design.mode === "upload" ? "#e9e2d6" : draft.design.base} />
            {draft.branded && (
              <div className="mp-card pad" style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
                <span className="mp-logo-ph" style={{ width: 46, height: 46, fontSize: 22 }}>☕</span>
                <div><b>The {draft.design.headline || company.name || "Your Brand"} Latte</b><div className="mp-small mp-muted">On the menu at cafés that offer branded drinks</div></div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ============ 5 · Checkout ============ */}
      {step === 4 && (
        <div className="mp-builder wide-left">
          <div className="mp-panel">
            <div className="mp-receipt">
              <div className="mp-receipt-head">
                <h3>Your campaign</h3>
                <span className="mp-small mp-muted">{plural(selectedIds.length, "café")} · {plural(draft.weeks, "week")} · from {new Date(draft.start + "T12:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
              </div>
              {quote ? (
                <>
                  <div className="mp-lines">
                    {quote.lines.map((l) => (
                      <div className="mp-line" key={l.cafe_id}>
                        <div><b>{l.name}</b><small>{[l.neighborhood, l.city].filter(Boolean).join(", ")} · {num(l.sleeves)} sleeves{l.branded_drink ? " · branded drink" : ""}</small></div>
                        <span>{money(l.price_cents)}</span>
                      </div>
                    ))}
                  </div>
                  <div className="mp-line sub"><span>Subtotal</span><span>{money(quote.subtotal_cents)}</span></div>
                  {quote.discount_cents > 0 && <div className="mp-line sub discount"><span>Volume discount ({Math.round(quote.discount_rate * 100)}%)</span><span>−{money(quote.discount_cents)}</span></div>}
                  <div className="mp-line sub"><span>Service fee</span><span>{money(quote.fee_cents)}</span></div>
                  <div className="mp-line total"><span>Total</span><span>{money(quote.total_cents)}</span></div>
                  <p className="mp-small mp-muted" style={{ margin: "4px 0 0" }}>Includes printing and delivery of your sleeves. Cafés that pass on your offer aren&apos;t charged.</p>
                </>
              ) : (
                <p className="mp-muted">{quoting ? "Pricing your cafés…" : "Pick at least one café to see your quote."}</p>
              )}
            </div>
            <label className="mp-field"><span>Campaign name</span>
              <input className="mp-input" value={draft.campaignName} onChange={(e) => patch({ campaignName: e.target.value })}
                placeholder={`${company.name || "Your startup"} · ${areas.map((a) => a.label.split(",")[0]).join(", ") || "Sleeve campaign"}`} />
            </label>
          </div>
          <div className="mp-side mp-panel">
            <CupMockup design={designCanvas} base={draft.design.mode === "upload" ? "#e9e2d6" : draft.design.base} className="small" hint={false} />
            <div className="mp-card pad">
              <div className="mp-roi">
                <div className="mp-stat"><span>Est. impressions</span><b>{num(roi.impressions)}</b></div>
                <div className="mp-stat"><span>Est. engagements</span><b>{num(roi.engagements.low)}–{num(roi.engagements.high)}</b></div>
              </div>
              {user ? (
                <>
                  {profile?.role === "cafe" && <p className="mp-small mp-muted" style={{ margin: 0 }}>You&apos;re signed in with a café account — the campaign will be created under it.</p>}
                  {submitError && <div className="mp-error">{submitError}</div>}
                  <button className="divvit-plainsm lg" disabled={submitting || !quote} onClick={submit}>
                    <span>{submitting ? "Starting your campaign…" : `Start a campaign · ${quote ? money(quote.total_cents) : ""}`}</span>
                  </button>
                  <p className="mp-small mp-muted" style={{ margin: 0 }}>Offers go to each café now. Nothing is charged until cafés accept.</p>
                </>
              ) : (
                <AuthPanel role="startup" title="Create your account to start" intro="Your campaign is saved on this device — sign up or sign in and you're one click from launch." />
              )}
            </div>
          </div>
        </div>
      )}

      {/* ============ summary bar ============ */}
      <div className="mp-sumbar">
        <div className="mp-sumbar-stats">
          <div>Cafés<b>{num(selectedIds.length)}</b></div>
          <div>Sleeves<b>{num(totalSleeves)}</b></div>
          <div>Length<b>{plural(draft.weeks, "wk")}</b></div>
          <div>Total<b>{quote ? money(quote.total_cents) : "—"}</b></div>
        </div>
        <div className="mp-sumbar-actions">
          {step > 0 && <button className="divvit-ghost" onClick={() => goTo(step - 1)}>Back</button>}
          {step < STEPS.length - 1 && (
            <button className="divvit-plainsm" disabled={!canAdvance[step]} onClick={() => goTo(step + 1)}>
              <span>{["Pick locations", "Set preferences", "Design your sleeve", "Review & check out"][step]}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- autofill */

function Autofill({ onFill }: { onFill: (c: Partial<Company>) => void }) {
  const [q, setQ] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [res, setRes] = React.useState<{ matches: YcMatch[]; website: SiteMeta | null; enrichment: Enrichment; pdlEnabled: boolean } | null>(null);
  const [open, setOpen] = React.useState(false);
  const [msg, setMsg] = React.useState<string | null>(null);

  const run = React.useCallback(async (query: string) => {
    if (query.trim().length < 2) return null;
    setBusy(true);
    try {
      const r = await fetch(`/api/lookup?q=${encodeURIComponent(query.trim())}`);
      return await r.json();
    } finally { setBusy(false); }
  }, []);

  React.useEffect(() => {
    if (q.trim().length < 2) { setRes(null); return; }
    const t = setTimeout(async () => { const data = await run(q); if (data) { setRes(data); setOpen(true); } }, 350);
    return () => clearTimeout(t);
  }, [q, run]);

  const fromYc = async (m: YcMatch) => {
    setOpen(false);
    const site = m.website ? await run(m.website) : null;
    const meta: SiteMeta | null = site?.website ?? null;
    const enr: Enrichment = site?.enrichment ?? null;
    const sources = ["Y Combinator directory", ...(meta ? [meta.domain] : []), ...(enr ? ["People Data Labs"] : [])];
    onFill({
      name: m.name, website: m.website, hq: enr?.hq || m.hq.split(";")[0],
      description: blurb(m.oneLiner, m.description || meta?.description || ""),
      category: guessCategory(m.industry, m.tags.join(" "), m.oneLiner),
      logo_url: m.logo || meta?.logo || null,
      funding_total: enr?.fundingTotal ? `$${(enr.fundingTotal / 1e6).toFixed(1)}M` : "",
      funding_stage: enr?.fundingStage ? stageFromPdl(enr.fundingStage) : "",
      source: sources,
    });
    setMsg(`Backed by Y Combinator (${m.batch}). Add your funding stage if you'd like cafés to see it.`);
  };

  const fromSite = (meta: SiteMeta, enr: Enrichment) => {
    setOpen(false);
    onFill({
      name: enr?.name || meta.name, website: meta.website, description: enr?.description || meta.description,
      hq: enr?.hq || "", logo_url: meta.logo, category: guessCategory(enr?.industry, meta.description, meta.name),
      funding_total: enr?.fundingTotal ? `$${(enr.fundingTotal / 1e6).toFixed(1)}M` : "",
      funding_stage: enr?.fundingStage ? stageFromPdl(enr.fundingStage) : "",
      source: [meta.domain, ...(enr ? ["People Data Labs"] : [])],
    });
    setMsg(enr ? null : "We read your website. HQ and funding aren't public there — fill them in below.");
  };

  return (
    <div className="mp-card pad">
      <h3>Autofill from your company</h3>
      <p className="mp-small mp-muted" style={{ margin: 0 }}>Type your startup&apos;s name or website. We check the Y Combinator directory and your own site{res?.pdlEnabled ? ", plus People Data Labs for funding" : ""}.</p>
      <div className="mp-suggest">
        <div className="mp-autofill">
          <input className="mp-input" value={q} onChange={(e) => setQ(e.target.value)} onFocus={() => res && setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 160)}
            placeholder="e.g. Linear or linear.app" />
          <button className="divvit-plainsm" disabled={busy || q.trim().length < 2}
            onClick={async () => { const d = await run(q); if (d) { setRes(d); if (d.website) fromSite(d.website, d.enrichment); else if (d.matches?.[0]) fromYc(d.matches[0]); else setMsg("We couldn't find that company — fill in the details below."); } }}>
            <span>{busy ? "Looking…" : "Autofill"}</span>
          </button>
        </div>
        {open && res && (res.matches.length > 0 || res.website) && (
          <div className="mp-suggest-list">
            {res.website && (
              <button onMouseDown={(e) => e.preventDefault()} onClick={() => fromSite(res.website!, res.enrichment)}>
                <img src={proxied(res.website.logo)!} alt="" />
                <span><b>{res.website.name || res.website.domain}</b><small>From {res.website.domain}</small></span>
              </button>
            )}
            {res.matches.map((m) => (
              <button key={m.url} onMouseDown={(e) => e.preventDefault()} onClick={() => fromYc(m)}>
                {m.logo ? <img src={proxied(m.logo)!} alt="" /> : <span className="mp-logo-ph">{m.name[0]}</span>}
                <span><b>{m.name}</b><small>{m.oneLiner || m.industry} · {m.hq.split(";")[0]} · YC {m.batch}</small></span>
              </button>
            ))}
          </div>
        )}
      </div>
      {res && !busy && q.trim().length >= 2 && res.matches.length === 0 && !res.website && !msg && (
        <p className="mp-small mp-muted" style={{ margin: 0 }}>No match in the YC directory — try your website (e.g. yourstartup.com), or fill in the details below.</p>
      )}
      {msg && <p className="mp-small" style={{ margin: 0, color: "var(--text-secondary)" }}>{msg}</p>}
    </div>
  );
}

/** A short blurb for cafés: the one-liner plus the opening sentence or two. */
function blurb(oneLiner: string, long: string, max = 280) {
  const head = oneLiner.trim().replace(/[.\s]+$/, "");
  const text = long.replace(/\s+/g, " ").trim();
  let body = "";
  for (const sentence of text.match(/[^.!?]+[.!?]+/g) ?? (text ? [text] : [])) {
    if ((head.length + body.length + sentence.length) > max) break;
    body += sentence;
  }
  return [head && `${head}.`, body.trim()].filter(Boolean).join(" ").slice(0, max + 40);
}

function stageFromPdl(s: string) {
  const v = s.toLowerCase();
  if (v.includes("pre")) return "Pre-seed";
  if (v.includes("seed")) return "Seed";
  if (v.includes("series_a")) return "Series A";
  if (v.includes("series_b")) return "Series B";
  if (v.includes("series")) return "Series C+";
  if (v.includes("ipo") || v.includes("public")) return "Public / later stage";
  return "";
}

function LogoPicker({ onPick, onClear, hasLogo }: { onPick: (dataUrl: string) => void; onClear: () => void; hasLogo: boolean }) {
  const input = React.useRef<HTMLInputElement>(null);
  return (
    <>
      <button className="mp-filebtn" onClick={() => input.current?.click()}>{hasLogo ? "Replace logo" : "Upload logo"}</button>
      {hasLogo && <button className="mp-filebtn" onClick={onClear}>Remove</button>}
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => {
        const f = e.target.files?.[0];
        if (!f || f.size > 4 * 1024 * 1024) return;
        const r = new FileReader();
        r.onload = () => onPick(String(r.result));
        r.readAsDataURL(f);
      }} />
    </>
  );
}

/* ---------------------------------------------------------------- ROI */

function RoiCard({ roi, quote, quoting, draft, patch }: {
  roi: ReturnType<typeof estimateRoi>; quote: Quote | null; quoting: boolean; draft: Draft; patch: (p: Partial<Draft>) => void;
}) {
  return (
    <div className="mp-card pad">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h3>Potential return</h3>
        <span className="mp-small mp-muted">{quoting ? "Updating…" : quote ? `${money(quote.total_cents)} total` : ""}</span>
      </div>
      <div className="mp-roi">
        <div className="mp-stat hero"><span>Est. return on spend</span><b>{roi.roiMultiple ? `${roi.roiMultiple.toFixed(1)}×` : "—"}</b>
          <small>{num(roi.customers)} new customers × ${draft.roiValue} ≈ {fmtMoneyShort(roi.revenue)}</small></div>
        <div className="mp-stat"><span>Impressions</span><b>{num(roi.impressions)}</b><small>{ROI_ASSUMPTIONS.impressionsPerSleeve} per sleeve</small></div>
        <div className="mp-stat"><span>Engagements</span><b>{num(roi.engagements.mid)}</b><small>range {num(roi.engagements.low)}–{num(roi.engagements.high)}</small></div>
        <div className="mp-stat"><span>Cost / 1k impressions</span><b>{roi.cpm ? `$${roi.cpm.toFixed(2)}` : "—"}</b></div>
        <div className="mp-stat"><span>Cost / engagement</span><b>{roi.costPerEngagement ? `$${roi.costPerEngagement.toFixed(2)}` : "—"}</b></div>
      </div>
      <Range label="Engagements that become customers" value={Math.round(draft.roiSignup * 100)} min={1} max={60} onChange={(v) => patch({ roiSignup: v / 100 })} format={(v) => `${v}%`} />
      <Range label="What a customer is worth to you" value={draft.roiValue} min={5} max={1000} step={5} onChange={(v) => patch({ roiValue: v })} format={(v) => `$${v}`} />
      <p className="mp-assume">Estimates, not promises. We assume {ROI_ASSUMPTIONS.impressionsPerSleeve} people see each sleeve and {ROI_ASSUMPTIONS.scanRateLow * 100}–{ROI_ASSUMPTIONS.scanRateHigh * 100}% of sleeves get a QR scan or promo-code use; the last two numbers are yours to set.</p>
    </div>
  );
}
