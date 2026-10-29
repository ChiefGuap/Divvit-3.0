"use client";

/* Café inbox: campaigns that picked this café. Accept or pass — that's it.
   First-timers get a setup guide (verify, check details, add a photo, first offer, get paid). */

import Link from "next/link";
import { useRouter } from "next/navigation";
import React from "react";
import { useMp } from "./session";
import { AppBar } from "./flow";
import { CafePhoto } from "./CafePhoto";
import { CafeVerify } from "./CafeVerify";
import { SetupGuide, type GuideStep } from "./SetupGuide";
import { Notices } from "./Notices";
import { categoryLabel } from "@/lib/marketplace/categories";
import { proxied } from "@/lib/marketplace/images";
import { money, num, plural } from "@/lib/marketplace/format";
import type { Cafe } from "@/lib/marketplace/types";

type Offer = {
  id: string; status: "pending" | "accepted" | "declined"; sleeves: number; branded_drink: boolean; payout_cents: number; created_at: string;
  start_date: string | null; weeks: number; design_url: string | null; startup_name: string; website: string | null; hq: string | null;
  category: string; description: string | null; logo_url: string | null;
  linkedin_url: string | null; team_size: number | null; founded_year: number | null;
};
const date = (d: string | null) => (d ? new Date(`${d.slice(0, 10)}T12:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "soon");

export function CafeInbox() {
  const { supabase, user, profile, loading } = useMp();
  const router = useRouter();
  const [cafe, setCafe] = React.useState<Cafe | null>(null);
  const [offers, setOffers] = React.useState<Offer[] | null>(null);
  const [tab, setTab] = React.useState<"pending" | "accepted" | "declined">("pending");
  const [open, setOpen] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const list = React.useRef<HTMLDivElement>(null);
  const [focus, setFocus] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    const [{ data: c }, { data: o }] = await Promise.all([supabase.rpc("mp_my_cafe"), supabase.rpc("mp_cafe_inbox")]);
    if (!c) { router.replace("/start/cafe"); return; }
    setCafe(c as Cafe);
    setOffers((o as Offer[]) ?? []);
  }, [supabase, router]);

  React.useEffect(() => {
    if (loading) return;
    if (!user) { router.replace("/signin"); return; }
    if (profile?.role === "startup") { router.replace("/home"); return; }
    load();
  }, [loading, user, profile, load, router]);

  // emails and notifications link to /cafes/inbox#offer-<id>: open that offer and bring it into view
  React.useEffect(() => {
    if (!offers) return;
    const show = () => {
      const id = window.location.hash.match(/^#offer-(.+)$/)?.[1];
      const o = id ? offers.find((x) => x.id === id) : undefined;
      if (!o) return;
      setTab(o.status); setOpen(o.id); setFocus(o.id);
      setTimeout(() => document.getElementById(`offer-${o.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 80);
    };
    show();
    window.addEventListener("hashchange", show);
    return () => window.removeEventListener("hashchange", show);
  }, [offers]);

  async function respond(id: string, accept: boolean) {
    setBusy(id);
    await supabase.rpc("mp_respond_offer", { p_offer_id: id, p_accept: accept });
    await load();
    setBusy(null);
  }

  if (!cafe || !offers) return <AppBar />;
  const shown = offers.filter((o) => o.status === tab);
  const count = (s: Offer["status"]) => offers.filter((o) => o.status === s).length;
  const earned = offers.filter((o) => o.status === "accepted").reduce((s, o) => s + o.payout_cents, 0);
  const verified = cafe.verification_status === "verified";
  const steps: GuideStep[] = [
    { id: "verify", title: "Verify your café", art: "store", done: verified,
      body: "Startups only see verified cafés, so offers start once this is done. We check against your café's public listing, so nobody else can sign up as you.",
      extra: !verified ? <CafeVerify bare name={cafe.name} onVerified={load} /> : undefined },
    { id: "details", title: "Check your café details", art: "layers",
      body: "How many sleeves you can use a month, which kinds of brands you'll carry, and whether you'd add a branded drink. Startups only send offers that fit.",
      actions: <Link href="/start/cafe?edit=1" className="mp-btn primary">Review details</Link> },
    { id: "photo", title: "Add a photo of your café", art: "camera", done: Boolean(cafe.photo),
      body: "It's the first thing startups see when they browse cafés, so they know where their sleeves will be.",
      extra: <CafePhoto cafe={cafe} onSaved={load} /> },
    { id: "offer", title: "Say yes to your first campaign", art: "hands", done: count("accepted") > 0,
      body: "When a startup picks your café, its sleeve and your payout appear below. You approve every campaign, and passing costs nothing.",
      actions: <button type="button" className="mp-btn primary" onClick={() => list.current?.scrollIntoView({ behavior: "smooth", block: "start" })}>See offers</button> },
    { id: "paid", title: "Serve and get paid", art: "coin",
      body: "Sleeves arrive printed and packed before the start date. Put them on your cups for the campaign's weeks, and you're paid when it ends." },
  ];

  return (
    <>
      <AppBar />
      <main className="mp-page">
        <div className="cafe-head">
          {cafe.photo && <CafePhoto compact cafe={cafe} onSaved={load} />}
          <div>
            <h1>{cafe.name}</h1>
            <p className="sub">{count("pending") ? `${plural(count("pending"), "brand")} want${count("pending") === 1 ? "s" : ""} your cups.` : "New campaigns show up here."}</p>
          </div>
        </div>

        <Notices refresh={offers} />

        <SetupGuide storageKey={`divvit.mp.guide.cafe.${user!.id}`} title="Get ready for your first campaign" steps={steps}
          sub="New here? Five steps to your first paid campaign. Each one shows you what to do." />

        {offers.length > 0 && (
          <div className="mp-stats">
            <div className="mp-stat"><span>Waiting on you</span><b>{count("pending")}</b></div>
            <div className="mp-stat"><span>Accepted</span><b>{count("accepted")}</b></div>
            <div className="mp-stat"><span>You&apos;ll earn</span><b>{money(earned)}</b></div>
          </div>
        )}

        <div ref={list} className="mp-anchor" />
        {offers.length > 0 && (
          <div className="mp-tabs">
            {([["pending", "New"], ["accepted", "Accepted"], ["declined", "Passed"]] as const).map(([id, label]) => (
              <button key={id} type="button" className={`mp-chip${tab === id ? " on" : ""}`} onClick={() => setTab(id)}>{label} <small>{count(id)}</small></button>
            ))}
          </div>
        )}

        {shown.length === 0 ? (
          <div className="mp-empty"><b>{tab === "pending" ? "You're all caught up" : "Nothing here yet"}</b>When a startup picks {cafe.name}, you&apos;ll see their sleeve and your payout here.</div>
        ) : shown.map((o) => (
          <div key={o.id} id={`offer-${o.id}`} className={`mp-item${focus === o.id ? " focus" : ""}`}>
            <div className="mp-item-head" onClick={() => setOpen(open === o.id ? null : o.id)}>
              {o.logo_url ? <img src={proxied(o.logo_url)!} alt="" /> : <span className="mp-logo-ph">{o.startup_name[0]}</span>}
              <div className="t"><b>{o.startup_name}</b><small>{categoryLabel(o.category)} · {num(o.sleeves)} sleeves · from {date(o.start_date)}</small></div>
              <span className="amt">{money(o.payout_cents)}</span>
            </div>
            {(open === o.id || o.status === "pending") && (
              <div className="mp-item-body">
                {o.description && <p>{o.description}</p>}
                {o.design_url && <img className="art" src={o.design_url} alt={`${o.startup_name} sleeve`} />}
                <div className="mp-facts">
                  <span className="mp-fact">{plural(o.weeks, "week")}</span>
                  {o.branded_drink && <span className="mp-fact">Branded drink</span>}
                  {o.hq && <span className="mp-fact">{o.hq}</span>}
                  {o.founded_year && <span className="mp-fact">Since {o.founded_year}</span>}
                  {o.team_size && <span className="mp-fact">{num(o.team_size)} people</span>}
                  {o.website && <a className="mp-fact" href={o.website} target="_blank" rel="noreferrer noopener">Website ↗</a>}
                  {o.linkedin_url && <a className="mp-fact" href={o.linkedin_url} target="_blank" rel="noreferrer noopener">LinkedIn ↗</a>}
                </div>
                {o.status === "pending" && (
                  <div className="mp-row-actions">
                    <button className="mp-btn primary" disabled={busy === o.id || !verified} title={verified ? undefined : "Verify your café to accept offers"}
                      onClick={() => respond(o.id, true)}>{verified ? `Accept · ${money(o.payout_cents)}` : "Verify to accept"}</button>
                    <button className="mp-btn" disabled={busy === o.id} onClick={() => respond(o.id, false)}>Pass</button>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </main>
    </>
  );
}
