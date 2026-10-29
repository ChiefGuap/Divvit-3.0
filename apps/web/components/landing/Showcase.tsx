"use client";

/* The landing page: a 3D coffee cup cycling through startups' sleeve campaigns.
   The markup lives here; lib/landing/showcase.ts drives it. */

import React from "react";
import "./showcase.css";

const LEAD = ["Be", "the", "startup", "that", "people", "talk", "about"];

export function Showcase() {
  const root = React.useRef<HTMLElement>(null);

  React.useEffect(() => {
    let dispose: (() => void) | undefined;
    let cancelled = false;
    import("@/lib/landing/showcase").then(({ mountShowcase }) => {
      if (!cancelled && root.current) dispose = mountShowcase(root.current);
    });
    return () => { cancelled = true; dispose?.(); };
  }, []);

  return (
    <main className="lp" ref={root}>
      {/* the page's headline: words rise in as it loads, then "over coffee" gets underlined */}
      <h1 className="lp-headline" data-lp="banner">
        {LEAD.map((w, i) => (
          <React.Fragment key={w}><span className="w"><span style={{ "--d": i } as React.CSSProperties}>{w}</span></span> </React.Fragment>
        ))}
        <span className="w"><em style={{ "--d": LEAD.length } as React.CSSProperties}>
          over coffee
          <svg viewBox="0 0 200 12" preserveAspectRatio="none" aria-hidden="true"><path d="M2 8.5 C 40 3, 90 2.5, 130 5 S 185 9, 198 4" /></svg>
        </em></span>
      </h1>
      <div className="lp-stage" data-lp="stage">
        <canvas data-lp="gl" />
        <svg className="lp-lines" data-lp="lines" />
        <div className="lp-cards" data-lp="cards" />
      </div>

      <header className="lp-title" data-lp="hud-title">
        <div className="eyebrow" data-lp="eyebrow" />
        <h2 data-lp="title" />
        <p className="tagline" data-lp="tagline" />
      </header>

      <footer className="lp-bot" data-lp="hud-bot">
        <div className="lp-nav">
          <button data-lp="prev" aria-label="Previous startup">‹</button>
          <div className="lp-dots" data-lp="dots" />
          <button data-lp="next" aria-label="Next startup">›</button>
        </div>
        <div className="lp-hint" data-lp="hint"><span className="sw">⟵ ⟶</span> Spins on its own · drag to take over</div>
      </footer>
    </main>
  );
}
