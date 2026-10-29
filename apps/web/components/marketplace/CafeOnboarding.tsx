"use client";

/* Café onboarding — one question per screen, saved as the café's listing.
   New accounts send the answers with sign-up (the database trigger creates
   the listing); signed-in cafés use the same screens to edit it. */

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import React from "react";
import { useMp } from "./session";
import { Choices, FlowBar, Question, useSteps } from "./flow";
import { Art, CheckIcon, PinIcon, Rings, type ArtName } from "./art";
import { PlaceSearch, type Place } from "./PlaceSearch";
import { domainOf, Ext, FoundCard, MatchList } from "./autofill";
import { Range } from "./Range";
import { CATEGORIES } from "@/lib/marketplace/categories";
import { marketTier } from "@/lib/marketplace/markets";
import { money, num } from "@/lib/marketplace/format";
import { site } from "@/lib/urls";
import type { Cafe } from "@/lib/marketplace/types";
import { hoursPerWeek } from "@/lib/marketplace/hours";
import type { CafeMatch } from "@/app/api/cafes/search/route";
import type { CafeDetails } from "@/app/api/cafes/details/route";

type Spot = { address: string | null; neighborhood: string | null; city: string; region: string | null; lat: number; lng: number; label: string };
type Draft = {
  name: string; spot: Spot | null; cups: number | null; sleeves: number; welcome: string[] | null; never: string[]; branded: boolean | null;
  osm_ref: string | null; website: string; instagram: string; opening_hours: string; source: string[];
  fullName: string; email: string;
};
type Tier = { sleeve_payout_cents: number; drink_payout_cents: number };
type Estimate = { low: Tier; typical: Tier; high: Tier };

const KEY = "divvit.mp.onboard.cafe.v2";
const EMPTY: Draft = {
  name: "", spot: null, cups: null, sleeves: 1000, welcome: null, never: [], branded: null,
  osm_ref: null, website: "", instagram: "", opening_hours: "", source: [], fullName: "", email: "",
};
const STEPS = ["name", "where", "cups", "sleeves", "welcome", "never", "drink", "account"] as const;
const CUPS = [
  { value: 350, label: "Under 500", hint: "cups a week", art: <Rings level={1} /> },
  { value: 1000, label: "500 – 1,500", hint: "cups a week", art: <Rings level={2} /> },
  { value: 2200, label: "1,500 – 3,000", hint: "cups a week", art: <Rings level={3} /> },
  { value: 3800, label: "3,000+", hint: "cups a week", art: <Rings level={4} /> },
];
/** monthly earnings; the drink part only counts once they say yes to branded drinks */
const total = (t: Tier | undefined, drink: boolean | null) => (t ? t.sleeve_payout_cents + (drink ? t.drink_payout_cents : 0) : 0);

export function CafeOnboarding() {
  const { supabase, user, profile, loading } = useMp();
  const router = useRouter();
  const edit = useSearchParams().get("edit") === "1";
  const [d, setD] = React.useState<Draft>(EMPTY);
  const steps = useSteps(STEPS.length);
  const i = steps.i;
  const [ready, setReady] = React.useState(false);
  const [existingId, setExistingId] = React.useState<string | null>(null);
  const savedName = React.useRef<string | null>(null);  // editing: don't suggest matches until the name changes
  const [wasVerified, setWasVerified] = React.useState(false);
  const reverify = wasVerified && <p className="mp-note">Changing your café&apos;s name or address means verifying it again.</p>;
  const [password, setPassword] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [sentTo, setSentTo] = React.useState<string | null>(null);
  const [est, setEst] = React.useState<Estimate | null>(null);
  const set = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }));
  const next = () => { setError(null); steps.next(); };
  const back = () => { setError(null); steps.back(); };
  const goTo = (s: (typeof STEPS)[number]) => { setError(null); steps.go(STEPS.indexOf(s)); };
  // a café that lists the brands it welcomes only ever gets those, so "never" would be a wasted question
  const picky = Boolean(d.welcome?.length);

  React.useEffect(() => {
    if (loading) return;
    (async () => {
      if (user) {
        // a startup account belongs on its home page, not here
        if (profile?.role === "startup") { router.replace("/home"); return; }
        const { data } = await supabase.rpc("mp_my_cafe");
        const c = data as Cafe | null;
        if (c && !edit) { router.replace("/cafes/inbox"); return; }
        if (c) {
          setExistingId(c.id);
          savedName.current = c.name;
          setWasVerified(c.verification_status === "verified");
          setD({ ...EMPTY, name: c.name, cups: c.weekly_cups, sleeves: c.sleeves_per_month, branded: c.branded_drinks,
            osm_ref: c.osm_ref ?? null, website: c.website ?? "", instagram: c.instagram ?? "", opening_hours: c.opening_hours ?? "",
            welcome: c.accepted_categories.length ? c.accepted_categories : [], never: c.blocked_categories,
            spot: { address: c.address, neighborhood: c.neighborhood, city: c.city, region: c.region, lat: c.lat, lng: c.lng,
              label: [c.address, c.neighborhood, c.city].filter(Boolean).join(", ") } });
          setReady(true);
          return;
        }
      }
      try { const raw = localStorage.getItem(KEY); if (raw) { const s = JSON.parse(raw); setD({ ...EMPTY, ...s.d }); steps.jump(s.i ?? 0); } } catch { /* fresh */ }
      setReady(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, user, profile?.role, edit, supabase, router]);

  React.useEffect(() => {
    if (!ready || existingId) return;
    try { localStorage.setItem(KEY, JSON.stringify({ d, i })); } catch { /* ignore */ }
  }, [d, i, ready, existingId]);

  // what they could earn — the same pricing engine startups are charged by
  const maxSleeves = Math.max(500, Math.round(((d.cups ?? 1000) * 4.33) / 50) * 50);
  React.useEffect(() => {
    const t = setTimeout(async () => {
      const { data } = await supabase.rpc("mp_estimate_payout", {
        p_sleeves_month: Math.min(d.sleeves, maxSleeves), p_weekly_cups: d.cups ?? 1000,
        p_market_tier: marketTier(d.spot?.city), p_branded: true,
      });
      setEst(data as Estimate);
    }, 150);
    return () => clearTimeout(t);
  }, [d.sleeves, d.cups, d.spot?.city, maxSleeves, supabase]);

  /* ---------- "is this your café?" — OpenStreetMap, while they type the name ---------- */
  const [matches, setMatches] = React.useState<CafeMatch[]>([]);
  React.useEffect(() => {
    if (STEPS[i] !== "name" || d.name.trim().length < 3 || d.osm_ref || d.name === savedName.current) { setMatches([]); return; }
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/cafes/search?q=${encodeURIComponent(d.name.trim())}`, { signal: ctl.signal });
        const data = await r.json();
        setMatches((data.matches ?? []).slice(0, 4));
      } catch { /* aborted */ }
    }, 300);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [d.name, d.osm_ref, i]);

  // picking fills the address at once; website, Instagram and hours follow when the lookup returns
  const [looking, setLooking] = React.useState(false);
  async function pickCafe(ref: string) {
    const m = matches.find((x) => x.ref === ref);
    if (!m) return;
    set({
      name: m.name, osm_ref: m.ref,
      spot: { address: m.address, neighborhood: m.neighborhood, city: m.city, region: m.region, lat: m.lat, lng: m.lng,
        label: [m.address ?? m.name, m.neighborhood, m.city].filter(Boolean).join(", ") },
      website: "", instagram: "", opening_hours: "", source: ["OpenStreetMap"],
    });
    setLooking(true);
    let info: CafeDetails | null = null;
    try { const r = await fetch(`/api/cafes/details?ref=${encodeURIComponent(ref)}`); if (r.ok) info = await r.json(); } catch { /* keep the basics */ }
    setLooking(false);
    if (info) setD((x) => (x.osm_ref !== ref ? x : {
      ...x, website: info.website, instagram: info.instagram, opening_hours: info.openingHours,
      source: [...new Set([...x.source, ...info.sources])],
    }));
  }
  const notUs = () => set({ osm_ref: null, spot: null, website: "", instagram: "", opening_hours: "", source: [] });
  const openHours = hoursPerWeek(d.opening_hours);

  const listing = () => ({
    name: d.name.trim(), address: d.spot?.address ?? null, neighborhood: d.spot?.neighborhood ?? null, city: d.spot?.city ?? "",
    region: d.spot?.region ?? null, lat: d.spot?.lat, lng: d.spot?.lng, market_tier: marketTier(d.spot?.city),
    weekly_cups: d.cups ?? 1000, sleeves_per_month: Math.max(100, Math.min(d.sleeves, maxSleeves)),
    accepted_categories: d.welcome ?? [], blocked_categories: d.never, branded_drinks: d.branded ?? true,
    website: /^https?:\/\//.test(d.website) ? d.website : null, instagram: d.instagram.startsWith("https://") ? d.instagram : null,
    opening_hours: d.opening_hours || null, osm_ref: d.osm_ref,
  });

  async function finish() {
    setBusy(true); setError(null);
    try {
      if (user) {
        const row = listing();
        // the role comes first: only café accounts may create a listing
        if (!profile) {
          const { error } = await supabase.from("mp_profiles").insert({ id: user.id, role: "cafe", full_name: d.fullName || null });
          if (error) throw error;
        }
        const { error } = existingId
          ? await supabase.from("mp_cafes").update(row).eq("id", existingId)
          : await supabase.from("mp_cafes").insert({ ...row, owner_id: user.id });
        if (error) throw error;
        try { localStorage.removeItem(KEY); } catch { /* ignore */ }
        fetch("/api/cafes/nearby", { method: "POST" }).catch(() => {}); // look up what's around the café
        router.push("/cafes/inbox");
        return;
      }
      const { data, error } = await supabase.auth.signUp({
        email: d.email.trim(), password,
        options: {
          data: { mp_role: "cafe", full_name: d.fullName.trim(), mp_cafe: listing() },
          emailRedirectTo: `${window.location.origin}/auth/callback?next=/cafes/inbox`,
        },
      });
      if (error) throw error;
      // an email that already has an account comes back as a user with no identities (Supabase hides it)
      if (data.user && data.user.identities?.length === 0) throw new Error("already registered");
      try { localStorage.removeItem(KEY); } catch { /* ignore */ }
      if (data.session) router.push("/cafes/inbox");
      else setSentTo(d.email.trim());
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(/already registered/i.test(msg) ? "That email already has an account — sign in instead." : msg);
    } finally {
      setBusy(false);
    }
  }

  if (!ready) return <FlowBar />;
  if (sentTo) {
    return (
      <>
        <FlowBar progress={1} />
        <Question title="Check your inbox" sub={<>We sent a link to <b>{sentTo}</b>. Your café is saved — confirm your email, then verify it&apos;s really yours so startups can find you.</>}>
          <div className="mp-done"><CheckIcon /></div>
          <Link href="/signin" className="mp-link accent">Already confirmed? Sign in</Link>
        </Question>
      </>
    );
  }

  const step = STEPS[i];
  const cafe = d.name.trim() || "your café";
  const catOptions = CATEGORIES.map((c) => ({ value: c.id as string, label: c.label, art: <Art name={c.art as ArtName} /> }));
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  return (
    <>
      <FlowBar progress={(i + 1) / STEPS.length}
        right={edit ? <Link href="/cafes/inbox" className="mp-link">Cancel</Link> : !user ? <Link href="/signin" className="mp-link">Sign in</Link> : null} />
      <div key={step} className={steps.stage}>
        {step === "name" && (
          <Question title={edit ? "Your café's name" : "What's your café called?"} sub="Add your neighborhood if there's more than one."
            onContinue={next} canContinue={d.name.trim().length > 0}>
            <input className="mp-input big" autoFocus value={d.name} placeholder="e.g. Juniper Coffee, Williamsburg"
              onChange={(e) => set({ name: e.target.value, ...(d.osm_ref ? { osm_ref: null } : {}) })} />
            {edit && reverify}
            {d.osm_ref && d.spot ? (
              <FoundCard icon={<PinIcon />} title={d.name} from={d.source} onUndo={notUs} facts={[
                d.spot.label,
                d.website && <Ext href={d.website}>{domainOf(d.website)}</Ext>,
                d.instagram && <Ext href={d.instagram}>Instagram</Ext>,
                openHours && `Open ${openHours} hrs a week`,
                looking && <span className="mp-muted">Looking up your website and hours…</span>,
              ]} />
            ) : (
              <MatchList label="Is this your café?" picking={null} onPick={pickCafe} rows={matches.map((m) => ({
                key: m.ref, title: m.name, line: m.label || m.city, icon: <PinIcon />,
              }))} />
            )}
          </Question>
        )}

        {step === "where" && (
          <Question title={`Where is ${cafe}?`} sub="So startups looking for your neighborhood can find you." onBack={back} onContinue={next} canContinue={Boolean(d.spot)}>
            {edit && reverify}
            {d.spot ? (
              <div className="mp-found">
                <span className="ph"><PinIcon /></span>
                <span style={{ flex: 1 }}>{d.spot.label}</span>
                <button type="button" className="mp-link accent" onClick={() => set({ spot: null })}>Change</button>
              </div>
            ) : (
              <PlaceSearch mode="address" autoFocus placeholder="Start typing your street address"
                onPick={(p: Place) => set({ spot: { address: p.address ?? p.name, neighborhood: p.neighborhood, city: p.city ?? p.name, region: p.region,
                  lat: p.lat, lng: p.lng, label: [p.address ?? p.name, p.neighborhood, p.city].filter(Boolean).join(", ") } })} />
            )}
          </Question>
        )}

        {step === "cups" && (
          <Question title={`How busy is ${cafe}?`}
            sub={openHours ? `You're open about ${openHours} hours a week. Roughly how many cups is that?` : "Roughly — it helps us price your sleeves fairly."} onBack={back} onContinue={next} canContinue={d.cups !== null}>
            <Choices options={CUPS} value={d.cups} onChange={(v) => { set({ cups: v, sleeves: Math.min(d.sleeves, Math.round((v * 4.33 * 0.4) / 50) * 50) || 500 }); setTimeout(next, 220); }} />
          </Question>
        )}

        {step === "sleeves" && (
          <Question title="How many sleeves a month can go to brands?" sub="You only ever carry brands you approve." onBack={back} onContinue={next}>
            <div className="mp-big">
              <b>{est ? money(total(est.typical, d.branded)) : "—"}</b>
              <span>a month you could earn{est ? ` · up to ${money(total(est.high, d.branded))}` : ""}</span>
            </div>
            <Range label="Sleeves a month" value={Math.min(d.sleeves, maxSleeves)} min={100} max={maxSleeves} step={50} onChange={(v) => set({ sleeves: v })} format={(v) => num(v)} />
          </Question>
        )}

        {step === "welcome" && (
          <Question title="What brands are you happy to carry?" sub="Pick all that fit, or leave it open." onBack={back}
            onContinue={() => (picky ? (set({ never: [] }), goTo("drink")) : next())}
            canContinue={d.welcome !== null} skip="Anything that fits my café" onSkip={() => { set({ welcome: [] }); next(); }}>
            <Choices options={catOptions} value={d.welcome ?? []} onChange={(v) => set({ welcome: toggle(d.welcome ?? [], v) })} />
          </Question>
        )}

        {step === "never" && (
          <Question title="Anything you'd never carry?" onBack={back} onContinue={next} canContinue={d.never.length > 0}
            skip="No, I'm open" onSkip={() => { set({ never: [] }); next(); }}>
            <Choices options={catOptions.filter((c) => !(d.welcome ?? []).includes(c.value))} value={d.never} onChange={(v) => set({ never: toggle(d.never, v) })} />
          </Question>
        )}

        {step === "drink" && (
          <Question title="Open to a branded drink on your menu?" sub="Like “The Lumen Latte” for a few weeks — it pays extra."
            onBack={() => (picky ? goTo("welcome") : back())}
            onContinue={next} canContinue={d.branded !== null}>
            <Choices cols={1} value={d.branded} onChange={(v) => { set({ branded: v }); setTimeout(next, 220); }} options={[
              { value: true, label: "Yes, I'm open to it", art: <Art name="soda" />, hint: est ? `About ${money(est.typical.drink_payout_cents)} more a month` : undefined },
              { value: false, label: "No, just sleeves", art: <Art name="coffee" /> },
            ]} />
          </Question>
        )}

        {step === "account" && (user ? (
          <Question title={edit ? "Save your changes" : "You're all set"} sub={edit ? "Startups see your changes right away." : "Next, a quick check that it's really your café — then startups can send you campaigns."} onBack={back}
            cta={edit ? "Save" : "Join Divvit"} onContinue={finish} busy={busy}>
            {error && <div className="mp-error">{error}</div>}
          </Question>
        ) : (
          <Question title="Join Divvit" sub={est ? `Start earning around ${money(total(est.typical, d.branded))} a month.` : "Create your account."} onBack={back}
            cta="Join Divvit" onContinue={finish} busy={busy}
            canContinue={d.fullName.trim().length > 0 && /\S+@\S+\.\S+/.test(d.email) && password.length >= 8}>
            <input className="mp-input" autoFocus placeholder="Your name" autoComplete="name" value={d.fullName} onChange={(e) => set({ fullName: e.target.value })} />
            <input className="mp-input" type="email" placeholder="Email" autoComplete="email" value={d.email} onChange={(e) => set({ email: e.target.value })} />
            <input className="mp-input" type="password" placeholder="Password (8+ characters)" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            <p className="mp-note">By creating an account you agree to Divvit&apos;s <a className="mp-link accent" href={site("/terms")} target="_blank" rel="noreferrer">Terms</a> and <a className="mp-link accent" href={site("/privacy")} target="_blank" rel="noreferrer">Privacy Policy</a>.</p>
            {error && <div className="mp-error">{error} {/sign in/.test(error) && <Link href="/signin" className="mp-link accent">Sign in</Link>}</div>}
          </Question>
        ))}
      </div>
    </>
  );
}
