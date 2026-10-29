"use client";

/* A campaign's report: live while it runs, final once it's done (the startup gets a
   "your report is ready" notice then). Timeline, the headline numbers, QR scans per
   day, how it compares with what was projected, and the cafés that ran it.
   Owner or Divvit team only (mp_campaign_report). */

import Link from "next/link";
import { useRouter } from "next/navigation";
import React from "react";
import { useMp } from "./session";
import { AppBar } from "./flow";
import { CampaignTimeline, campaignMetrics } from "./CampaignProgress";
import { ScanChart, type ScanDay } from "./ScanChart";
import { addDays, campaignNumbers, campaignPill, dayOf, pct, shortDate, TYPICAL_SCAN_RATE, type CampaignLike } from "@/lib/marketplace/campaign-stats";
import { ROI_ASSUMPTIONS } from "@/lib/marketplace/roi";
import { money, num, plural } from "@/lib/marketplace/format";

type Report = Omit<CampaignLike, "cafes"> & {
  id: string; name: string; sleeves_per_cafe: number; branded_drink: boolean; paid_at: string | null; design_url: string | null;
  startup: { name: string; logo_url: string | null; website: string | null };
  cafes: { cafe_name: string; neighborhood: string | null; city: string; is_demo: boolean; status: string; sleeves: number }[];
  daily: { day: string; scans: number; scanners: number }[];
};
type Tile = { k: string; v: string; sub: string; est?: boolean };

export function CampaignReport({ id }: { id: string }) {
  const { supabase, user, loading } = useMp();
  const router = useRouter();
  const [r, setR] = React.useState<Report | null | undefined>(undefined);

  React.useEffect(() => {
    if (loading) return;
    if (!user) { router.replace(`/signin?next=/campaigns/${id}/report`); return; }
    supabase.rpc("mp_campaign_report", { p_campaign: id }).then(({ data }) => setR((data as Report | null) ?? null));
  }, [loading, user, supabase, id, router]);

  if (r === undefined) return <AppBar />;
  if (r === null) {
    return (
      <>
        <AppBar />
        <main className="mp-page"><div className="mp-empty"><b>We couldn&apos;t find that report</b>It may belong to another account. <Link href="/home#campaigns" className="mp-link accent">Back to your campaigns</Link></div></main>
      </>
    );
  }

  const n = campaignNumbers(r);
  const t = n.timeline;
  const done = t?.phase === "done";
  const accepted = r.cafes.filter((x) => x.status === "accepted");

  // every day of the run, the days still to come empty, plus any scans in the week after it ended
  const got = new Map(r.daily.map((d) => [d.day.slice(0, 10), d]));
  const days: ScanDay[] = [];
  if (t) {
    const span = Math.max(t.total, r.daily.length);
    for (let i = 0; i < span; i++) {
      const day = addDays(t.start, i);
      const iso = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
      const g = got.get(iso);
      days.push({ day, scans: g ? g.scans : i < r.daily.length ? 0 : null, scanners: g?.scanners ?? 0, after: i >= t.total });
    }
  }
  const best = r.daily.reduce<Report["daily"][number] | null>((b, d) => (d.scans > (b?.scans ?? 0) ? d : b), null);

  const tiles: Tile[] = !n.live ? campaignMetrics(r).items : [
    n.hasQr
      ? { k: "QR scans", v: num(n.scans), sub: n.scans ? `by ${plural(n.scanners, "person", "people")}` : "None yet" }
      : { k: "QR scans", v: "Not tracked", sub: "No trackable QR on this sleeve" },
    n.hasQr
      ? { k: "Scan rate", v: n.scanRate == null ? "—" : pct(n.scanRate), sub: `Typical is ${TYPICAL_SCAN_RATE}` }
      : { k: "Cafés serving it", v: num(accepted.length), sub: `of ${plural(r.cafes.length, "café")}` },
    { k: "People reached", v: num(n.reached), sub: `≈ ${ROI_ASSUMPTIONS.impressionsPerSleeve} per sleeve`, est: true },
    { k: "Sleeves handed out", v: num(n.handedOut), sub: `of ${num(n.sleevesOn)} at ${plural(accepted.length, "café")}`, est: true },
    n.hasQr
      ? { k: "Cost per scan", v: n.costPerScan == null ? "—" : money(n.costPerScan, { cents: true }), sub: n.costPerScan == null ? "After the first scan" : done ? `${money(n.spend)} spent` : `${money(n.spentSoFar)} of ${money(n.spend)} so far` }
      : { k: "Spent", v: money(n.spend), sub: r.paid_at ? `Paid ${shortDate(dayOf(r.paid_at))}` : "" },
    { k: "Cost per 1,000 people", v: n.cpm == null ? "—" : money(n.cpm, { cents: true }), sub: "Reached, at the estimate above", est: true },
  ];

  const notes: string[] = [];
  if (n.live) {
    if (n.hasQr && n.scanRate != null && n.handedOut > 0) {
      const lo = ROI_ASSUMPTIONS.scanRateLow, hi = ROI_ASSUMPTIONS.scanRateHigh;
      notes.push(`${pct(n.scanRate)} of sleeves handed out were scanned, ${n.scanRate > hi ? "above" : n.scanRate < lo ? "below" : "inside"} the typical ${TYPICAL_SCAN_RATE} for coffee-sleeve QR codes.`);
    }
    if (best && best.scans > 0) notes.push(`Busiest day: ${shortDate(dayOf(best.day))}, with ${plural(best.scans, "scan")}.`);
    if (accepted.length < r.cafes.length) {
      notes.push(`${accepted.length} of ${plural(r.cafes.length, "café")} ${done ? "ran it" : accepted.length === 1 ? "is running it" : "are running it"}, so it ${done ? "reached" : "is on track to reach"} about ${num(n.sleevesOn * ROI_ASSUMPTIONS.impressionsPerSleeve)} people rather than the ${num(n.projected.reach)} projected at launch.`);
    } else {
      notes.push(`Every café you picked ran it. ${done ? "It reached" : "It's on track to reach"} about ${num(n.projected.reach)} people, as projected at launch.`);
    }
  }

  const cafeStatus = (s: string) => (s === "accepted" ? (done ? "Ran it" : "Serving it") : s === "declined" ? "Passed" : "No reply");

  return (
    <>
      <AppBar />
      <main className="mp-page rep">
        <Link href="/home#campaigns" className="rep-back">← Your campaigns</Link>
        <header className="rep-head">
          <div>
            <span className="eyebrow">{r.startup.name}</span>
            <h1>{done ? "Campaign report" : n.live ? "Live report" : "Campaign plan"}</h1>
            <p>{r.name}</p>
          </div>
          <div className="rep-acts">
            <span className={`mp-pill ${campaignPill(r).cls}`}>{campaignPill(r).label}</span>
            <button type="button" className="mp-btn" onClick={() => window.print()}>Save as PDF</button>
          </div>
        </header>

        {t && <CampaignTimeline t={t} big />}
        {!n.live && <p className="mp-note">This report fills in once cafés start serving your sleeves. Until then, here&apos;s what the campaign is set up to do.</p>}

        <section className="rep-tiles" aria-label="Headline numbers">
          {tiles.map((m) => (
            <div key={m.k} className="rep-tile">
              <span>{m.k}{m.est && <em> · est.</em>}</span>
              <b>{m.v}</b>
              <small>{m.sub}</small>
            </div>
          ))}
        </section>

        {n.live && n.hasQr && days.length > 0 && (
          <section className="rep-card">
            <div className="rc-head">
              <h2>QR scans per day</h2>
              <small>{done ? `${plural(n.scans, "scan")} over ${plural(t!.total, "day")}` : `${plural(n.scans, "scan")} so far · day ${Math.min(t!.day, t!.total)} of ${t!.total}`}</small>
            </div>
            <ScanChart days={days} />
            <details className="rep-table">
              <summary>Daily numbers</summary>
              <table>
                <thead><tr><th>Day</th><th>Scans</th><th>People</th></tr></thead>
                <tbody>
                  {r.daily.map((d) => <tr key={d.day}><td>{shortDate(dayOf(d.day))}</td><td>{num(d.scans)}</td><td>{num(d.scanners)}</td></tr>)}
                </tbody>
              </table>
            </details>
          </section>
        )}

        {notes.length > 0 && (
          <section className="rep-card">
            <div className="rc-head"><h2>How it compares</h2></div>
            <ul className="rep-notes">{notes.map((x) => <li key={x}>{x}</li>)}</ul>
          </section>
        )}

        <section className="rep-card">
          <div className="rc-head"><h2>Cafés</h2><small>{plural(r.sleeves_per_cafe, "sleeve")} each{r.branded_drink ? " · with a branded drink" : ""}</small></div>
          <div className="mp-lines">
            {r.cafes.map((x) => (
              <div key={x.cafe_name + x.city}>
                <span>{x.cafe_name}<small>{[x.neighborhood, x.city].filter(Boolean).join(", ")}{x.is_demo ? " · sample café" : ""}</small></span>
                <span className={`mp-pill ${x.status}`}>{cafeStatus(x.status)}</span>
              </div>
            ))}
          </div>
        </section>

        {r.design_url && (
          <section className="rep-card">
            <div className="rc-head"><h2>Your sleeve</h2></div>
            <img className="rep-sleeve" src={r.design_url} alt={`${r.startup.name} sleeve`} />
          </section>
        )}

        <p className="mp-note rep-foot">
          How we count: a scan is counted when someone opens the link in your sleeve&apos;s QR code while the campaign runs, or in the week after.
          Repeat scans from the same phone count once under people. Sleeves handed out spreads each café&apos;s sleeves evenly over the run, and
          people reached assumes about {ROI_ASSUMPTIONS.impressionsPerSleeve} people see each sleeve. Both are estimates.
        </p>
      </main>
    </>
  );
}
