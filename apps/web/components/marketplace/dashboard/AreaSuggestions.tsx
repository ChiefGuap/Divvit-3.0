"use client";

/* "Suggested for you": neighborhoods whose coffee drinkers match the startup,
   from its description (/api/suggest-areas), as a list. One click adds the
   area to the map. */

import React from "react";
import { Icon } from "./icons";
import type { Suggestion } from "@/lib/marketplace/audiences";
import type { Area } from "@/lib/marketplace/network";
import type { Cafe } from "@/lib/marketplace/types";

/** the cafés of one neighborhood, as a map area */
export function hoodArea(cafes: Cafe[], city: string, neighborhood: string): Area | null {
  const pts = cafes.filter((c) => c.city === city && c.neighborhood === neighborhood);
  if (!pts.length) return null;
  const pad = 0.006;
  const lng = pts.map((c) => c.lng), lat = pts.map((c) => c.lat);
  return {
    id: `hood:${city}|${neighborhood}`, label: `${neighborhood}, ${city}`,
    bbox: [Math.min(...lng) - pad, Math.min(...lat) - pad, Math.max(...lng) + pad, Math.max(...lat) + pad],
  };
}

export function AreaSuggestions({ name, description, cafes, areas, onAdd }: {
  name: string; description: string; cafes: Cafe[]; areas: Area[]; onAdd: (a: Area) => void;
}) {
  const [text, setText] = React.useState(description);
  const [editing, setEditing] = React.useState(false);
  const [state, setState] = React.useState<{ source: string; suggestions: Suggestion[] } | null>(null);
  const [busy, setBusy] = React.useState(false);

  const run = React.useCallback(async (desc?: string) => {
    setBusy(true);
    try {
      const r = await fetch("/api/suggest-areas", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(desc === undefined ? {} : { description: desc }) });
      if (r.ok) setState(await r.json());
    } finally {
      setBusy(false);
    }
  }, []);
  React.useEffect(() => { run(); }, [run]);

  const added = new Set(areas.map((a) => a.id));
  return (
    <section className="dash-col" aria-busy={busy}>
      <div className="col-head">
        <h2>Suggested for {name}</h2>
        <small>{state?.source === "ai" ? "Picked by AI from your description" : "Matched to your description and audience"}</small>
      </div>

      <ul className="lib">
        {!state && Array.from({ length: 5 }, (_, i) => <li key={i} className="lib-row skeleton" />)}
        {state?.suggestions.length === 0 && <li className="mp-note">No neighborhoods match yet — pick one on the map below.</li>}
        {state?.suggestions.map((s) => {
          const area = hoodArea(cafes, s.city, s.neighborhood);
          const on = area ? added.has(area.id) : false;
          return (
            <li key={s.id} className={`lib-row${on ? " on" : ""}`}>
              <span className="orb"><Icon name={on ? "check" : "pin"} size={17} /></span>
              <span className="t">
                <b>{s.neighborhood}<em> · {s.city} · {s.cafes} {s.cafes === 1 ? "café" : "cafés"}</em></b>
                <small title={`${s.audience} — ${s.reason}`}>{s.audience} — {s.reason}</small>
              </span>
              <button type="button" className="mp-btn sm" disabled={!area || on} onClick={() => area && onAdd(area)}>
                {on ? "Added" : "Add to map"}
              </button>
            </li>
          );
        })}
      </ul>

      {editing && (
        <form className="lib-edit" onSubmit={(e) => { e.preventDefault(); setEditing(false); run(text); }}>
          <textarea className="mp-input" rows={2} maxLength={600} value={text} onChange={(e) => setText(e.target.value)}
            placeholder="Who are you trying to reach? e.g. college students who study in cafés" />
          <div className="btns">
            <button className="mp-btn" type="button" onClick={() => setEditing(false)}>Cancel</button>
            <button className="mp-btn primary" type="submit" disabled={busy || text.trim().length < 3}>Suggest again</button>
          </div>
        </form>
      )}
      {!editing && <button type="button" className="mp-btn more" onClick={() => setEditing(true)}>Change description</button>}
    </section>
  );
}
