"use client";

/* The app shell: frosted sidebar + header, shared across every route.
   Holds the state the whole app needs (sidebar collapse, toast, live feed) so
   navigating between screens doesn't reset it. */

import React from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { Icon, type IconName } from "@/lib/icons";
import { RESTAURANT, feedPool, searchPhrases, searchCorpus } from "@/lib/data";
import { EASE } from "@/lib/ui";

/* Nav order and parent/child relationships from the handoff's Layout shell. */
const NAV_CONTENT = [
  { label: "Dashboard", href: "/", icon: "grid" as IconName },
  { label: "The Collection", href: "/collection", icon: "clapper" as IconName },
  { label: "Content Manager", href: "/content", icon: "folder" as IconName },
  { label: "Discover", href: "/discover", icon: "radar" as IconName },
];
const NAV_ENGAGE = [
  { label: "Editor", href: "/editor", icon: "wand" as IconName },
  { label: "Rewards", href: "/rewards", icon: "gift" as IconName },
  { label: "Creators", href: "/rewards/creators", icon: "users" as IconName },
];

const PAGE_META: Record<string, { label: string; icon: IconName; parent?: string; parentIcon?: IconName }> = {
  "/": { label: "Dashboard", icon: "grid" },
  "/collection": { label: "The Collection", icon: "clapper" },
  "/collection/campaigns": { label: "Campaigns", icon: "megaphone", parent: "The Collection", parentIcon: "clapper" },
  "/collection/submit": { label: "Screen a video", icon: "upload", parent: "The Collection", parentIcon: "clapper" },
  "/collection/claim": { label: "Claim a reward", icon: "shield", parent: "The Collection", parentIcon: "clapper" },
  "/content": { label: "Content Manager", icon: "folder" },
  "/discover": { label: "Discover", icon: "radar" },
  "/discover/brand-health": { label: "Organic brand health", icon: "pulse", parent: "Discover", parentIcon: "radar" },
  "/editor": { label: "Editor", icon: "wand" },
  "/rewards": { label: "Rewards", icon: "gift" },
  "/rewards/creators": { label: "Creators", icon: "users", parent: "Rewards", parentIcon: "gift" },
};

export type FeedEvent = (typeof feedPool)[number] & { key: number; at: number; fresh?: boolean };

type ShellState = {
  toast: (verb: string, name: string) => void;
  feed: FeedEvent[];
  liveVideos: number;
  now: number;
};
const ShellContext = React.createContext<ShellState | null>(null);
export const useShell = () => {
  const ctx = React.useContext(ShellContext);
  if (!ctx) throw new Error("useShell must be used inside Shell");
  return ctx;
};

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || "/";
  const router = useRouter();

  const [collapsed, setCollapsed] = React.useState(false);
  const [hovering, setHovering] = React.useState(false);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [helpOpen, setHelpOpen] = React.useState(false);
  const [toast, setToast] = React.useState<{ verb: string; name: string; key: number } | null>(null);
  const [feed, setFeed] = React.useState<FeedEvent[]>([]);
  const [liveVideos, setLiveVideos] = React.useState(7);
  const [now, setNow] = React.useState(() => Date.now());

  const [query, setQuery] = React.useState("");
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [results, setResults] = React.useState<typeof searchCorpus>([]);
  const inputRef = React.useRef<HTMLInputElement>(null);

  /* persist collapsed state per user (handoff: "Same, persist collapsed state") */
  React.useEffect(() => {
    const saved = window.localStorage.getItem("dv.sidebar.collapsed");
    if (saved) setCollapsed(saved === "1");
  }, []);
  React.useEffect(() => {
    window.localStorage.setItem("dv.sidebar.collapsed", collapsed ? "1" : "0");
  }, [collapsed]);

  const shut = collapsed && !hovering;

  /* Live Feed — seeded, then self-ticks. Real app: WS/SSE on new submissions. */
  React.useEffect(() => {
    const t0 = Date.now();
    setFeed(feedPool.slice(0, 4).map((e, i) => ({ ...e, key: -i, at: t0 - (i * 4 + 2) * 60000 })));
    let idx = 4;
    const feedTimer = setInterval(() => {
      if (document.hidden) return;
      const e = feedPool[idx % feedPool.length];
      idx += 1;
      setFeed((prev) => [{ ...e, key: idx, at: Date.now(), fresh: true },
        ...prev.map((f) => ({ ...f, fresh: false }))].slice(0, 5));
      if (e.clip) setLiveVideos((n) => n + 1);
    }, 5200);
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearInterval(feedTimer); clearInterval(clock); };
  }, []);

  /* Header placeholder types and deletes through five phrases. Pure UI —
     skips when the tab is hidden or the field is focused/dirty. */
  React.useEffect(() => {
    let i = 0, len = 0, deleting = false, wait = 0, last = "";
    const t = setInterval(() => {
      const el = inputRef.current;
      if (!el || document.hidden || document.activeElement === el || el.value) return;
      if (wait > 0) { wait -= 1; return; }
      const full = searchPhrases[i % searchPhrases.length];
      if (!deleting) {
        if (len < full.length) len += 1;
        else { deleting = true; wait = 14; }
      } else if (len > 0) len -= 1;
      else { deleting = false; i += 1; wait = 3; }
      const next = full.slice(0, len) + "▏";
      if (next !== last) { last = next; el.placeholder = next; }
    }, 90);
    return () => clearInterval(t);
  }, []);

  const showToast = React.useCallback((verb: string, name: string) => {
    setToast({ verb, name, key: Date.now() });
    window.setTimeout(() => setToast(null), 4600);
  }, []);

  const runSearch = React.useCallback(() => {
    const q = query.trim().toLowerCase();
    if (!q) return;
    const scored = searchCorpus
      .map((r) => {
        const hay = `${r.title} ${r.meta} ${r.tags}`.toLowerCase();
        const score = q.split(/\s+/).reduce((n, w) => n + (hay.includes(w) ? 1 : 0), 0);
        return { r, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 6)
      .map((x) => x.r);
    setResults(scored);
    setSearchOpen(true);
  }, [query]);

  const meta = PAGE_META[pathname] ?? PAGE_META["/"];
  const sidebarWidth = shut ? 68 : 250;

  const navLink = (item: { label: string; href: string; icon: IconName }) => {
    const active = pathname === item.href ||
      (item.href !== "/" && pathname.startsWith(item.href) &&
        !Object.keys(PAGE_META).some((p) => p === pathname && PAGE_META[p].parent && p !== item.href));
    return (
      <Link
        key={item.href}
        href={item.href}
        title={item.label}
        className="navItem"
        style={{
          display: "flex", alignItems: "center", gap: 11, padding: "9px 10px",
          borderRadius: 9, textDecoration: "none", whiteSpace: "nowrap",
          color: active ? "#8c52ff" : "#4b5563",
          background: active ? "rgba(140,82,255,0.10)" : "transparent",
          fontWeight: active ? 600 : 500, fontSize: 14,
        }}
      >
        <Icon name={item.icon} size={18} />
        {!shut && <span>{item.label}</span>}
      </Link>
    );
  };

  return (
    <ShellContext.Provider value={{ toast: showToast, feed, liveVideos, now }}>
      <div style={{
        position: "relative", display: "flex", width: "100%", height: "100vh",
        minHeight: 780, overflow: "hidden", color: "#111827",
        fontFamily: "'Inter', system-ui, sans-serif", fontSize: 14,
        background: `radial-gradient(900px 520px at 12% -8%, #efe8ff 0%, rgba(239,232,255,0) 62%),
                     radial-gradient(760px 520px at 96% 4%, #e7f3ff 0%, rgba(231,243,255,0) 58%),
                     radial-gradient(680px 460px at 78% 98%, #ffeef6 0%, rgba(255,238,246,0) 60%),
                     #f5f4fa`,
      }}>
        {/* ---------------- SIDEBAR ---------------- */}
        <aside
          onMouseEnter={() => collapsed && setHovering(true)}
          onMouseLeave={() => { setHovering(false); setMenuOpen(false); setHelpOpen(false); }}
          style={{
            position: "relative", width: collapsed ? 68 : 250,
            flex: `0 0 ${collapsed ? 68 : 250}px`, zIndex: 40,
            transition: `width 0.28s ${EASE}, flex-basis 0.28s ${EASE}`,
          }}
        >
          <div style={{
            position: "absolute", top: 0, left: 0, bottom: 0, width: sidebarWidth,
            display: "flex", flexDirection: "column",
            background: "rgba(255,255,255,0.72)",
            backdropFilter: "blur(22px) saturate(150%)",
            WebkitBackdropFilter: "blur(22px) saturate(150%)",
            boxShadow: `inset -1px 0 0 rgba(255,255,255,0.55), 1px 0 0 rgba(17,24,39,0.05), ${
              collapsed && hovering ? "0 18px 50px rgba(58,32,137,0.20)" : "none"}`,
            transition: `width 0.28s ${EASE}, box-shadow 0.28s ease`,
            overflow: "hidden",
          }}>
            <div style={{
              display: "flex", alignItems: "center", gap: 8, minHeight: 30,
              padding: shut ? "22px 8px 14px" : "20px 18px 14px",
              transition: `padding 0.28s ${EASE}`,
            }}>
              <Link href="/" style={{ display: "block", flex: "0 0 auto" }}>
                <Image
                  src="/assets/divvit-wordmark-purple.png"
                  alt="Divvit" width={110} height={30} priority
                  style={{ height: shut ? 15 : 30, width: "auto", display: "block", transition: `height 0.28s ${EASE}` }}
                />
              </Link>
              <span style={{ flex: 1 }} />
              {!shut && (
                <button
                  onClick={() => { setCollapsed((c) => !c); setHovering(false); setMenuOpen(false); }}
                  title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "center",
                    width: 26, height: 26, borderRadius: 8, flex: "0 0 auto",
                    color: collapsed ? "#9ca3af" : "#8c52ff",
                    background: collapsed ? "transparent" : "rgba(140,82,255,0.10)",
                    transition: "background 0.2s ease, color 0.2s ease",
                  }}
                >
                  <Icon name="panel" size={15} />
                </button>
              )}
            </div>

            {/* nav is top-aligned to the first content card (116px from top) */}
            <nav style={{ flex: 1, overflowY: "auto", padding: "6px 12px", display: "flex", flexDirection: "column", gap: 3 }}>
              <div style={{ height: 44 }} />
              {NAV_CONTENT.map(navLink)}
              {NAV_ENGAGE.map(navLink)}
            </nav>

            <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ position: "relative" }}>
                {helpOpen && (
                  <div style={{
                    position: "absolute", bottom: "calc(100% + 8px)", left: 0, minWidth: 190,
                    background: "#fff", borderRadius: 14, padding: 6, zIndex: 11,
                    boxShadow: "0 0 0 1px rgba(17,24,39,0.07), 0 12px 32px rgba(58,32,137,0.12)",
                    display: "flex", flexDirection: "column", gap: 2,
                  }}>
                    <button className="menuItem" onClick={() => setHelpOpen(false)}
                      style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 10px", borderRadius: 8, color: "#4b5563", fontWeight: 500, whiteSpace: "nowrap" }}>
                      <Icon name="book" size={17} />FAQ &amp; guides
                    </button>
                    <button className="menuItem" onClick={() => setHelpOpen(false)}
                      style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 10px", borderRadius: 8, color: "#4b5563", fontWeight: 500, whiteSpace: "nowrap" }}>
                      <Icon name="chat" size={17} />Live chat support
                      <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#4ade80", marginLeft: "auto" }} />
                    </button>
                  </div>
                )}
                <button className="menuItem" onClick={() => { setHelpOpen((o) => !o); setMenuOpen(false); }} title="Help"
                  style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 9, color: "#6b7280", fontWeight: 500, width: "100%", whiteSpace: "nowrap" }}>
                  <Icon name="help" size={17} />{!shut && <span>Help &amp; support</span>}
                </button>
              </div>

              <div style={{ position: "relative" }}>
                {menuOpen && (
                  <div style={{
                    position: "absolute", bottom: "calc(100% + 8px)", left: 0, minWidth: 170,
                    background: "#fff", borderRadius: 14, padding: 6, zIndex: 10,
                    boxShadow: "0 0 0 1px rgba(17,24,39,0.07), 0 12px 32px rgba(58,32,137,0.12)",
                    display: "flex", flexDirection: "column", gap: 2,
                  }}>
                    <button className="menuItem" onClick={() => setMenuOpen(false)}
                      style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 10px", borderRadius: 8, color: "#4b5563", fontWeight: 500 }}>
                      <Icon name="settings" size={17} />Settings
                    </button>
                    <button className="menuItem" onClick={() => setMenuOpen(false)}
                      style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 10px", borderRadius: 8, color: "#4b5563", fontWeight: 500 }}>
                      <Icon name="card" size={17} />Billing
                    </button>
                  </div>
                )}
                <button onClick={() => setMenuOpen((o) => !o)} title={RESTAURANT.name}
                  style={{
                    display: "flex", alignItems: "center", gap: 11, width: "100%",
                    padding: shut ? 6 : 12, borderRadius: 12, background: "#f5f5f9",
                    boxShadow: "0 0 0 1px rgba(17,24,39,0.07), 0 2px 6px rgba(58,32,137,0.05)",
                    overflow: "hidden", whiteSpace: "nowrap", textAlign: "left",
                  }}>
                  <span style={{
                    width: 34, height: 34, borderRadius: 9, background: "rgba(140,82,255,0.12)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    color: "#8c52ff", flex: "0 0 auto",
                  }}>
                    <Icon name="store" size={17} />
                  </span>
                  {!shut && (
                    <>
                      <span style={{ display: "flex", flexDirection: "column", flex: 1 }}>
                        <span style={{ fontWeight: 600, fontSize: 13.5 }}>{RESTAURANT.name}</span>
                        <span style={{ fontSize: 12, color: "#9ca3af" }}>{RESTAURANT.plan}</span>
                      </span>
                      <Icon name="chevron" size={15} color="#9ca3af" />
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </aside>

        {/* ---------------- MAIN ---------------- */}
        <main style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, position: "relative" }}>
          {toast && (
            <div key={toast.key} style={{
              position: "absolute", top: 14, left: "50%", zIndex: 50,
              display: "flex", alignItems: "center", gap: 14,
              padding: "10px 12px 10px 16px", background: "#111827", color: "#fff",
              borderRadius: 12, boxShadow: "0 8px 22px rgba(17,24,39,0.14)",
              animation: "dvToast 5s ease forwards", whiteSpace: "nowrap",
            }}>
              <Icon name={toast.verb === "Passed on" ? "x" : "check"} size={17}
                color={toast.verb === "Passed on" ? "#9ca3af" : "#4ade80"} />
              <span style={{ fontSize: 13.5, fontWeight: 500 }}>{toast.verb} {toast.name}</span>
              <button className="btnPurple" onClick={() => { setToast(null); router.push("/content"); }}
                style={{ padding: "6px 13px", fontSize: 12.5 }}>View</button>
              <button onClick={() => setToast(null)} style={{ display: "flex", color: "#9ca3af" }}>
                <Icon name="x" size={16} />
              </button>
            </div>
          )}

          <header style={{
            display: "flex", flexDirection: "column",
            background: "rgba(255,255,255,0.62)",
            backdropFilter: "blur(20px) saturate(150%)",
            WebkitBackdropFilter: "blur(20px) saturate(150%)",
            boxShadow: "inset 0 -1px 0 rgba(17,24,39,0.06)",
            position: "relative", zIndex: 30,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "12px 24px 10px" }}>
              <div style={{ flex: 1, minWidth: 0, position: "relative" }}>
                <div className="searchBar" style={{
                  display: "flex", alignItems: "center", gap: 10, padding: "8px 12px",
                  borderRadius: 13, background: "rgba(255,255,255,0.8)",
                  boxShadow: "inset 0 0 0 1px rgba(17,24,39,0.08)", backdropFilter: "blur(12px)",
                }}>
                  <Icon name="search" size={16} color="#8c52ff" />
                  <input
                    ref={inputRef}
                    value={query}
                    onChange={(e) => { setQuery(e.target.value); if (!e.target.value) setSearchOpen(false); }}
                    onKeyDown={(e) => { if (e.key === "Enter") runSearch(); if (e.key === "Escape") setSearchOpen(false); }}
                    placeholder="Search for incoming clips"
                    aria-label="Search"
                    style={{
                      flex: 1, minWidth: 0, border: "none", outline: "none",
                      background: "transparent", fontFamily: "inherit", fontSize: 13.5, color: "#111827",
                    }}
                  />
                  <button onClick={runSearch} className="btnPurple" style={{
                    display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700,
                    borderRadius: 8, padding: "6px 11px", flex: "0 0 auto",
                    boxShadow: "0 3px 10px rgba(122,62,240,0.26)",
                  }}>
                    <Icon name="sparkle" size={12} />Ask
                  </button>
                </div>

                {searchOpen && (
                  <div style={{
                    position: "absolute", top: "calc(100% + 8px)", left: 0, right: 0, zIndex: 60,
                    borderRadius: 16, background: "rgba(255,255,255,0.86)",
                    backdropFilter: "blur(24px) saturate(160%)",
                    WebkitBackdropFilter: "blur(24px) saturate(160%)",
                    boxShadow: "0 0 0 1px rgba(17,24,39,0.07), 0 24px 60px rgba(58,32,137,0.18)",
                    padding: 10, display: "flex", flexDirection: "column", gap: 2,
                    animation: `dvPop 0.25s ${EASE}`,
                  }}>
                    {results.length > 0 ? results.map((r) => (
                      <button key={r.id} onClick={() => setSearchOpen(false)} className="hoverRowPurple"
                        style={{ display: "flex", alignItems: "center", gap: 11, padding: "9px 10px", borderRadius: 11, textAlign: "left" }}>
                        <span style={{
                          display: "flex", alignItems: "center", justifyContent: "center",
                          width: 30, height: 30, borderRadius: 9, flex: "0 0 auto",
                          color: "#8c52ff", background: "rgba(140,82,255,0.1)",
                        }}>
                          <Icon name={r.kind === "video" ? "clapper" : r.kind === "creator" ? "users"
                            : r.kind === "campaign" ? "megaphone" : r.kind === "reward" ? "gift" : "pulse"} size={15} />
                        </span>
                        <span style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
                          <span style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.title}</span>
                          <span style={{ fontSize: 11.5, color: "#9ca3af", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.meta}</span>
                        </span>
                      </button>
                    )) : (
                      <div style={{ padding: "12px 10px", color: "#6b7280", fontSize: 13 }}>
                        Nothing matched “{query}”.
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div style={{
                width: 32, height: 32, borderRadius: "50%",
                background: "linear-gradient(135deg, #8c52ff, #f59512)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontWeight: 600, fontSize: 12.5, color: "#fff", flex: "0 0 auto",
              }}>{RESTAURANT.initials}</div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "0 24px 11px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 9, fontWeight: 600, fontSize: 14 }}>
                <Icon name={meta.parentIcon ?? meta.icon} size={17} color="#6b7280" />
                {meta.parent ?? meta.label}
                {meta.parent && (
                  <>
                    <span style={{ color: "#c9c4d8", fontWeight: 400 }}>/</span>
                    <span>{meta.label}</span>
                  </>
                )}
              </div>
            </div>
          </header>

          <div style={{
            flex: 1, overflowY: "auto", padding: 24,
            display: "flex", flexDirection: "column", gap: 16, position: "relative",
          }}>
            {children}
          </div>
        </main>
      </div>
    </ShellContext.Provider>
  );
}
