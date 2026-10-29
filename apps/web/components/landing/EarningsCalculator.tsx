"use client";

/* "What could your café earn?" — add your café locations, slide how many cups
   you'd make available, see the revenue. Per-cup rates come from the database
   (mp_cafe_rate, the same rate payouts use), one per market tier; every 350
   cups is one day of placement. */

import React from "react";
import { createClient } from "@/lib/supabase/client";
import { marketTier } from "@/lib/marketplace/markets";

const CUPS_PER_DAY = 350;
const MIN = CUPS_PER_DAY, MAX = CUPS_PER_DAY * 30;

type Spot = { id: string; label: string; city: string; tier: 1 | 2 | 3 };
type Result = { id: string; name: string; label: string; city: string | null };

const money = (cents: number) => (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const num = (n: number) => n.toLocaleString("en-US");

function LocationField({ onAdd }: { onAdd: (s: Spot) => void }) {
  const [q, setQ] = React.useState("");
  const [results, setResults] = React.useState<Result[]>([]);
  const [hi, setHi] = React.useState(0);
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    if (q.trim().length < 2) { setResults([]); return; }
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/geocode?mode=address&q=${encodeURIComponent(q)}`, { signal: ctl.signal });
        const data = await r.json();
        setResults((data.results ?? []).slice(0, 5)); setHi(0); setOpen(true);
      } catch { /* typing */ }
    }, 220);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [q]);

  const pick = (r: Result) => {
    const city = r.city || r.name;
    onAdd({ id: r.id, label: r.label.split(",").slice(0, 2).join(","), city, tier: marketTier(city) });
    setQ(""); setResults([]); setOpen(false);
  };

  return (
    <div className="ec-field">
      <input value={q} placeholder="Add a café location" aria-label="Add a café location" autoComplete="off"
        onChange={(e) => setQ(e.target.value)} onBlur={() => setTimeout(() => setOpen(false), 150)} onFocus={() => results.length && setOpen(true)}
        onKeyDown={(e) => {
          if (!open || !results.length) return;
          if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => Math.min(h + 1, results.length - 1)); }
          if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
          if (e.key === "Enter") { e.preventDefault(); pick(results[hi]); }
          if (e.key === "Escape") setOpen(false);
        }} />
      {open && results.length > 0 && (
        <div className="ec-list" role="listbox">
          {results.map((r, i) => (
            <button key={r.id} type="button" role="option" aria-selected={i === hi} className={i === hi ? "hi" : ""}
              onMouseDown={(e) => e.preventDefault()} onClick={() => pick(r)}>
              <b>{r.name}</b><small>{r.label}</small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function EarningsCalculator() {
  const [rates, setRates] = React.useState<Record<number, number> | null>(null);   // cents per cup, by tier
  const [spots, setSpots] = React.useState<Spot[]>([]);
  const [cups, setCups] = React.useState(CUPS_PER_DAY * 10);

  React.useEffect(() => {
    const supabase = createClient();
    Promise.all([1, 2, 3].map((t) => supabase.rpc("mp_cafe_rate", { p_market_tier: t })))
      .then((rs) => { if (rs.every((r) => !r.error)) setRates({ 1: Number(rs[0].data), 2: Number(rs[1].data), 3: Number(rs[2].data) }); });
  }, []);

  // no location yet: show a mid-size city's rate
  const tiers = spots.length ? spots.map((s) => s.tier) : [2];
  const cents = rates ? tiers.reduce((sum, t) => sum + cups * rates[t], 0) : null;
  const days = cups / CUPS_PER_DAY;
  const p = ((cups - MIN) / (MAX - MIN)) * 100;

  return (
    <div className="ec">
      <div className="ec-in">
        <span className="ec-k">Your café locations</span>
        <div className="ec-chips">
          {spots.map((s) => (
            <button key={s.id} type="button" className="ec-chip" onClick={() => setSpots((x) => x.filter((y) => y.id !== s.id))} aria-label={`Remove ${s.label}`}>
              {s.label} <span aria-hidden="true">×</span>
            </button>
          ))}
        </div>
        {spots.length < 10 && <LocationField onAdd={(s) => setSpots((x) => (x.some((y) => y.id === s.id) ? x : [...x, s]))} />}

        <div className="ec-slider">
          <input type="range" min={MIN} max={MAX} step={CUPS_PER_DAY} value={cups} onChange={(e) => setCups(Number(e.target.value))}
            style={{ "--p": `${p}%` } as React.CSSProperties} aria-label="Cups for placement" aria-valuetext={`${num(cups)} cups, ${days} days`} />
          <div className="ec-row"><span>Cups for placement{spots.length > 1 ? " (each)" : ""}</span><b>{num(cups)}</b></div>
        </div>
      </div>

      <div className="ec-out" aria-live="polite">
        <span className="ec-k">You&apos;d earn</span>
        <b className="ec-big">{cents === null ? "—" : money(cents)}</b>
        <span className="ec-sub">
          {days} {days === 1 ? "day" : "days"} of placement{spots.length > 1 ? ` · ${spots.length} locations` : ""}
        </span>
        <span className="ec-note">Every 350 cups = 1 day.{spots.length ? "" : " Add a location for your city's rate."}</span>
      </div>
    </div>
  );
}
