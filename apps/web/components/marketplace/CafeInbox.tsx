"use client";

/* Café inbox: every campaign that picked this café, with the brand, the
   artwork and the payout. Accept or pass. */

import Link from "next/link";
import React from "react";
import { useMp } from "./session";
import { AuthPanel } from "./AuthPanel";
import { proxied } from "@/lib/marketplace/images";
import { categoryLabel } from "@/lib/marketplace/categories";
import { money, num, plural } from "@/lib/marketplace/format";
import type { Cafe } from "@/lib/marketplace/types";

type Offer = {
  id: string; status: "pending" | "accepted" | "declined"; sleeves: number; branded_drink: boolean; payout_cents: number;
  created_at: string; responded_at: string | null; cafe_id: string; cafe_name: string; campaign_name: string;
  start_date: string | null; weeks: number; design_url: string | null; startup_name: string; website: string | null;
  hq: string | null; category: string; description: string | null; logo_url: string | null; funding_stage: string | null;
};
const TABS = [["pending", "Pending"], ["accepted", "Accepted"], ["declined", "Passed"], ["all", "All"]] as const;
const fmtDate = (d: string | null) => (d ? new Date(d + (d.length === 10 ? "T12:00" : "")).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "TBD");

export function CafeInbox() {
  const { supabase, user, loading } = useMp();
  const [cafe, setCafe] = React.useState<Cafe | null | undefined>(undefined);
  const [offers, setOffers] = React.useState<Offer[] | null>(null);
  const [tab, setTab] = React.useState<(typeof TABS)[number][0]>("pending");
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    const [{ data: c }, { data: o }] = await Promise.all([supabase.rpc("mp_my_cafe"), supabase.rpc("mp_cafe_inbox")]);
    setCafe((c as Cafe) ?? null);
    setOffers((o as Offer[]) ?? []);
  }, [supabase]);

  React.useEffect(() => { if (user) load(); }, [user, load]);

  async function respond(id: string, accept: boolean) {
    setBusy(id); setError(null);
    const { error } = await supabase.rpc("mp_respond_offer", { p_offer_id: id, p_accept: accept });
    if (error) setError(error.message);
    await load();
    setBusy(null);
  }

  if (loading) return <div className="mp-page" />;
  if (!user) {
    return (
      <div className="mp-page mp-narrow">
        <div className="mp-eyebrow">Café inbox</div>
        <h1 className="mp-title" style={{ marginBottom: 20 }}>Sign in to see your campaigns</h1>
        <AuthPanel role="cafe" defaultMode="signin" />
      </div>
    );
  }
  if (cafe === undefined || offers === null) return <div className="mp-page"><p className="mp-muted">Loading your inbox…</p></div>;
  if (cafe === null) {
    return (
      <div className="mp-page mp-narrow">
        <div className="mp-card mp-empty">
          <b>You haven&apos;t listed a café yet</b>
          Set your preferences and join the network — campaigns that pick you will land here.
          <div style={{ marginTop: 16 }}><Link href="/cafes" className="divvit-plainsm"><span>List my café</span></Link></div>
        </div>
      </div>
    );
  }

  const counts = { pending: 0, accepted: 0, declined: 0, all: offers.length };
  offers.forEach((o) => counts[o.status]++);
  const shown = tab === "all" ? offers : offers.filter((o) => o.status === tab);
  const earned = offers.filter((o) => o.status === "accepted").reduce((s, o) => s + o.payout_cents, 0);

  return (
    <div className="mp-page mp-narrow">
      <div className="mp-eyebrow">Café inbox</div>
      <h1 className="mp-title">{cafe.name}</h1>
      <p className="mp-lede">
        {[cafe.neighborhood, cafe.city].filter(Boolean).join(", ")} · {num(cafe.sleeves_per_month)} sleeves/month ·{" "}
        {cafe.accepted_categories.length ? cafe.accepted_categories.map(categoryLabel).join(", ") : "open to all categories"}
        {" · "}<Link href="/cafes" style={{ color: "var(--brand-primary)", fontWeight: 700 }}>Edit listing</Link>
      </p>

      <div className="mp-roi" style={{ gridTemplateColumns: "repeat(3, 1fr)", marginTop: 20 }}>
        <div className="mp-stat"><span>Waiting on you</span><b>{counts.pending}</b></div>
        <div className="mp-stat"><span>Accepted</span><b>{counts.accepted}</b></div>
        <div className="mp-stat"><span>Payouts accepted</span><b>{money(earned)}</b></div>
      </div>

      <div className="mp-tabs">
        {TABS.map(([id, label]) => (
          <button key={id} className={`mp-chip${tab === id ? " on" : ""}`} onClick={() => setTab(id)}>{label} <small>{counts[id]}</small></button>
        ))}
      </div>
      {error && <div className="mp-error" style={{ marginBottom: 12 }}>{error}</div>}

      {shown.length === 0 ? (
        <div className="mp-card mp-empty">
          <b>{tab === "pending" ? "Nothing waiting on you" : "Nothing here yet"}</b>
          When a startup picks your café for a campaign, the offer shows up here with the artwork and your payout.
        </div>
      ) : (
        <div className="mp-panel">
          {shown.map((o) => (
            <div key={o.id} className="mp-card mp-offer">
              <div className="mp-offer-main">
                <div className="mp-offer-who">
                  {o.logo_url ? <img src={proxied(o.logo_url)!} alt="" style={{ objectFit: "contain", background: "#fff" }} /> : <span className="mp-logo-ph">{o.startup_name[0]}</span>}
                  <div>
                    <b>{o.startup_name}</b>
                    <span>{[categoryLabel(o.category), o.hq, o.funding_stage].filter(Boolean).join(" · ")}</span>
                  </div>
                  <span className={`mp-status ${o.status}`} style={{ marginLeft: "auto" }}>{o.status === "declined" ? "passed" : o.status}</span>
                </div>
                {o.description && <p className="mp-offer-desc" title={o.description}>{o.description}</p>}
                <div className="mp-offer-facts">
                  <span className="mp-fact">Starts {fmtDate(o.start_date)}</span>
                  <span className="mp-fact">{plural(o.weeks, "week")}</span>
                  <span className="mp-fact">{num(o.sleeves)} sleeves</span>
                  {o.branded_drink && <span className="mp-fact">☕ Branded drink</span>}
                  {o.website && <a className="mp-fact" href={o.website} target="_blank" rel="noreferrer noopener">{o.website.replace(/^https?:\/\//, "")} ↗</a>}
                </div>
                <span className="mp-small mp-muted">{o.campaign_name} · received {fmtDate(o.created_at.slice(0, 10))}</span>
              </div>
              <div className="mp-offer-side">
                {o.design_url ? <img src={o.design_url} alt={`${o.startup_name} sleeve design`} /> : <div className="mp-small mp-muted">No artwork attached</div>}
                <div className="mp-payout"><span>Your payout</span><b>{money(o.payout_cents)}</b></div>
                {o.status === "pending" ? (
                  <div className="mp-offer-actions">
                    <button className="divvit-plainsm" disabled={busy === o.id} onClick={() => respond(o.id, true)}><span>Accept</span></button>
                    <button className="divvit-ghost" disabled={busy === o.id} onClick={() => respond(o.id, false)}>Pass</button>
                  </div>
                ) : (
                  <span className="mp-small mp-muted">{o.status === "accepted" ? "Accepted" : "Passed"} {o.responded_at ? fmtDate(o.responded_at.slice(0, 10)) : ""}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
