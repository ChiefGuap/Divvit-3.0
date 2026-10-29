"use client";

/* Building blocks for the marketplace's one-question-per-screen flows. */

import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname } from "next/navigation";
import React from "react";
import { site } from "@/lib/urls";
import { useMp } from "./session";
import { PlaceSearch } from "./PlaceSearch";
import { citiesOf, eligibleCafes, unionBox, type Area } from "@/lib/marketplace/network";
import { categoryLabel } from "@/lib/marketplace/categories";
import { num } from "@/lib/marketplace/format";
import type { Cafe } from "@/lib/marketplace/types";

// maplibre is most of the marketplace's JavaScript: load it only when a map is on screen
const CafeMap = dynamic(() => import("./CafeMap").then((m) => m.CafeMap), { ssr: false, loading: () => <div className="mp-map" /> });

/* ---------------------------------------------------------------- one question */

export function Question({ title, sub, children, onBack, cta = "Continue", onContinue, canContinue = true, busy, skip, onSkip, wide }: {
  title: React.ReactNode; sub?: React.ReactNode; children?: React.ReactNode; onBack?: () => void;
  cta?: string; onContinue?: () => void; canContinue?: boolean; busy?: boolean; skip?: string; onSkip?: () => void; wide?: boolean;
}) {
  return (
    <form className={`mp-q${wide ? " wide" : ""}`} onSubmit={(e) => { e.preventDefault(); if (canContinue && !busy) onContinue?.(); }}>
      {onBack && <button type="button" className="mp-back" onClick={onBack}>← Back</button>}
      <h1>{title}</h1>
      {sub && <p className="sub">{sub}</p>}
      {children && <div className="body">{children}</div>}
      {(onContinue || skip) && (
        <div className="actions">
          {onContinue && <button className="mp-cta" type="submit" disabled={!canContinue || busy}>{busy ? "One moment…" : cta}</button>}
          {skip && <button type="button" className="mp-skip" onClick={onSkip}>{skip}</button>}
        </div>
      )}
    </form>
  );
}

/* ---------------------------------------------------------------- big choices */

export type Option<T> = { value: T; label: string; hint?: string; art?: React.ReactNode };

export function Choices<T extends string | number | boolean>({ options, value, onChange, cols = 2, center, big }: {
  options: Option<T>[]; value: T | T[] | null; onChange: (v: T) => void; cols?: 1 | 2 | 4; center?: boolean; big?: boolean;
}) {
  const isOn = (v: T) => (Array.isArray(value) ? value.includes(v) : value === v);
  return (
    <div className={`mp-choices${cols === 1 ? " one" : cols === 4 ? " four" : ""}`}>
      {options.map((o, k) => (
        <button key={String(o.value)} type="button" style={{ "--i": k } as React.CSSProperties}
          className={`mp-choice${isOn(o.value) ? " on" : ""}${center ? " center" : ""}${big ? " big" : ""}${o.art ? " has-art" : ""}`}
          onClick={() => onChange(o.value)}>
          {o.art && <span className="mp-choice-art">{o.art}</span>}
          <b>{o.label}</b>
          {o.hint && <small>{o.hint}</small>}
          <span className="mp-tick" aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- motion between questions */

/** Step index plus the motion between steps: the current question slides out
    the way you're going, then the next one slides in and its parts rise in turn. */
export function useSteps(count: number) {
  type S = { i: number; dir: "fwd" | "back"; phase: "in" | "out" };
  const [state, setState] = React.useState<S>({ i: 0, dir: "fwd", phase: "in" });
  const cur = React.useRef(state);
  cur.current = state;
  const timer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  React.useEffect(() => () => clearTimeout(timer.current), []);

  const go = React.useCallback((to: number) => {
    const s = cur.current;
    const target = Math.max(0, Math.min(count - 1, to));
    if (s.phase === "out" || target === s.i) return;
    const dir = target > s.i ? "fwd" : "back";
    cur.current = { ...s, dir, phase: "out" };
    setState(cur.current);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      cur.current = { i: target, dir, phase: "in" };
      setState(cur.current);
      window.scrollTo({ top: 0 });
    }, 190);
  }, [count]);

  return {
    i: state.i,
    next: React.useCallback(() => go(cur.current.i + 1), [go]),
    back: React.useCallback(() => go(cur.current.i - 1), [go]),
    /** move to any step, with the same motion */
    go,
    /** jump without motion (restoring a saved draft) */
    jump: React.useCallback((i: number) => { cur.current = { i, dir: "fwd", phase: "in" }; setState(cur.current); }, []),
    stage: `mp-slide ${state.phase} ${state.dir}`,
  };
}

/* ---------------------------------------------------------------- top bars */

/** Minimal bar for onboarding: wordmark, progress line, one quiet action. */
export function FlowBar({ progress, right }: { progress?: number; right?: React.ReactNode }) {
  return (
    <>
      <header className="mp-top">
        <div className="brand"><a href={site("/")}><img src="/assets/divvit-wordmark-purple.png" alt="Divvit" /></a></div>
        <div className="right">{right}</div>
      </header>
      {progress !== undefined && <div className="mp-progress"><i style={{ width: `${Math.max(4, progress * 100)}%` }} /></div>}
    </>
  );
}

/** Bar for signed-in pages: wordmark, a couple of links, account menu. */
/** nav={false} where the page has its own tabs (the startup home) */
export function AppBar({ nav = true }: { nav?: boolean }) {
  const { supabase, user, profile, signOut } = useMp();
  const pathname = usePathname() || "";
  const on = (p: string) => (pathname.endsWith(p) ? "on" : "");
  const [open, setOpen] = React.useState(false);
  const isCafe = profile?.role === "cafe";
  const [admin, setAdmin] = React.useState(false);
  React.useEffect(() => {
    if (!user) { setAdmin(false); return; }
    supabase.rpc("mp_is_admin").then(({ data }) => setAdmin(data === true));
  }, [user, supabase]);
  return (
    <header className="mp-top lined">
      <div className="brand"><a href={site("/")}><img src="/assets/divvit-wordmark-purple.png" alt="Divvit" /></a></div>
      {nav && <nav className="nav">
        {isCafe ? (
          <>
            <Link href="/cafes/inbox" className={on("/cafes/inbox")}>Inbox</Link>
            <Link href="/start/cafe?edit=1" className={on("/start/cafe")}>My café</Link>
          </>
        ) : (
          <>
            <Link href="/home" className={on("/home")}>Home</Link>
          </>
        )}
      </nav>}
      <div className="right">
        {user && (
          <div style={{ position: "relative" }} onMouseLeave={() => setOpen(false)}>
            <button className="mp-avatar" onClick={() => setOpen((o) => !o)} aria-label="Account">
              {(profile?.full_name || user.email || "?").slice(0, 1).toUpperCase()}
            </button>
            {open && (
              <div className="mp-menu">
                <div className="who">{user.email}</div>
                <Link href={isCafe ? "/start/cafe?edit=1" : "/start/startup?edit=1"}>{isCafe ? "Edit my café" : "Edit my profile"}</Link>
                {admin && <Link href="/admin">Review cafés</Link>}
                <button onClick={() => signOut()}>Sign out</button>
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  );
}

/* ---------------------------------------------------------------- where */

/** Pick cities or neighborhoods; the map zooms to them and lights up the cafés inside. */
export function AreaPicker({ areas, onChange, cafes, category }: {
  areas: Area[]; onChange: (a: Area[]) => void; cafes: Cafe[]; category: string;
}) {
  const cities = React.useMemo(() => citiesOf(cafes), [cafes]);
  const eligible = React.useMemo(() => eligibleCafes(cafes, areas, category), [cafes, areas, category]);
  const ids = React.useMemo(() => new Set(eligible.map((c) => c.id)), [eligible]);
  const add = (a: Area) => { if (!areas.some((x) => x.id === a.id)) onChange([...areas, a]); };
  const picked = new Set(areas.map((a) => a.id));
  const demo = cafes.some((c) => c.is_demo);

  return (
    <>
      <PlaceSearch placeholder="Search a city or neighborhood" onPick={(p) => add({ id: p.id, label: p.label.split(",").slice(0, 2).join(","), bbox: p.bbox })} />
      <div className="mp-chips">
        {areas.map((a) => (
          <button key={a.id} type="button" className="mp-chip on" onClick={() => onChange(areas.filter((x) => x.id !== a.id))}>
            {a.label} <span className="x">×</span>
          </button>
        ))}
        {cities.filter((c) => !picked.has(`city:${c.city}`)).slice(0, areas.length ? 4 : 9).map((c) => (
          <button key={c.city} type="button" className="mp-chip" onClick={() => add({ id: `city:${c.city}`, label: c.city, bbox: c.box })}>
            {c.city}
          </button>
        ))}
      </div>
      <CafeMap cafes={cafes} areas={areas} focus={unionBox(areas.map((a) => a.bbox))} legend={false}
        isEligible={(c) => ids.has(c.id)} selected={ids}
        tag={demo ? <span className="mp-demo">Sample cafés</span> : undefined} />
      {areas.length > 0 && (
        <p className="mp-note">{eligible.length
          ? `${num(eligible.length)} ${eligible.length === 1 ? "café here is" : "cafés here are"} open to ${categoryLabel(category).toLowerCase()}.`
          : `No cafés here take ${categoryLabel(category).toLowerCase()} brands yet — try a nearby city, or add another area.`}</p>
      )}
    </>
  );
}
