/* Hours a week from an opening_hours string — the OpenStreetMap / schema.org
   format, e.g. "Mo-Fr 07:00-18:00; Sa,Su 08:00-16:00; PH off". Handles the
   common shapes; anything fancier returns null rather than a wrong number. */

const DAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

function daysOf(spec: string): number[] | null {
  const out = new Set<number>();
  for (const part of spec.split(",").map((s) => s.trim()).filter(Boolean)) {
    const [a, b] = part.split("-").map((s) => DAYS.indexOf(s.slice(0, 2)));
    if (a < 0 || (part.includes("-") && b < 0)) return null;
    if (!part.includes("-")) out.add(a);
    else for (let k = a; ; k = (k + 1) % 7) { out.add(k); if (k === b) break; }
  }
  return [...out];
}

function minutesOf(spans: string): number | null {
  let total = 0;
  for (const span of spans.split(",").map((s) => s.trim()).filter(Boolean)) {
    const m = span.match(/^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})\+?$/);
    if (!m) return null;
    const from = +m[1] * 60 + +m[2];
    let to = +m[3] * 60 + +m[4];
    if (to <= from) to += 24 * 60; // past midnight
    total += to - from;
  }
  return total;
}

export function hoursPerWeek(raw: string | null | undefined): number | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  if (s === "24/7") return 168;
  const perDay: (number | null)[] = Array(7).fill(null);
  for (const rule of s.split(";").map((r) => r.trim()).filter(Boolean)) {
    if (/^(PH|SH)\b/.test(rule)) continue; // holidays don't change a normal week
    const m = rule.match(/^((?:(?:Mo|Tu|We|Th|Fr|Sa|Su)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?,?\s*)+)?\s*(.*)$/);
    if (!m) return null;
    const days = m[1] ? daysOf(m[1].replace(/\s+/g, "")) : [0, 1, 2, 3, 4, 5, 6];
    const rest = m[2].trim();
    if (!days) return null;
    const mins = /^(off|closed)$/i.test(rest) ? 0 : minutesOf(rest);
    if (mins === null) return null;
    for (const d of days) perDay[d] = mins;
  }
  if (perDay.every((x) => x === null)) return null;
  return Math.round(perDay.reduce<number>((a, x) => a + (x ?? 0), 0) / 60);
}
