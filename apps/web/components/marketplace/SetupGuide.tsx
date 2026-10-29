"use client";

/* Setup guide for first-time users (Shopify-style): the handful of things to do,
   in order, with progress. One step is open at a time — the first unfinished one
   to begin with — and says what to do with a button that goes there. Steps tick
   themselves off from real data; ones we can't detect (`done` left undefined) are
   ticked by hand. Collapsing, ticks and hiding stick per user on this device. */

import React from "react";
import { Art, type ArtName } from "./art";
import { Icon } from "./dashboard/icons";

export type GuideStep = {
  id: string; title: string; body: React.ReactNode; art: ArtName;
  /** from real data; leave undefined for a step the user ticks off themselves */
  done?: boolean;
  actions?: React.ReactNode;
  /** full-width content under the step (e.g. the verify panel) */
  extra?: React.ReactNode;
};
type Saved = { collapsed?: boolean; hidden?: boolean; ticked?: string[] };

export function SetupGuide({ storageKey, title, sub, steps }: { storageKey: string; title: string; sub: string; steps: GuideStep[] }) {
  const [saved, setSaved] = React.useState<Saved>({});
  const [open, setOpen] = React.useState<string | null | undefined>(undefined); // undefined: the first unfinished step
  React.useEffect(() => {
    try { setSaved(JSON.parse(localStorage.getItem(storageKey) || "{}")); } catch { /* starts fresh */ }
  }, [storageKey]);
  const save = (next: Saved) => {
    setSaved(next);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* only lasts this visit */ }
  };

  const ticked = new Set(saved.ticked ?? []);
  const isDone = (s: GuideStep) => s.done ?? ticked.has(s.id);
  const doneCount = steps.filter(isDone).length;
  const allDone = doneCount === steps.length;
  const current = open === undefined ? (steps.find((s) => !isDone(s))?.id ?? null) : open;
  const tick = (id: string) => save({ ...saved, ticked: ticked.has(id) ? [...ticked].filter((x) => x !== id) : [...ticked, id] });
  if (saved.hidden) return null;

  return (
    <section className={`guide${allDone ? " all-done" : ""}`} aria-label={title}>
      <div className="g-head">
        <div className="g-title">
          <h2>{allDone ? "You're all set" : title}</h2>
          <p>{allDone ? "Every step is done. You can hide this guide now." : sub}</p>
          <div className="g-prog">
            <span>{doneCount} / {steps.length} completed</span>
            <span className="bar"><i style={{ width: `${Math.max(4, (doneCount / steps.length) * 100)}%` }} /></span>
          </div>
        </div>
        {allDone && (
          <button type="button" className="g-icon" aria-label="Hide setup guide" title="Hide guide" onClick={() => save({ ...saved, hidden: true })}>
            <Icon name="x" size={18} />
          </button>
        )}
        <button type="button" className={`g-icon${saved.collapsed ? "" : " up"}`} aria-expanded={!saved.collapsed}
          aria-label={saved.collapsed ? "Show steps" : "Hide steps"} onClick={() => save({ ...saved, collapsed: !saved.collapsed })}>
          <Icon name="down" size={18} />
        </button>
      </div>

      {!saved.collapsed && (
        <ol className="g-steps">
          {steps.map((s) => {
            const done = isDone(s), on = current === s.id, manual = s.done === undefined;
            return (
              <li key={s.id} className={`g-step${on ? " on" : ""}${done ? " done" : ""}`}>
                <div className="g-row">
                  <button type="button" className="g-ring" disabled={!manual} aria-pressed={done}
                    aria-label={manual ? `${done ? "Untick" : "Tick off"} “${s.title}”` : done ? "Done" : "Not done yet"} onClick={() => tick(s.id)}>
                    {done && <Icon name="check" size={13} />}
                  </button>
                  <button type="button" className="g-name" aria-expanded={on} onClick={() => setOpen(on ? null : s.id)}>{s.title}</button>
                </div>
                {on && (
                  <div className="g-body">
                    <div className="g-text">
                      <p>{s.body}</p>
                      {(s.actions || manual) && (
                        <div className="g-acts">
                          {s.actions}
                          {manual && <button type="button" className="mp-link" onClick={() => tick(s.id)}>{done ? "Mark as not done" : "Mark as done"}</button>}
                        </div>
                      )}
                    </div>
                    {!s.extra && <span className="g-pic" aria-hidden="true"><Art name={s.art} /></span>}
                    {s.extra && <div className="g-extra">{s.extra}</div>}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
