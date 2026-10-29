"use client";

/* A campaign's timeline bar (how far through it is, days left) and its numbers:
   projected before it runs, measured and estimated once cafés are serving it.
   Used on Your campaigns and on the campaign report. */

import React from "react";
import { campaignNumbers, pct, shortDate, TYPICAL_SCAN_RATE, type CampaignLike, type Timeline } from "@/lib/marketplace/campaign-stats";
import { money, num, plural } from "@/lib/marketplace/format";

export function CampaignTimeline({ t, big = false }: { t: Timeline; big?: boolean }) {
  const weeks = Math.round(t.total / 7);
  return (
    <div className={`camp-time ${t.phase}${big ? " big" : ""}`}>
      <div className="ct-top"><b>{t.label}</b><span>{shortDate(t.start)} – {shortDate(t.last)}</span></div>
      <div className="ct-bar" role="progressbar" aria-label="Campaign timeline" aria-valuemin={0} aria-valuemax={t.total}
        aria-valuenow={Math.max(0, Math.min(t.total, t.phase === "done" ? t.total : t.day))} aria-valuetext={t.label}>
        <i style={{ width: `${t.progress * 100}%` }} />
        {/* a gap at each week boundary */}
        {weeks > 1 && weeks <= 12 && Array.from({ length: weeks - 1 }, (_, k) => <span key={k} style={{ left: `${((k + 1) / weeks) * 100}%` }} />)}
      </div>
    </div>
  );
}

type Metric = { k: string; v: string; sub: string; est?: boolean };

export function campaignMetrics(c: CampaignLike): { tag: string; items: Metric[] } {
  const n = campaignNumbers(c);
  const cafes = c.cafes.filter((x) => x.status !== "declined").length;
  const cpm = (v: number | null, sub: string): Metric => ({ k: "Cost per 1,000 people", v: v == null ? "—" : money(v, { cents: true }), sub, est: true });
  if (n.live) {
    const done = n.timeline?.phase === "done";
    const reached: Metric = { k: "People reached", v: num(n.reached), sub: `${num(n.handedOut)} sleeves handed out`, est: true };
    const spent = done ? `${money(n.spend)} spent` : `${money(n.spentSoFar)} of ${money(n.spend)} so far`;
    return {
      tag: done ? "Results" : "So far",
      items: n.hasQr ? [
        { k: "QR scans", v: num(n.scans), sub: n.scans ? `by ${plural(n.scanners, "person", "people")}` : "None yet" },
        { k: "Scan rate", v: n.scanRate == null ? "—" : pct(n.scanRate), sub: `Typical is ${TYPICAL_SCAN_RATE}` },
        reached,
        { k: "Cost per scan", v: n.costPerScan == null ? "—" : money(n.costPerScan, { cents: true }), sub: n.costPerScan == null ? "After the first scan" : spent },
      ] : [
        reached,
        { k: "Cafés serving it", v: num(c.cafes.filter((x) => x.status === "accepted").length), sub: `of ${plural(c.cafes.length, "café")}` },
        { k: "QR scans", v: "Not tracked", sub: "No trackable QR on this sleeve" },
        cpm(n.cpm, spent),
      ],
    };
  }
  const reach: Metric = { k: "People to reach", v: num(n.projected.reach), sub: `${num(n.sleevesPlanned)} sleeves`, est: true };
  const price = `${money(n.spend)}${c.status === "submitted" ? " projected" : ""}`;
  return {
    tag: "Projected",
    items: n.hasQr ? [
      reach,
      { k: "Expected QR scans", v: `${num(n.projected.scansLow)}–${num(n.projected.scansHigh)}`, sub: `At a typical ${TYPICAL_SCAN_RATE}` },
      { k: "Cafés", v: num(cafes), sub: `${plural(c.weeks, "week")} each` },
      cpm(n.projected.cpm, price),
    ] : [
      reach,
      { k: "Cafés", v: num(cafes), sub: `${plural(c.weeks, "week")} each` },
      { k: "QR scans", v: "Not tracked", sub: "No trackable QR on this sleeve" },
      cpm(n.projected.cpm, price),
    ],
  };
}

export function CampaignMetrics({ c }: { c: CampaignLike }) {
  const { tag, items } = campaignMetrics(c);
  return (
    <div className="camp-nums">
      <span className="cn-tag">{tag}</span>
      <dl>
        {items.map((m) => (
          <div key={m.k}>
            <dt>{m.k}{m.est && <em> · est.</em>}</dt>
            <dd><b>{m.v}</b><small>{m.sub}</small></dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
