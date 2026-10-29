"use client";

/* The homepage story under the cup: what Divvit is for startups, then (mirrored)
   for cafés with an earnings calculator. Each side has a 3D building that turns
   a few degrees as its section scrolls by (lib/landing/buildings.ts). */

import React from "react";
import { Reveal } from "@/components/site/Reveal";
import { marketplace, site } from "@/lib/urls";
import type { BuildingKind } from "@/lib/landing/buildings";
import { EarningsCalculator } from "./EarningsCalculator";
import "./home.css";

function Building({ kind, label }: { kind: BuildingKind; label: string }) {
  const ref = React.useRef<HTMLCanvasElement>(null);

  React.useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let stage: { setProgress(p: number): void; dispose(): void } | undefined;
    let cancelled = false, raf = 0, visible = false;

    const progress = () => {
      raf = 0;
      if (!stage) return;
      const r = canvas.getBoundingClientRect(), vh = window.innerHeight;
      stage.setProgress((vh - r.top) / (vh + r.height));
    };
    const onScroll = () => { if (visible && !raf) raf = requestAnimationFrame(progress); };

    // build the scene only when it's about to be seen
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      if (visible && !stage) {
        import("@/lib/landing/buildings").then(({ mountBuilding }) => {
          if (cancelled) return;
          stage = mountBuilding(canvas, kind);
          progress();
          canvas.classList.add("on");
        });
      }
      onScroll();
    }, { rootMargin: "300px 0px" });
    io.observe(canvas);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelled = true;
      io.disconnect();
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
      stage?.dispose();
    };
  }, [kind]);

  return <canvas ref={ref} className="hm-canvas" role="img" aria-label={label} />;
}

/** Numbered steps; a step's `note` is the small print under it. */
const Steps = ({ items }: { items: { t: string; note?: string }[] }) => (
  <ol className="hm-steps">
    {items.map((s, i) => (
      <li key={s.t}>
        <span className="n">{i + 1}</span>
        <span><b>{s.t}</b>{s.note && <small>{s.note}</small>}</span>
      </li>
    ))}
  </ol>
);

const Stat = ({ n, label }: { n: React.ReactNode; label: string }) => (
  <div className="hm-stat"><b>{n}</b><span>{label}</span></div>
);

export function HomeSections() {
  return (
    <div className="hm">
      <div className="hm-sheet">
        {/* ---------------- startups */}
        <section className="hm-block" aria-labelledby="hm-startups">
          <div className="hm-wrap">
            <Reveal>
              <h2 id="hm-startups" className="hm-head">
                Put your startup <em>in the hands</em> of people who <em>live, work,</em> and <em>sip</em> nearby.
              </h2>
            </Reveal>
          </div>
          <div className="hm-wrap hm-split">
            <Reveal className="hm-copy" delay={0.1}>
              <span className="hm-label">For startups</span>
              <Steps items={[
                { t: "Pick locations" },
                { t: "Pick sleeve count" },
                { t: "Get matched with cafés", note: "We design, print and pack every sleeve — fully automated." },
                { t: "Track results", note: "We send you a metrics report." },
              ]} />
              <a className="hm-pill" href={marketplace("/start/startup")}>Start a campaign</a>
            </Reveal>
            <div className="hm-art bleed-right">
              <Building kind="startup" label="A startup's headquarters, drawn in 3D" />
            </div>
          </div>
          <div className="hm-wrap">
            <Reveal className="hm-stats" delay={0.05}>
              <Stat n="1 min" label="to set up a campaign" />
              <Stat n="2–8" label="weeks a campaign runs" />
              <Stat n="$0" label="for cafés that pass on you" />
            </Reveal>
          </div>
        </section>

        <div className="hm-wrap"><hr className="hm-rule" /></div>

        {/* ---------------- cafés (mirrored) */}
        <section className="hm-block flip" aria-labelledby="hm-cafes">
          <div className="hm-wrap hm-split">
            <div className="hm-art bleed-left">
              <Building kind="cafe" label="A corner café with striped awning, drawn in 3D" />
            </div>
            <Reveal className="hm-copy" delay={0.1}>
              <span className="hm-label">For cafés</span>
              <h2 id="hm-cafes" className="hm-head sm">
                Your cups are <em>already</em> in everyone&apos;s hands. Let them <em>pay you back.</em>
              </h2>
              <Steps items={[
                { t: "Join in 2 minutes" },
                { t: "Choose brands and sleeves" },
                { t: "Approve, serve, get paid", note: "Sleeves arrive printed and packed." },
              ]} />
              <a className="hm-pill" href={marketplace("/start/cafe")}>Join the marketplace</a>
            </Reveal>
          </div>
          <div className="hm-wrap">
            <Reveal delay={0.05}>
              <EarningsCalculator />
            </Reveal>
          </div>
        </section>

        <footer className="hm-foot">
          <div className="hm-wrap">
            <span>© {new Date().getFullYear()} Divvit</span>
            <nav>
              <a href={site("/how-it-works")}>How it works</a>
              <a href={marketplace("/")}>Marketplace</a>
              <a href={marketplace("/signin")}>Sign in</a>
              <a href={site("/privacy")}>Privacy</a>
              <a href={site("/terms")}>Terms</a>
            </nav>
          </div>
        </footer>
      </div>
    </div>
  );
}
