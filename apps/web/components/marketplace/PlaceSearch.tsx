"use client";

/* City / neighborhood / address search (→ /api/geocode). */

import React from "react";

export type Place = {
  id: string; label: string; name: string; lat: number; lng: number; bbox: [number, number, number, number];
  city: string | null; region: string | null; neighborhood: string | null; address: string | null; type: string | null;
};

export function PlaceSearch({ onPick, placeholder, mode = "place", autoFocus }: {
  onPick: (p: Place) => void; placeholder?: string; mode?: "place" | "address"; autoFocus?: boolean;
}) {
  const [q, setQ] = React.useState("");
  const [results, setResults] = React.useState<Place[]>([]);
  const [open, setOpen] = React.useState(false);
  const [hi, setHi] = React.useState(0);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (q.trim().length < 2) { setResults([]); return; }
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/geocode?mode=${mode}&q=${encodeURIComponent(q)}`, { signal: ctl.signal });
        const data = await r.json();
        setResults(data.results ?? []);
        setError(data.error ?? null);
        setHi(0);
        setOpen(true);
      } catch { /* aborted */ }
    }, 220);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [q, mode]);

  const pick = (p: Place) => { onPick(p); setQ(""); setResults([]); setOpen(false); };

  return (
    <div className="mp-suggest">
      <input
        className="mp-input" value={q} autoFocus={autoFocus}
        placeholder={placeholder ?? "Search a city or neighborhood"}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => results.length && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (!open || !results.length) return;
          if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => Math.min(h + 1, results.length - 1)); }
          if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
          if (e.key === "Enter") { e.preventDefault(); pick(results[hi]); }
          if (e.key === "Escape") setOpen(false);
        }}
      />
      {open && (results.length > 0 || error) && (
        <div className="mp-suggest-list">
          {error && <div className="mp-small mp-muted" style={{ padding: 10 }}>{error}</div>}
          {results.map((r, i) => (
            <button key={r.id} className={i === hi ? "hi" : ""} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(r)}>
              <span className="mp-logo-ph">📍</span>
              <span><b>{r.name}</b><small>{r.label}</small></span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
