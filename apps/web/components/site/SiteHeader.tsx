"use client";

/* Divvit marketing header — ported from Divvit Home.dc.html (#divvit-header).
   At the top of the page it's a full-width glass bar; once the page scrolls it
   lifts into a floating island (same values and 0.42s transition as the prototype). */

import Link from "next/link";
import { usePathname } from "next/navigation";
import React from "react";
import { marketplace } from "@/lib/urls";
import "./site-header.css";

const CHEV = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
);
const ARROW = (
  <svg className="divvit-restile-arrow" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></svg>
);

type Item = { t: string; s: string; href: string; icon: React.ReactNode };
const ICON = (children: React.ReactNode) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--brand-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{children}</svg>
);
const CONTENT: Item[] = [
  { t: "Dashboard", s: "Your control center", href: "#", icon: ICON(<><rect width="7" height="9" x="3" y="3" rx="1" /><rect width="7" height="5" x="14" y="3" rx="1" /><rect width="7" height="9" x="14" y="12" rx="1" /><rect width="7" height="5" x="3" y="16" rx="1" /></>) },
  { t: "The Collection", s: "Browse creator videos", href: "#", icon: ICON(<><path d="M2 3h20l-2 5H4Z" /><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8" /><path d="M9 12h6" /></>) },
  { t: "Content Manager", s: "Sort your library", href: "#", icon: ICON(<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />) },
  { t: "Discover", s: "Organic brand health & reviews", href: "#", icon: ICON(<><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></>) },
];
const ENGAGE: Item[] = [
  { t: "Editor", s: "Raw clips into postable video", href: "#", icon: ICON(<><path d="M15 4V2" /><path d="M15 16v-2" /><path d="M8 9h2" /><path d="M20 9h2" /><path d="M17.8 11.8 19 13" /><path d="M17.8 6.2 19 5" /><path d="m3 21 9-9" /><path d="M12.2 6.2 11 5" /></>) },
  { t: "Campaigns", s: "Launch promotions", href: marketplace("/startups"), icon: ICON(<><path d="m3 11 18-5v12L3 14v-3Z" /><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" /></>) },
  { t: "Rewards", s: "Incentivize creators", href: "#", icon: ICON(<path d="M12 2 15 9l7 .5-5.5 4.5L18.5 21 12 17l-6.5 4 2-7L2 9.5 9 9Z" />) },
];

export function SiteHeader() {
  const pathname = usePathname();
  const [menu, setMenu] = React.useState<"features" | "resources" | null>(null);
  const [island, setIsland] = React.useState(false);
  const closeT = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  React.useEffect(() => {
    const onScroll = () => setIsland(window.scrollY > 0.5);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // same as the prototype: open on enter, close 220ms after leaving
  const open = (m: "features" | "resources") => () => { clearTimeout(closeT.current); setMenu(m); };
  const close = () => { clearTimeout(closeT.current); closeT.current = setTimeout(() => setMenu(null), 220); };

  const item = (it: Item) => (
    <a key={it.t} className="dh-item" href={it.href} onClick={it.href === "#" ? (e) => e.preventDefault() : undefined}>
      {it.icon}
      <span><span className="dh-item-t">{it.t}</span><span className="dh-item-s">{it.s}</span></span>
    </a>
  );

  return (
    <header id="divvit-header" className={island ? "island" : undefined}>
      <div className="dh-inner">
        <div className="dh-side">
          <Link className="dh-logo" href="/"><img src="/assets/divvit-wordmark-purple.png" alt="Divvit" /></Link>
        </div>

        <nav className="dh-nav">
          <div className="dh-menu" onMouseEnter={open("features")} onMouseLeave={close}>
            <button className="dh-link">Features {CHEV}</button>
            {menu === "features" && (
              <div className="dh-drop">
                <div className="dh-panel-features">
                  <div><div className="dh-colhead">Content</div>{CONTENT.map(item)}</div>
                  <div><div className="dh-colhead">Create &amp; engage</div>{ENGAGE.map(item)}</div>
                  <div className="dh-feature">
                    <div className="dh-feature-scrim" />
                    <div className="dh-feature-cap"><b>See Divvit in action</b><span>One dashboard for every guest video</span></div>
                  </div>
                </div>
              </div>
            )}
          </div>

          <Link className={`dh-link${pathname === "/how-it-works" ? " active" : ""}`} href="/how-it-works">How it works</Link>
          <Link className="dh-link" href="/how-it-works#pricing">Pricing</Link>

          <div className="dh-menu" onMouseEnter={open("resources")} onMouseLeave={close}>
            <button className="dh-link">Resources {CHEV}</button>
            {menu === "resources" && (
              <div className="dh-drop">
                <div className="dh-panel-res">
                  <a href="#" className="divvit-restile dh-team" onClick={(e) => e.preventDefault()}>
                    <span className="dh-team-t">Meet<br />the team</span>
                    <span className="dh-team-cta">Learn more{ARROW}</span>
                  </a>
                  <div className="dh-news">
                    <div className="dh-news-h">What&apos;s new</div>
                    <div className="dh-news-list">
                      <a href={marketplace("/")}>The Divvit marketplace is open</a>
                      <a href={marketplace("/startups")}>Design your sleeve in 3D</a>
                      <a href={marketplace("/cafes")}>Cafés: see what you could earn</a>
                    </div>
                    <a href="#" className="divvit-restile dh-contact" onClick={(e) => e.preventDefault()}>Contact us{ARROW}</a>
                  </div>
                </div>
              </div>
            )}
          </div>

          <a className="dh-link" href={marketplace("/cafes")}>For Cafés</a>
        </nav>

        <div className="dh-side dh-right">
          <a href={marketplace("/signin")} className="divvit-login">Sign in</a>
          <a href={marketplace("/")} className="divvit-plainsm"><span>Join Marketplace</span></a>
        </div>
      </div>
    </header>
  );
}
