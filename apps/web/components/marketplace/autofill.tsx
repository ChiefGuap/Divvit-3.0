"use client";

/* Shared pieces for "Is this you?" autofill: the list of matches under a name
   input, and the card that says what we filled in and where it came from. */

import React from "react";
import { proxied } from "@/lib/marketplace/images";

/** A remote logo, or the first letter (or an icon) when there isn't one or it won't load. */
function Logo({ src, fallback, className }: { src?: string | null; fallback: React.ReactNode; className: string }) {
  const [bad, setBad] = React.useState(false);
  React.useEffect(() => setBad(false), [src]);
  return src && !bad ? <img src={proxied(src)!} alt="" onError={() => setBad(true)} /> : <span className={className}>{fallback}</span>;
}

export type MatchRow = { key: string; title: string; line: string; logo?: string | null; icon?: React.ReactNode; tag?: { text: string; className?: string } };

export function MatchList({ label, rows, picking, onPick }: {
  label: string; rows: MatchRow[]; picking: string | null; onPick: (key: string) => void;
}) {
  if (!rows.length) return null;
  return (
    <div className="mp-matches" aria-live="polite">
      <span>{label}</span>
      {rows.map((m, k) => (
        <button key={m.key} type="button" style={{ "--i": k } as React.CSSProperties} disabled={Boolean(picking)}
          className={`mp-match${picking === m.key ? " busy" : ""}`} onClick={() => onPick(m.key)}>
          <Logo src={m.logo} fallback={m.icon ?? m.title[0]} className="mp-logo-ph" />
          <span><b>{m.title}</b><small>{m.line}</small></span>
          {picking === m.key ? <span className="mp-spin" aria-label="Looking it up" />
            : m.tag && <span className={`src ${m.tag.className ?? ""}`}>{m.tag.text}</span>}
        </button>
      ))}
    </div>
  );
}

/** "a", "a and b", "a, b and c" */
export const joinWords = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

export function FoundCard({ logo, icon, title, facts, from, onUndo }: {
  logo?: string | null; icon?: React.ReactNode; title: string; facts: React.ReactNode[]; from: string[]; onUndo?: () => void;
}) {
  const shown = facts.filter(Boolean);
  return (
    <div className="mp-found rich">
      <Logo src={logo} fallback={icon ?? title[0]} className="ph" />
      <div className="what">
        <b>{title}</b>
        {shown.length > 0 && <div className="facts">{shown.map((f, k) => <span key={k}>{f}</span>)}</div>}
        {from.length > 0 && <span className="from">Filled in from {joinWords(from)}</span>}
      </div>
      {onUndo && <button type="button" className="not" onClick={onUndo}>Not you?</button>}
    </div>
  );
}

export const Ext = ({ href, children }: { href: string; children: React.ReactNode }) => (
  <a href={href} target="_blank" rel="noreferrer noopener">{children}</a>
);

export const domainOf = (u: string) => {
  try { return new URL(/^https?:\/\//i.test(u.trim()) ? u.trim() : `https://${u.trim()}`).hostname.replace(/^www\./, "").toLowerCase(); }
  catch { return ""; }
};

/** A LinkedIn company page in the one shape we store, or "" if it isn't one. */
export const normLinkedIn = (v: string) => {
  const m = v.trim().match(/linkedin\.com\/(company|school|showcase)\/([A-Za-z0-9_%.-]+)/i);
  return m ? `https://www.linkedin.com/${m[1].toLowerCase()}/${m[2]}/` : "";
};
