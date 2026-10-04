"use client";

/* Café side: set preferences, see what you could earn, join the network.
   Signed-in cafés with a listing get the same form to edit it. */

import Link from "next/link";
import { useRouter } from "next/navigation";
import React from "react";
import { useMp } from "./session";
import { AuthPanel } from "./AuthPanel";
import { PlaceSearch, type Place } from "./PlaceSearch";
import { Range } from "./Range";
import { CATEGORIES } from "@/lib/marketplace/categories";
import { marketTier } from "@/lib/marketplace/markets";
import { money, num } from "@/lib/marketplace/format";
import type { Cafe } from "@/lib/marketplace/types";

type Form = {
  name: string; address: string | null; neighborhood: string | null; city: string; region: string | null;
  lat: number | null; lng: number | null; weekly_cups: number; sleeves_per_month: number;
  accepted: string[]; blocked: string[]; branded: boolean;
};
type Tier = { fill: number; sleeves_booked: number; sleeve_payout_cents: number; drink_payout_cents: number };
type Estimate = { low: Tier; typical: Tier; high: Tier };

const KEY = "divvit.mp.cafe-draft.v1";
const empty: Form = { name: "", address: null, neighborhood: null, city: "", region: null, lat: null, lng: null,
  weekly_cups: 1500, sleeves_per_month: 2000, accepted: [], blocked: ["crypto"], branded: true };
const total = (t?: Tier) => (t ? t.sleeve_payout_cents + t.drink_payout_cents : 0);

export function CafeJoin() {
  const { supabase, user, profile, loading, ensureProfile } = useMp();
  const router = useRouter();
  const [form, setForm] = React.useState<Form>(empty);
  const [listing, setListing] = React.useState<Cafe | null>(null);
  const [est, setEst] = React.useState<Estimate | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);
  const set = (p: Partial<Form>) => { setForm((f) => ({ ...f, ...p })); setSaved(false); };

  React.useEffect(() => {
    try { const raw = localStorage.getItem(KEY); if (raw) setForm({ ...empty, ...JSON.parse(raw) }); } catch { /* fresh */ }
  }, []);
  React.useEffect(() => {
    if (listing) return;
    try { localStorage.setItem(KEY, JSON.stringify(form)); } catch { /* ignore */ }
  }, [form, listing]);

  // a signed-in café edits its existing listing
  React.useEffect(() => {
    if (!user) { setListing(null); return; }
    supabase.rpc("mp_my_cafe").then(({ data }) => {
      const c = data as Cafe | null;
      setListing(c);
      if (c) setForm({ name: c.name, address: c.address, neighborhood: c.neighborhood, city: c.city, region: c.region, lat: c.lat, lng: c.lng,
        weekly_cups: c.weekly_cups, sleeves_per_month: c.sleeves_per_month, accepted: c.accepted_categories, blocked: c.blocked_categories, branded: c.branded_drinks });
    });
  }, [user, supabase]);

  const maxSleeves = Math.max(500, Math.round((form.weekly_cups * 4.33) / 50) * 50);
  React.useEffect(() => { if (form.sleeves_per_month > maxSleeves) set({ sleeves_per_month: maxSleeves }); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [maxSleeves]);

  // live estimate from the same pricing engine startups are charged by
  React.useEffect(() => {
    const t = setTimeout(async () => {
      const { data } = await supabase.rpc("mp_estimate_payout", {
        p_sleeves_month: form.sleeves_per_month, p_weekly_cups: form.weekly_cups, p_market_tier: marketTier(form.city), p_branded: form.branded,
      });
      setEst(data as Estimate);
    }, 200);
    return () => clearTimeout(t);
  }, [form.sleeves_per_month, form.weekly_cups, form.city, form.branded, supabase]);

  const toggle = (list: "accepted" | "blocked", id: string) => {
    const cur = new Set(form[list]);
    if (cur.has(id)) cur.delete(id); else cur.add(id);
    const other = list === "accepted" ? "blocked" : "accepted";
    set({ [list]: [...cur], [other]: form[other].filter((x) => x !== id) } as Partial<Form>);
  };

  const ready = form.name.trim() && form.lat != null && form.lng != null && form.city;

  async function save() {
    setBusy(true); setError(null);
    try {
      await ensureProfile("cafe");
      const { data: { user: u } } = await supabase.auth.getUser();
      if (!u) throw new Error("Sign in first.");
      const row = {
        name: form.name.trim(), address: form.address, neighborhood: form.neighborhood, city: form.city, region: form.region,
        lat: form.lat, lng: form.lng, market_tier: marketTier(form.city), weekly_cups: form.weekly_cups,
        sleeves_per_month: form.sleeves_per_month, accepted_categories: form.accepted, blocked_categories: form.blocked, branded_drinks: form.branded,
      };
      if (listing) {
        const { error } = await supabase.from("mp_cafes").update(row).eq("id", listing.id);
        if (error) throw error;
        setSaved(true);
      } else {
        const { error } = await supabase.from("mp_cafes").insert({ ...row, owner_id: u.id });
        if (error) throw error;
        try { localStorage.removeItem(KEY); } catch { /* ignore */ }
        router.push("/cafes/inbox");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save your café — try again.");
    } finally {
      setBusy(false);
    }
  }

  const typical = total(est?.typical);

  return (
    <div className="mp-page">
      <div className="mp-eyebrow">For cafés</div>
      <h1 className="mp-title">{listing ? "Your café listing" : "Earn from the cups you already serve"}</h1>
      <p className="mp-lede">
        {listing ? "Changes apply to new offers. Your inbox shows every campaign that's picked you."
          : "Tell us about your café and the brands you're happy to carry. Startups book you; you accept what fits and get paid."}
      </p>

      <div className="mp-builder wide-left" style={{ marginTop: 24 }}>
        <div className="mp-panel">
          <div className="mp-card pad">
            <h3>Your café</h3>
            <label className="mp-field"><span>Café name</span><input className="mp-input" value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="Juniper Coffee" /></label>
            <div className="mp-field">
              <span>Address</span>
              <PlaceSearch mode="address" placeholder="Start typing your street address"
                onPick={(p: Place) => set({ address: p.address ?? p.name, neighborhood: p.neighborhood, city: p.city ?? p.name, region: p.region, lat: p.lat, lng: p.lng })} />
              {form.lat != null && <small>📍 {[form.address, form.neighborhood, form.city, form.region].filter(Boolean).join(", ")}</small>}
            </div>
          </div>

          <div className="mp-card pad">
            <h3>Preferences</h3>
            <Range label="Cups you serve in a typical week" value={form.weekly_cups} min={100} max={5000} step={50} onChange={(v) => set({ weekly_cups: v })} format={(v) => num(v)} />
            <Range label="Sleeves per month you'd put toward campaigns" value={Math.min(form.sleeves_per_month, maxSleeves)} min={0} max={maxSleeves} step={50}
              onChange={(v) => set({ sleeves_per_month: v })} format={(v) => num(v)} hint={`≈ ${num(form.weekly_cups * 4.33)} cups/mo`} />
            <div className="mp-field">
              <span>Brands you welcome</span>
              <small>{form.accepted.length ? "Only these categories can book you." : "Open to every category — pick some to narrow it down."}</small>
              <div className="mp-chips">
                {CATEGORIES.map((c) => <button key={c.id} className={`mp-chip${form.accepted.includes(c.id) ? " on" : ""}`} onClick={() => toggle("accepted", c.id)}>{c.label}</button>)}
              </div>
            </div>
            <div className="mp-field">
              <span>Never show</span>
              <div className="mp-chips">
                {CATEGORIES.map((c) => <button key={c.id} className={`mp-chip block${form.blocked.includes(c.id) ? " on" : ""}`} onClick={() => toggle("blocked", c.id)}>{c.label}</button>)}
              </div>
            </div>
            <label className="mp-toggle">
              <input type="checkbox" checked={form.branded} onChange={(e) => set({ branded: e.target.checked })} />
              <span className="sw" />
              <span><b>Open to branded drinks</b><small>Put a startup&apos;s drink on your menu during their campaign, for an extra weekly payout.</small></span>
            </label>
          </div>
        </div>

        <div className="mp-side mp-panel">
          <div className="mp-earn">
            <span className="k">Potential monthly revenue</span>
            <div className="amount">{est ? money(typical) : "—"}<small> / month</small></div>
            <div className="range">{est ? `Range ${money(total(est.low))} – ${money(total(est.high))} · about ${money(typical * 12)} a year` : "Calculating…"}</div>
            {est && (
              <div className="mp-earn-rows">
                <div><span>Sleeves booked ({Math.round(est.typical.fill * 100)}% of {num(form.sleeves_per_month)})</span><b>{money(est.typical.sleeve_payout_cents)}</b></div>
                {form.branded && <div><span>Branded drink</span><b>{money(est.typical.drink_payout_cents)}</b></div>}
              </div>
            )}
            <p>Estimate from Divvit&apos;s live pricing: what startups pay to reach your neighborhood and foot traffic, at a typical booking rate. Actual revenue depends on the campaigns you accept.</p>
          </div>

          {loading ? null : user ? (
            <div className="mp-card pad">
              {profile?.role === "startup" && !listing && <p className="mp-small mp-muted" style={{ margin: 0 }}>You&apos;re signed in with a startup account; the café will be added to it.</p>}
              {error && <div className="mp-error">{error}</div>}
              {saved && <div className="mp-ok">Saved.</div>}
              <button className="divvit-plainsm lg" disabled={!ready || busy} onClick={save}>
                <span>{busy ? "Saving…" : listing ? "Save changes" : "Join Divvit"}</span>
              </button>
              {!ready && <p className="mp-small mp-muted" style={{ margin: 0 }}>Add your café&apos;s name and address to continue.</p>}
              {listing && <Link className="divvit-ghost" href="/cafes/inbox">Go to inbox</Link>}
            </div>
          ) : (
            <AuthPanel role="cafe" title="Join Divvit" intro="Create your café account — your preferences above are saved and become your listing." />
          )}
        </div>
      </div>
    </div>
  );
}
