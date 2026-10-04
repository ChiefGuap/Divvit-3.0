"use client";

/* A startup's campaigns and where each café stands. */

import Link from "next/link";
import React from "react";
import { useMp } from "./session";
import { AuthPanel } from "./AuthPanel";
import { money, num, plural } from "@/lib/marketplace/format";

type Campaign = {
  id: string; name: string; status: string; start_date: string | null; weeks: number; sleeves_per_cafe: number;
  branded_drink: boolean; total_cents: number; design_url: string | null; created_at: string; startup_name: string;
  cafes: { cafe_name: string; neighborhood: string | null; city: string; is_demo: boolean; status: string; sleeves: number; price_cents: number }[];
};

export function MyCampaigns() {
  const { supabase, user, loading } = useMp();
  const [list, setList] = React.useState<Campaign[] | null>(null);
  const [open, setOpen] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!user) return;
    supabase.rpc("mp_my_campaigns").then(({ data }) => setList((data as Campaign[]) ?? []));
  }, [user, supabase]);

  if (loading) return <div className="mp-page" />;
  if (!user) {
    return (
      <div className="mp-page mp-narrow">
        <div className="mp-eyebrow">My campaigns</div>
        <h1 className="mp-title" style={{ marginBottom: 20 }}>Sign in to see your campaigns</h1>
        <AuthPanel role="startup" defaultMode="signin" />
      </div>
    );
  }

  return (
    <div className="mp-page mp-narrow">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
        <div>
          <div className="mp-eyebrow">My campaigns</div>
          <h1 className="mp-title">Your sleeve campaigns</h1>
        </div>
        <Link href="/startups" className="divvit-plainsm"><span>New campaign</span></Link>
      </div>

      {list === null ? <p className="mp-muted">Loading…</p> : list.length === 0 ? (
        <div className="mp-card mp-empty" style={{ marginTop: 20 }}>
          <b>No campaigns yet</b>
          Build one in a few minutes — pick neighborhoods, design a sleeve, check out per café.
          <div style={{ marginTop: 16 }}><Link href="/startups" className="divvit-plainsm"><span>Start a campaign</span></Link></div>
        </div>
      ) : (
        <div className="mp-panel" style={{ marginTop: 20 }}>
          {list.map((c) => {
            const counts = { accepted: 0, pending: 0, declined: 0 } as Record<string, number>;
            c.cafes.forEach((x) => (counts[x.status] = (counts[x.status] ?? 0) + 1));
            return (
              <div key={c.id} className="mp-card mp-offer">
                <div className="mp-offer-main">
                  <div className="mp-offer-who">
                    <div><b>{c.name}</b><span>{c.startup_name} · created {new Date(c.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span></div>
                    <span className={`mp-status ${c.status}`} style={{ marginLeft: "auto" }}>{c.status === "submitted" ? "awaiting cafés" : c.status}</span>
                  </div>
                  <div className="mp-offer-facts">
                    <span className="mp-fact">{plural(c.cafes.length, "café")}</span>
                    <span className="mp-fact">{num(c.sleeves_per_cafe)} sleeves each</span>
                    <span className="mp-fact">{plural(c.weeks, "week")}</span>
                    {c.start_date && <span className="mp-fact">from {new Date(c.start_date + "T12:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>}
                    {c.branded_drink && <span className="mp-fact">☕ Branded drink</span>}
                  </div>
                  <div className="mp-offer-facts">
                    <span className="mp-status accepted">{counts.accepted} accepted</span>
                    <span className="mp-status pending">{counts.pending} pending</span>
                    <span className="mp-status declined">{counts.declined} passed</span>
                  </div>
                  <button className="mp-filebtn" style={{ alignSelf: "flex-start" }} onClick={() => setOpen(open === c.id ? null : c.id)}>{open === c.id ? "Hide cafés" : "Show cafés"}</button>
                  {open === c.id && (
                    <div className="mp-lines" style={{ maxHeight: 320 }}>
                      {c.cafes.map((x, i) => (
                        <div className="mp-line" key={i}>
                          <div><b>{x.cafe_name}</b><small>{[x.neighborhood, x.city].filter(Boolean).join(", ")} · {num(x.sleeves)} sleeves{x.is_demo ? " · sample café" : ""}</small></div>
                          <span className={`mp-status ${x.status}`}>{x.status === "declined" ? "passed" : x.status}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="mp-offer-side">
                  {c.design_url && <img src={c.design_url} alt="Sleeve design" />}
                  <div className="mp-payout"><span>Campaign total</span><b>{money(c.total_cents)}</b></div>
                  <span className="mp-small mp-muted">Cafés that pass aren&apos;t charged.</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
