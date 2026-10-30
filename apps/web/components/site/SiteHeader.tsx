"use client";

/* Divvit marketing header — the glass bar from Divvit Home.dc.html (#divvit-header),
   kept to the wordmark plus Sign in / Join Marketplace at every width.
   At the top of the page it's a full-width bar; once the page scrolls it lifts
   into a floating island (same values and 0.42s transition as the prototype). */

import Link from "next/link";
import React from "react";
import { marketplace } from "@/lib/urls";
import "./site-header.css";

export function SiteHeader() {
  const [island, setIsland] = React.useState(false);

  React.useEffect(() => {
    // a little hysteresis: iOS's bounce at the top of the page would otherwise flip it back and forth
    const onScroll = () => setIsland((was) => window.scrollY > (was ? 4 : 12));
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header id="divvit-header" className={island ? "island" : undefined}>
      <div className="dh-inner">
        <div className="dh-side">
          <Link className="dh-logo" href="/"><img src="/assets/divvit-wordmark-purple.png" alt="Divvit" /></Link>
        </div>
        <div className="dh-side dh-right">
          <a href={marketplace("/signin")} className="divvit-login">Sign in</a>
          <a href={marketplace("/")} className="divvit-plainsm"><span>Join Marketplace</span></a>
        </div>
      </div>
    </header>
  );
}
