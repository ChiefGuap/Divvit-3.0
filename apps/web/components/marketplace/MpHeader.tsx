"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import React from "react";
import { site } from "@/lib/urls";
import { useMp } from "./session";

/* Marketplace header — same glass bar and wordmark as divvit.app, with the
   marketplace's own nav. Paths are marketplace-relative (middleware maps them). */
export function MpHeader() {
  const { user, profile, loading, signOut } = useMp();
  const pathname = usePathname() || "/";
  const here = (p: string) => pathname === `/marketplace${p}` || pathname === p || pathname.startsWith(`/marketplace${p}/`) || pathname.startsWith(`${p}/`);
  const [menu, setMenu] = React.useState(false);

  return (
    <header className="mp-header">
      <div className="mp-header-inner">
        <div className="mp-brand">
          <a href={site("/")} aria-label="Divvit home"><img src="/assets/divvit-wordmark-purple.png" alt="Divvit" /></a>
          <Link href="/" className="mp-badge">Marketplace</Link>
        </div>
        <nav className="mp-nav">
          <Link href="/startups" className={here("/startups") ? "on" : ""}>For startups</Link>
          <Link href="/cafes" className={here("/cafes") && !here("/cafes/inbox") ? "on" : ""}>For cafés</Link>
          {profile?.role === "startup" && <Link href="/startups/campaigns" className={here("/startups/campaigns") ? "on" : ""}>My campaigns</Link>}
          {profile?.role === "cafe" && <Link href="/cafes/inbox" className={here("/cafes/inbox") ? "on" : ""}>Inbox</Link>}
        </nav>
        <div className="mp-right">
          {loading ? null : user ? (
            <div className="mp-account" onMouseLeave={() => setMenu(false)}>
              <button className="mp-avatar" onClick={() => setMenu((m) => !m)} aria-label="Account">
                {(profile?.full_name || user.email || "?").slice(0, 1).toUpperCase()}
              </button>
              {menu && (
                <div className="mp-menu">
                  <div className="mp-menu-who"><b>{profile?.full_name || "Signed in"}</b><span>{user.email}</span></div>
                  {profile?.role === "cafe" ? <Link href="/cafes/inbox">Café inbox</Link> : <Link href="/startups/campaigns">My campaigns</Link>}
                  <button onClick={() => { setMenu(false); signOut(); }}>Sign out</button>
                </div>
              )}
            </div>
          ) : (
            <>
              <Link href="/signin" className="mp-signin">Sign in</Link>
              <Link href="/startups" className="divvit-plainsm"><span>Start a campaign</span></Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
