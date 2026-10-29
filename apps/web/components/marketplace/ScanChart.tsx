"use client";

/* QR scans per day of a campaign: one column per day, the days still to come
   tinted. Hover a day (or focus the chart and use the arrow keys) for its numbers;
   the report also lists them in a table. */

import React from "react";
import { shortDate } from "@/lib/marketplace/campaign-stats";
import { num, plural } from "@/lib/marketplace/format";

export type ScanDay = { day: Date; scans: number | null; scanners: number; after?: boolean };

const H = 210, PAD = { l: 34, r: 6, t: 14, b: 26 };

function niceTop(max: number) {
  if (max <= 4) return 4;
  const p = 10 ** Math.floor(Math.log10(max));
  return [1, 2, 4, 5, 10].map((m) => m * p).find((v) => v >= max)!;
}

// a column with a 4px rounded top, square on the baseline
function column(x: number, w: number, base: number, h: number) {
  const r = Math.min(4, w / 2, h);
  return `M${x},${base}V${base - h + r}A${r},${r} 0 0 1 ${x + r},${base - h}H${x + w - r}A${r},${r} 0 0 1 ${x + w},${base - h + r}V${base}Z`;
}

export function ScanChart({ days }: { days: ScanDay[] }) {
  const box = React.useRef<HTMLDivElement>(null);
  const [w, setW] = React.useState(640);
  const [hover, setHover] = React.useState<number | null>(null);
  React.useEffect(() => {
    const ro = new ResizeObserver(([e]) => setW(Math.max(260, Math.round(e.contentRect.width))));
    ro.observe(box.current!);
    return () => ro.disconnect();
  }, []);

  const iw = w - PAD.l - PAD.r, ih = H - PAD.t - PAD.b, base = PAD.t + ih;
  const top = niceTop(Math.max(0, ...days.map((d) => d.scans ?? 0)));
  const ticks = Number.isInteger(top / 2) ? [0, top / 2, top] : [0, top];
  const band = iw / days.length;
  const bw = Math.max(2, Math.min(24, band - 2));
  const x = (i: number) => PAD.l + i * band + (band - bw) / 2;
  const every = days.length > 63 ? 14 : 7;
  const future = days.findIndex((d) => d.scans === null);
  const h = hover == null ? null : days[hover];

  const key = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const last = future === -1 ? days.length - 1 : Math.max(0, future - 1);
    setHover((i) => Math.max(0, Math.min(last, (i ?? -1) + (e.key === "ArrowRight" ? 1 : -1))));
  };

  return (
    <div ref={box} className="scan-chart">
      <svg width={w} height={H} role="img" tabIndex={0} onKeyDown={key} onBlur={() => setHover(null)} onPointerLeave={() => setHover(null)}
        aria-label={`QR scans per day, ${shortDate(days[0].day)} to ${shortDate(days[days.length - 1].day)}. Use the arrow keys to read each day.`}>
        {future > 0 && <rect className="sc-future" x={PAD.l + future * band} y={PAD.t} width={iw - future * band} height={ih} />}
        {ticks.map((v) => (
          <g key={v}>
            <line className="sc-grid" x1={PAD.l} x2={w - PAD.r} y1={base - (v / top) * ih} y2={base - (v / top) * ih} />
            <text className="sc-tick" x={PAD.l - 8} y={base - (v / top) * ih + 4} textAnchor="end">{num(v)}</text>
          </g>
        ))}
        {days.map((d, i) => {
          if (i % every) return null;
          // the first label starts at the axis; one near the right edge ends at it, so neither is clipped
          const mid = PAD.l + i * band + band / 2;
          const end = mid > w - PAD.r - 24;
          return (
            <text key={`l${i}`} className="sc-tick" y={H - 8} x={i === 0 ? PAD.l : end ? w - PAD.r : mid}
              textAnchor={i === 0 ? "start" : end ? "end" : "middle"}>{shortDate(d.day)}</text>
          );
        })}
        {days.map((d, i) => d.scans ? (
          <path key={`b${i}`} className={`sc-bar${hover === i ? " on" : ""}`} d={column(x(i), bw, base, (d.scans / top) * ih)} />
        ) : null)}
        {days.map((_, i) => (
          <rect key={`h${i}`} className="sc-hit" x={PAD.l + i * band} y={PAD.t} width={band} height={ih} onPointerEnter={() => setHover(i)} />
        ))}
      </svg>
      {h && hover != null && (
        <div className="sc-tip" style={{ left: Math.min(Math.max(PAD.l + hover * band + band / 2, 70), w - 70) }}>
          {h.scans === null ? <b>Still to come</b> : <b>{plural(h.scans, "scan")}</b>}
          <span>{shortDate(h.day)}{h.scans ? ` · ${plural(h.scanners, "person", "people")}` : ""}{h.after ? " · after it ended" : ""}</span>
        </div>
      )}
    </div>
  );
}
