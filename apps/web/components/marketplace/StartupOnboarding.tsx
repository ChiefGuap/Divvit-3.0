"use client";

/* Startup onboarding — one question per screen, saved as the startup's profile.
   New accounts send the answers with sign-up; the database trigger turns them
   into the profile (works even before the email is confirmed). Signed-in
   startups use the same screens to edit their profile. */

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import React from "react";
import { useMp } from "./session";
import { useNetwork } from "./useNetwork";
import { AreaPicker, Choices, FlowBar, Question, useSteps } from "./flow";
import { Art, CheckIcon, type ArtName } from "./art";
import { domainOf, Ext, FoundCard, MatchList, normLinkedIn } from "./autofill";
import { CATEGORIES, guessCategory } from "@/lib/marketplace/categories";
import { num } from "@/lib/marketplace/format";
import { site } from "@/lib/urls";
import type { Area } from "@/lib/marketplace/network";
import type { Match } from "@/app/api/lookup/route";
import type { StartupProfile } from "@/app/api/lookup/profile/route";

type Draft = {
  name: string; website: string; category: string; description: string; hq: string; funding_stage: string; funding_total: string;
  logo_url: string | null; linkedin_url: string; links: Record<string, string>; team_size: number | null; founded_year: number | null;
  source: string[]; areas: Area[]; matched: string | null; readFrom: string; fullName: string; email: string;
};

const KEY = "divvit.mp.onboard.startup.v2";
const EMPTY: Draft = {
  name: "", website: "", category: "", description: "", hq: "", funding_stage: "", funding_total: "", logo_url: null,
  linkedin_url: "", links: {}, team_size: null, founded_year: null, source: [], areas: [], matched: null, readFrom: "", fullName: "", email: "",
};
/** what autofill sets — cleared together when someone says "Not you?" */
const FILLED: (keyof Draft)[] = ["website", "category", "description", "hq", "funding_stage", "funding_total", "logo_url", "linkedin_url", "links", "team_size", "founded_year", "source", "readFrom"];
const STEPS = ["name", "website", "category", "description", "hq", "stage", "areas", "account"] as const;
const STAGES = [
  { value: "Idea stage", label: "Just an idea", art: <Art name="bulb" /> },
  { value: "Pre-seed", label: "Pre-seed", art: <Art name="sprout" /> },
  { value: "Seed", label: "Seed", art: <Art name="leaf" /> },
  { value: "Series A", label: "Series A", art: <Art name="tree" /> },
  { value: "Series B+", label: "Series B+", art: <Art name="building" /> },
  { value: "Bootstrapped", label: "Bootstrapped", art: <Art name="wrench" /> },
];

/** A short line for cafés: the one-liner, else the first sentence of the long text. */
const oneLine = (short: string, long: string) => {
  const s = short.trim().replace(/[.\s]+$/, "");
  if (s) return s.slice(0, 140);
  const first = long.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s/)[0] ?? "";
  return first.slice(0, 140);
};

export function StartupOnboarding() {
  const { supabase, user, profile, loading } = useMp();
  const router = useRouter();
  const edit = useSearchParams().get("edit") === "1";
  const cafes = useNetwork();
  const [d, setD] = React.useState<Draft>(EMPTY);
  const steps = useSteps(STEPS.length);
  const i = steps.i;
  const [ready, setReady] = React.useState(false);
  const [existingId, setExistingId] = React.useState<string | null>(null);
  const savedName = React.useRef<string | null>(null);  // editing: don't suggest matches until the name changes
  const [password, setPassword] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [sentTo, setSentTo] = React.useState<string | null>(null);
  const set = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }));
  const next = () => { setError(null); steps.next(); };
  const back = () => { setError(null); steps.back(); };

  // load: an existing profile (editing) or the draft saved on this device
  React.useEffect(() => {
    if (loading) return;
    (async () => {
      if (user) {
        // a café account belongs in its inbox, not here
        if (profile?.role === "cafe") { router.replace("/cafes/inbox"); return; }
        const { data } = await supabase.from("mp_startups").select("*").eq("owner_id", user.id).order("created_at").limit(1).maybeSingle();
        if (data && !edit) { router.replace("/home"); return; }
        if (data) {
          setExistingId(data.id);
          savedName.current = data.name;
          setD({ ...EMPTY, name: data.name ?? "", website: data.website ?? "", category: data.category ?? "", description: data.description ?? "",
            hq: data.hq ?? "", funding_stage: data.funding_stage ?? "", funding_total: data.funding_total ?? "", logo_url: data.logo_url, areas: data.areas ?? [],
            linkedin_url: data.linkedin_url ?? "", links: data.links ?? {}, team_size: data.team_size, founded_year: data.founded_year,
            source: data.autofill_source?.sources ?? [], readFrom: domainOf(data.website ?? "") || (data.linkedin_url ?? "") });
          setReady(true);
          return;
        }
      }
      try { const raw = localStorage.getItem(KEY); if (raw) { const saved = JSON.parse(raw); setD({ ...EMPTY, ...saved.d }); steps.jump(saved.i ?? 0); } } catch { /* fresh */ }
      setReady(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, user, profile?.role, edit, supabase, router]);

  React.useEffect(() => {
    if (!ready || existingId) return;
    try { localStorage.setItem(KEY, JSON.stringify({ d, i })); } catch { /* ignore */ }
  }, [d, i, ready, existingId]);

  /* ---------- "is this you?" — any company, while they type the name ---------- */
  const [matches, setMatches] = React.useState<Match[]>([]);
  const [picking, setPicking] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (STEPS[i] !== "name" || d.name.trim().length < 2 || d.matched || d.name === savedName.current) { setMatches([]); return; }
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/lookup?q=${encodeURIComponent(d.name.trim())}`, { signal: ctl.signal });
        const data = await r.json();
        setMatches((data.matches ?? []).slice(0, 4));
      } catch { /* aborted */ }
    }, 300);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [d.name, d.matched, i]);

  const profileOf = async (q: { yc?: string; domain?: string; linkedin?: string }) => {
    const params = new URLSearchParams(Object.entries(q).filter(([, v]) => v) as [string, string][]);
    try {
      const r = await fetch(`/api/lookup/profile?${params}`);
      return r.ok ? ((await r.json()) as StartupProfile) : null;
    } catch { return null; }
  };

  /** Merge a looked-up profile in. Picking a match overwrites; reading a site later only fills gaps. */
  const apply = (p: StartupProfile, pickedKey: string | null) => setD((x) => {
    // they said "Not you?" or picked someone else while this was loading
    if (pickedKey !== null && x.matched !== pickedKey) return x;
    const over = pickedKey !== null;
    const pick = <T,>(cur: T, val: T) => (over ? (val || cur) : (cur || val));
    return {
      ...x,
      name: over ? p.name || x.name : x.name,
      matched: over ? pickedKey : x.matched,
      website: pick(x.website, p.website),
      description: pick(x.description, oneLine(p.oneLiner, p.description)),
      hq: pick(x.hq, p.hq),
      logo_url: pick(x.logo_url, p.logo || null),
      category: pick(x.category, p.industry || p.tags.length || p.oneLiner ? guessCategory(p.industry, p.tags.join(" "), p.oneLiner, p.description) : ""),
      linkedin_url: pick(x.linkedin_url, p.linkedin),
      links: over ? { ...x.links, ...p.links } : { ...p.links, ...x.links },
      team_size: over ? p.teamSize ?? x.team_size : x.team_size ?? p.teamSize,
      founded_year: over ? p.foundedYear ?? x.founded_year : x.founded_year ?? p.foundedYear,
      funding_stage: pick(x.funding_stage, p.fundingStage),
      funding_total: pick(x.funding_total, p.fundingTotal),
      source: [...new Set([...(over ? [] : x.source), ...p.sources])],
      readFrom: p.domain || x.readFrom,
    };
  });

  // picking shows the match at once; the full profile (site, LinkedIn, team size…) fills in when it returns
  async function pickMatch(key: string) {
    const m = matches.find((x) => x.key === key);
    if (!m) return;
    setD((x) => ({
      ...x, ...Object.fromEntries(FILLED.map((k) => [k, EMPTY[k]])),
      name: m.name, matched: key, website: m.domain ? `https://${m.domain}` : "", logo_url: m.logo || null,
      description: m.source === "yc" ? oneLine(m.line, "") : "", source: [m.source === "yc" ? "Y Combinator" : m.domain],
    }));
    setPicking(key);
    const p = await profileOf({ yc: m.yc, domain: m.domain });
    setPicking(null);
    if (p) apply(p, key);
  }

  const notUs = () => setD((x) => ({ ...x, ...Object.fromEntries(FILLED.map((k) => [k, EMPTY[k]])), matched: null }));

  // leaving the website step: read their site (and LinkedIn, via PDL) to fill anything still empty
  async function readWebsite() {
    const domain = domainOf(d.website);
    const linkedin = normLinkedIn(d.linkedin_url);
    set({ linkedin_url: linkedin });
    // look up only what's new since last time (a LinkedIn page alone only helps when PDL is on)
    const key = domain || linkedin;
    if (key && key !== d.readFrom && (domain || !d.matched)) {
      setBusy(true);
      const p = await profileOf({ domain, linkedin });
      if (p) apply(p, null);
      set({ readFrom: key });
      setBusy(false);
    }
    next();
  }

  const payload = () => ({
    name: d.name.trim(), website: d.website.trim(), category: d.category || "tech", description: d.description.trim(),
    hq: d.hq.trim(), funding_stage: d.funding_stage, funding_total: d.funding_total, logo_url: d.logo_url?.startsWith("https://") ? d.logo_url : null,
    areas: d.areas, source: d.source, linkedin_url: normLinkedIn(d.linkedin_url),
    links: Object.fromEntries(Object.entries(d.links).filter(([k, v]) => ["x", "instagram", "github", "crunchbase", "yc", "facebook"].includes(k) && v.startsWith("https://"))),
    team_size: d.team_size, founded_year: d.founded_year,
  });

  async function finish() {
    setBusy(true); setError(null);
    try {
      if (user) {
        const p = payload();
        const row = { name: p.name, website: p.website || null, category: p.category, description: p.description || null, hq: p.hq || null,
          funding_stage: p.funding_stage || null, funding_total: p.funding_total || null, logo_url: p.logo_url, areas: p.areas,
          autofill_source: p.source.length ? { sources: p.source } : null, linkedin_url: p.linkedin_url || null, links: p.links,
          team_size: p.team_size, founded_year: p.founded_year };
        // the role comes first: only startup accounts may create a startup profile
        if (!profile) {
          const { error } = await supabase.from("mp_profiles").insert({ id: user.id, role: "startup", full_name: d.fullName || null });
          if (error) throw error;
        }
        const { error } = existingId
          ? await supabase.from("mp_startups").update(row).eq("id", existingId)
          : await supabase.from("mp_startups").insert(row);
        if (error) throw error;
        try { localStorage.removeItem(KEY); } catch { /* ignore */ }
        router.push("/home");
        return;
      }
      const { data, error } = await supabase.auth.signUp({
        email: d.email.trim(), password,
        options: {
          data: { mp_role: "startup", full_name: d.fullName.trim(), mp_startup: payload() },
          emailRedirectTo: `${window.location.origin}/auth/callback?next=/home`,
        },
      });
      if (error) throw error;
      // an email that already has an account comes back as a user with no identities (Supabase hides it)
      if (data.user && data.user.identities?.length === 0) throw new Error("already registered");
      try { localStorage.removeItem(KEY); } catch { /* ignore */ }
      if (data.session) router.push("/home");
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
        <Question title="Check your inbox" sub={<>We sent a link to <b>{sentTo}</b>. Your profile is saved — confirm your email and you&apos;re in.</>}>
          <div className="mp-done"><CheckIcon /></div>
          <Link href="/signin" className="mp-link accent">Already confirmed? Sign in</Link>
        </Question>
      </>
    );
  }

  const step = STEPS[i];
  const name = d.name.trim() || "your startup";
  const progress = (i + 1) / STEPS.length;
  const quiet = <Link href="/signin" className="mp-link">{user ? "" : "Sign in"}</Link>;

  return (
    <>
      <FlowBar progress={progress} right={edit ? <Link href="/home" className="mp-link">Cancel</Link> : quiet} />
      <div key={step} className={steps.stage}>
        {step === "name" && (
          <Question title={edit ? "Your startup's name" : "What's your startup called?"} sub="We'll look you up so there's less to type."
            onContinue={next} canContinue={d.name.trim().length > 0}>
            <input className="mp-input big" autoFocus value={d.name} placeholder="e.g. Lumen"
              onChange={(e) => set({ name: e.target.value, matched: null })} />
            {d.matched ? (
              <FoundCard logo={d.logo_url} title={d.name} from={d.source} onUndo={notUs} facts={[
                d.website && domainOf(d.website),
                d.hq,
                d.founded_year && `Founded ${d.founded_year}`,
                d.team_size && `${num(d.team_size)} people`,
                d.funding_total && `${d.funding_total} raised`,
                d.linkedin_url && <Ext href={d.linkedin_url}>LinkedIn</Ext>,
                picking && <span className="mp-muted">Looking you up…</span>,
              ]} />
            ) : (
              <MatchList label="Is this you?" picking={null} onPick={pickMatch} rows={matches.map((m) => ({
                key: m.key, title: m.name, line: m.line || m.domain, logo: m.logo,
                tag: m.source === "yc" ? { text: "YC", className: "yc" } : undefined,
              }))} />
            )}
          </Question>
        )}

        {step === "website" && (
          <Question title={`What's ${name}'s website?`} sub="Optional — it powers the QR code on your sleeve." onBack={back}
            onContinue={readWebsite} canContinue={d.website.trim().length > 3 || Boolean(normLinkedIn(d.linkedin_url))} busy={busy}
            skip="I don't have one" onSkip={() => { set({ website: "", linkedin_url: normLinkedIn(d.linkedin_url) }); next(); }}>
            <input className="mp-input big" autoFocus value={d.website} placeholder="lumen.ai" inputMode="url" onChange={(e) => set({ website: e.target.value })} />
            <label className="mp-sub-input">
              <span className="mp-label">LinkedIn page <span style={{ fontWeight: 500 }}>(optional)</span></span>
              <input className="mp-input" value={d.linkedin_url} placeholder="linkedin.com/company/lumen" inputMode="url"
                onChange={(e) => set({ linkedin_url: e.target.value })} />
              {d.linkedin_url.trim() && !normLinkedIn(d.linkedin_url) && <span className="mp-note">Paste your company page, like linkedin.com/company/lumen.</span>}
            </label>
          </Question>
        )}

        {step === "category" && (
          <Question title={`What does ${name} do?`} sub="Cafés choose the kinds of brands they carry." onBack={back} onContinue={next} canContinue={Boolean(d.category)}>
            <Choices options={CATEGORIES.map((c) => ({ value: c.id as string, label: c.label, art: <Art name={c.art as ArtName} /> }))} value={d.category}
              onChange={(v) => { set({ category: v }); setTimeout(next, 220); }} />
          </Question>
        )}

        {step === "description" && (
          <Question title={`Describe ${name} in one line`} sub="Cafés read this before they say yes." onBack={back} onContinue={next} canContinue={d.description.trim().length > 2}>
            <textarea className="mp-input big" rows={2} autoFocus value={d.description} maxLength={140} placeholder="AI meeting notes that write themselves"
              onChange={(e) => set({ description: e.target.value.replace(/\n/g, " ") })}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }} />
            <span className="mp-counter">{d.description.length}/140</span>
          </Question>
        )}

        {step === "hq" && (
          <Question title={`Where is ${name} based?`} onBack={back} onContinue={next} canContinue={d.hq.trim().length > 1}
            skip="Skip" onSkip={() => { set({ hq: "" }); next(); }}>
            <input className="mp-input big" autoFocus value={d.hq} placeholder="Austin, TX" onChange={(e) => set({ hq: e.target.value })} />
          </Question>
        )}

        {step === "stage" && (
          <Question title="How far along are you?" onBack={back} onContinue={next} canContinue={Boolean(d.funding_stage)}
            skip="Prefer not to say" onSkip={() => { set({ funding_stage: "" }); next(); }}>
            <Choices options={STAGES} value={d.funding_stage} onChange={(v) => { set({ funding_stage: v }); setTimeout(next, 220); }} />
          </Question>
        )}

        {step === "areas" && (
          <Question title="Where do you want to be seen?" sub="Pick cities or neighborhoods. You can change this anytime." onBack={back}
            onContinue={next} canContinue={d.areas.length > 0} wide>
            <AreaPicker areas={d.areas} onChange={(areas) => set({ areas })} cafes={cafes} category={d.category || "tech"} />
          </Question>
        )}

        {step === "account" && (user ? (
          <Question title={edit ? "Save your changes" : "You're all set"} sub="Everything you told us is saved to your profile." onBack={back}
            cta="Save profile" onContinue={finish} busy={busy}>
            {error && <div className="mp-error">{error}</div>}
          </Question>
        ) : (
          <Question title="Save your profile" sub="So you never have to answer these again." onBack={back} cta="Create account" onContinue={finish} busy={busy}
            canContinue={d.fullName.trim().length > 0 && /\S+@\S+\.\S+/.test(d.email) && password.length >= 8}>
            <input className="mp-input" autoFocus placeholder="Your name" autoComplete="name" value={d.fullName} onChange={(e) => set({ fullName: e.target.value })} />
            <input className="mp-input" type="email" placeholder="Work email" autoComplete="email" value={d.email} onChange={(e) => set({ email: e.target.value })} />
            <input className="mp-input" type="password" placeholder="Password (8+ characters)" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            <p className="mp-note">By creating an account you agree to Divvit&apos;s <a className="mp-link accent" href={site("/terms")} target="_blank" rel="noreferrer">Terms</a> and <a className="mp-link accent" href={site("/privacy")} target="_blank" rel="noreferrer">Privacy Policy</a>.</p>
            {error && <div className="mp-error">{error} {/sign in/.test(error) && <Link href="/signin" className="mp-link accent">Sign in</Link>}</div>}
          </Question>
        ))}
      </div>
    </>
  );
}
