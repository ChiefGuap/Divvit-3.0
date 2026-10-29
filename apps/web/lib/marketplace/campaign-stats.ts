/* Where a campaign is in time, and what it has done (or is projected to do).
   Measured: QR scans (the sleeve's code goes through divvit.app/s/<code>).
   Estimated: sleeves handed out (the cafés' sleeves, spread evenly over the run) and
   people reached (ROI_ASSUMPTIONS.impressionsPerSleeve per sleeve); the UI labels these. */

import { ROI_ASSUMPTIONS } from "./roi";
import { plural } from "./format";

export type CampaignLike = {
  status: string; start_date: string | null; weeks: number; total_cents: number; final_cents: number | null;
  has_qr?: boolean; scans?: number; scanners?: number; roi?: { impressions?: number } | null;
  cafes: { status: string; sleeves: number }[];
};

const DAY = 86_400_000;
// noon local time, so whole-day differences don't wobble with time zones or daylight saving
export const dayOf = (d: string) => new Date(`${d.slice(0, 10)}T12:00`);
const today = () => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate(), 12); };
export const shortDate = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
export const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY);

export type Timeline = {
  start: Date; last: Date; total: number;
  /** today as a day of the run: 1 on the start date, total on the last day; ≤ 0 before it starts */
  day: number;
  phase: "planned" | "waiting" | "running" | "done";
  /** how much of the run is behind us, 0–1 */
  progress: number;
  label: string;
};

export function timeline(c: Pick<CampaignLike, "status" | "start_date" | "weeks">): Timeline | null {
  if (!c.start_date || c.status === "declined" || c.status === "cancelled") return null;
  const start = dayOf(c.start_date), total = c.weeks * 7;
  const last = addDays(start, total - 1);
  const day = Math.round((today().getTime() - start.getTime()) / DAY) + 1;
  const base = { start, last, total, day };
  const startsIn = (after: string) =>
    ({ ...base, phase: "planned" as const, progress: 0, label: `${day === 0 ? "Starts tomorrow" : `Starts in ${plural(1 - day, "day")}`}${after}` });

  if (c.status === "completed" || (c.status === "active" && day > total)) {
    return { ...base, phase: "done", progress: 1, label: `Finished ${shortDate(last)}` };
  }
  if (c.status === "active") {
    if (day < 1) return startsIn("");
    const left = total - day;
    return { ...base, phase: "running", progress: day / total, label: `Day ${day} of ${total} · ${left ? `${plural(left, "day")} left` : "last day"}` };
  }
  if (day < 1) return startsIn(c.status === "paid" ? "" : c.status === "approved" ? ", once paid" : ", once approved");
  return { ...base, phase: "waiting", progress: 0, label: c.status === "paid" ? "Waiting on cafés to accept" : "Start date to be confirmed" };
}

export function campaignNumbers(c: CampaignLike) {
  const a = ROI_ASSUMPTIONS;
  const t = timeline(c);
  // running once its start date comes (a café accepting makes it active, maybe weeks ahead)
  const live = c.status === "completed" || (c.status === "active" && t != null && t.phase !== "planned");
  const sleevesOn = c.cafes.filter((x) => x.status === "accepted").reduce((s, x) => s + x.sleeves, 0);
  const sleevesPlanned = c.cafes.filter((x) => x.status !== "declined").reduce((s, x) => s + x.sleeves, 0);
  const share = live && t ? Math.max(0, Math.min(1, t.phase === "done" ? 1 : t.day / t.total)) : 0;
  const handedOut = Math.round(sleevesOn * share);
  const reached = handedOut * a.impressionsPerSleeve;
  const spend = c.final_cents ?? c.total_cents;
  // while it runs, judge it on the share of the spend that has run so far
  const spentSoFar = Math.round(spend * share);
  const scans = c.scans ?? 0;
  const projectedReach = c.roi?.impressions || sleevesPlanned * a.impressionsPerSleeve;
  return {
    live, timeline: t, spend, spentSoFar, sleevesOn, sleevesPlanned, handedOut, reached, scans, scanners: c.scanners ?? 0,
    hasQr: Boolean(c.has_qr),
    /** scans per sleeve handed out */
    scanRate: handedOut ? scans / handedOut : null,
    costPerScan: scans && spentSoFar ? spentSoFar / scans : null,
    /** cents per 1,000 people reached (the same so far as for the whole run) */
    cpm: sleevesOn ? spend / ((sleevesOn * a.impressionsPerSleeve) / 1000) : null,
    projected: {
      reach: projectedReach,
      scansLow: Math.round(sleevesPlanned * a.scanRateLow), scansHigh: Math.round(sleevesPlanned * a.scanRateHigh),
      cpm: projectedReach ? spend / (projectedReach / 1000) : null,
    },
  };
}

export const TYPICAL_SCAN_RATE = `${ROI_ASSUMPTIONS.scanRateLow * 100}–${ROI_ASSUMPTIONS.scanRateHigh * 100}%`;
export const pct = (x: number) => `${(x * 100).toFixed(x < 0.1 ? 1 : 0)}%`;

// submitted → approved → paid → active → completed (see the campaign_review_payment migration)
const STATUS: Record<string, string> = { submitted: "In review", approved: "Ready to pay", paid: "Sent to cafés", active: "Live", completed: "Finished", declined: "Not approved", cancelled: "Cancelled" };
export const statusLabel = (s: string) => STATUS[s] ?? s;
/** the pill for a campaign: an active one that hasn't reached its start date is "Scheduled" */
export function campaignPill(c: Pick<CampaignLike, "status" | "start_date" | "weeks">) {
  return c.status === "active" && timeline(c)?.phase === "planned" ? { cls: "paid", label: "Scheduled" } : { cls: c.status, label: statusLabel(c.status) };
}
