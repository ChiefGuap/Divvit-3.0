"use client";

/* Creators — who films for us and what they've earned.
   Filter is a segmented control on a grey inset track; the table sorts. */

import React from "react";
import { Icon, type IconName } from "@/lib/icons";
import { creators, redemptions, creatorActivityPool, type Creator } from "@/lib/data";
import { EASE, QuietButton, Segmented, fadeUp, relativeTime } from "@/lib/ui";

const TIER: Record<string, { label: string; icon: IconName; fg: string; bg: string }> = {
  leaderboard: { label: "Top", icon: "crown", fg: "#b9700a", bg: "rgba(245,149,18,0.14)" },
  regular: { label: "Regular", icon: "heart", fg: "#8c52ff", bg: "rgba(140,82,255,0.12)" },
  first: { label: "First-time", icon: "sparkle", fg: "#16a06b", bg: "rgba(22,160,107,0.12)" },
};

const STATUS: Record<string, { fg: string; bg: string }> = {
  Fulfilled: { fg: "#0d7a4f", bg: "rgba(22,160,107,0.12)" },
  Pending: { fg: "#2563eb", bg: "rgba(37,99,235,0.12)" },
  Expired: { fg: "#9ca3af", bg: "#f1f1f6" },
};

type SortKey = "videos" | "views" | "name";
const parseViews = (v: string) => parseFloat(v) * (v.includes("K") ? 1000 : 1);

const GRID = "22px 2.2fr 1.1fr 0.8fr 0.9fr 1.2fr 1fr";

export default function CreatorsPage() {
  const [filter, setFilter] = React.useState("all");
  const [sort, setSort] = React.useState<SortKey>("videos");
  const [desc, setDesc] = React.useState(true);
  const [feedIdx, setFeedIdx] = React.useState(0);
  const [now, setNow] = React.useState(() => Date.now());

  /* live creator activity panel */
  React.useEffect(() => {
    const t = setInterval(() => { if (!document.hidden) setFeedIdx((i) => i + 1); }, 5600);
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearInterval(t); clearInterval(clock); };
  }, []);

  const counts = {
    all: creators.length,
    leaderboard: creators.filter((c) => c.tier === "leaderboard").length,
    regular: creators.filter((c) => c.tier === "regular").length,
    first: creators.filter((c) => c.tier === "first").length,
  };

  const shown = React.useMemo(() => {
    const base = filter === "all" ? creators : creators.filter((c) => c.tier === filter);
    const dir = desc ? -1 : 1;
    return [...base].sort((a, b) => {
      if (sort === "name") return dir * a.name.localeCompare(b.name);
      if (sort === "views") return dir * (parseViews(a.views) - parseViews(b.views));
      return dir * (a.videos - b.videos);
    });
  }, [filter, sort, desc]);

  const toggleSort = (key: SortKey) => {
    if (sort === key) setDesc((d) => !d);
    else { setSort(key); setDesc(true); }
  };

  const feed = Array.from({ length: 5 }, (_, i) => {
    const item = creatorActivityPool[(feedIdx + i) % creatorActivityPool.length];
    return { ...item, key: `${feedIdx}-${i}`, at: now - i * 4 * 60000, fresh: i === 0 };
  });

  const stats = [
    { label: "Filmed this month", value: "18" },
    { label: "New this week", value: "7" },
    { label: "Repeat creators", value: "11" },
    { label: "Rewards claimed", value: "31" },
  ];

  return (
    <>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap", ...fadeUp("0.05s", "0.5s") }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, letterSpacing: "-0.01em" }}>Creators</h1>
          <p style={{ margin: 0, color: "#6b7280", fontSize: 13.5 }}>
            Everyone who has filmed for Divvit Cafe, and what they&apos;ve earned.
          </p>
        </div>
        <QuietButton><Icon name="users" size={16} />Invite creators</QuietButton>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: 16, ...fadeUp("0.08s", "0.5s") }}>
        <div style={{
          background: "linear-gradient(180deg,#f7f4fe,#f1ecfb)", border: "1px solid #e7dffb",
          borderRadius: 16, padding: "18px 22px", display: "flex", alignItems: "center",
          gap: 28, flexWrap: "wrap",
        }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, flex: "0 0 auto" }}>
            <span style={{ fontSize: 40, fontWeight: 800, letterSpacing: "-0.03em", lineHeight: 1 }}>{creators.length}</span>
            <span style={{ fontSize: 14, color: "#6b7280" }}>creators</span>
          </div>
          <div style={{ flex: 1, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
            {stats.map((t) => (
              <span key={t.label} style={{
                display: "inline-flex", alignItems: "center", gap: 7, fontSize: 13, fontWeight: 500,
                color: "#4b5563", border: "1px solid #e7dffb", background: "#fff", borderRadius: 8, padding: "5px 11px",
              }}>
                {t.label}<span style={{ color: "#9ca3af", fontWeight: 600 }}>{t.value}</span>
              </span>
            ))}
          </div>
        </div>

        <div style={{
          borderRadius: 16, padding: "16px 18px 10px", display: "flex", flexDirection: "column",
          gap: 8, overflow: "hidden", background: "rgba(255,255,255,0.7)",
          backdropFilter: "blur(20px) saturate(150%)", WebkitBackdropFilter: "blur(20px) saturate(150%)",
          boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.7), 0 10px 30px rgba(140,82,255,0.08)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#16a06b", animation: "dvBreathe 2.4s ease-in-out infinite" }} />
            <span style={{ fontWeight: 600, fontSize: 14 }}>Creator activity, live</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 1, overflow: "hidden" }}>
            {feed.map((f) => (
              <div key={f.key} className="hoverRowPurple" style={{
                display: "flex", alignItems: "center", gap: 11, padding: "7px 4px", borderRadius: 10,
                animation: f.fresh ? `dvSlideIn 0.45s ${EASE}` : undefined,
              }}>
                <span style={{
                  display: "flex", alignItems: "center", justifyContent: "center", width: 26, height: 26,
                  borderRadius: 8, color: f.fg, background: f.bg, flex: "0 0 auto",
                }}><Icon name={f.icon} size={13} /></span>
                <span style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0, flex: 1 }}>
                  <span style={{ fontSize: 12.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    <b style={{ fontWeight: 600 }}>{f.who}</b> {f.what}
                  </span>
                  <span style={{ fontSize: 11, color: "#9ca3af", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{f.meta}</span>
                </span>
                <span style={{ fontSize: 11, color: "#c9c4d8", flex: "0 0 auto" }}>{relativeTime(f.at, now)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* leaderboard */}
      <div style={{
        background: "#fff", borderRadius: 14, padding: 20, display: "flex", flexDirection: "column",
        gap: 4, marginBottom: 8,
        boxShadow: "0 0 0 1px rgba(17,24,39,0.07), 0 2px 6px rgba(58,32,137,0.05)",
        ...fadeUp("0.16s", "0.6s"),
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, paddingBottom: 12, flexWrap: "wrap" }}>
          <Segmented value={filter} onChange={setFilter} options={[
            { value: "all", label: "All creators", count: counts.all },
            { value: "leaderboard", label: "Top creators", count: counts.leaderboard },
            { value: "regular", label: "Regulars", count: counts.regular },
            { value: "first", label: "First-time", count: counts.first },
          ]} />
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 13, color: "#6b7280" }}><b style={{ color: "#111827" }}>{shown.length}</b> shown</span>
        </div>

        <div style={{
          display: "grid", gridTemplateColumns: GRID, gap: 12, padding: "6px 10px",
          fontSize: 11.5, fontWeight: 600, letterSpacing: "0.03em", color: "#9ca3af", textTransform: "uppercase",
        }}>
          <span>#</span>
          <SortHead label="Creator" active={sort === "name"} desc={desc} onClick={() => toggleSort("name")} />
          <span>Tier</span>
          <SortHead label="Videos" active={sort === "videos"} desc={desc} onClick={() => toggleSort("videos")} />
          <SortHead label="Views" active={sort === "views"} desc={desc} onClick={() => toggleSort("views")} />
          <span>Reward</span>
          <span style={{ justifySelf: "end" }}>Last visit</span>
        </div>

        {shown.map((c: Creator, i) => {
          const t = TIER[c.tier];
          return (
            <div key={c.name} className="hoverRowPurple" style={{
              display: "grid", gridTemplateColumns: GRID, gap: 12, alignItems: "center",
              padding: 10, borderTop: "1px solid #f1eff8", borderRadius: 8,
            }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#9ca3af" }}>{String(i + 1).padStart(2, "0")}</span>
              <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                <div style={{
                  width: 32, height: 32, borderRadius: "50%", background: c.avatarBg, flex: "0 0 auto",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 11.5, fontWeight: 600, color: "#fff",
                }}>{c.initials}</div>
                <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                  <span style={{ fontWeight: 500, fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.name}</span>
                  <span style={{ fontSize: 11.5, color: "#9ca3af", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.handle}</span>
                </div>
              </div>
              <span style={{
                justifySelf: "start", display: "inline-flex", alignItems: "center", gap: 6,
                fontSize: 11.5, fontWeight: 600, color: t.fg, background: t.bg, borderRadius: 99, padding: "4px 10px",
              }}>
                <Icon name={t.icon} size={12} />{t.label}
              </span>
              <span style={{ color: "#6b7280", fontSize: 13 }}>{c.videos}</span>
              <span style={{ color: "#6b7280", fontSize: 13 }}>{c.views}</span>
              <span style={{ fontWeight: 600, fontSize: 13, color: "#f59512", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.reward}</span>
              <span style={{ textAlign: "right", fontSize: 12.5, color: "#9ca3af" }}>{c.lastVisit}</span>
            </div>
          );
        })}

        {shown.length === 0 && (
          <div style={{ padding: "40px 20px", textAlign: "center", color: "#9ca3af", fontSize: 13.5 }}>
            No creators in this group yet.
          </div>
        )}
      </div>

      {/* redemptions */}
      <div style={{
        background: "#fff", borderRadius: 14, padding: 20, display: "flex", flexDirection: "column",
        gap: 4, marginBottom: 8,
        boxShadow: "0 0 0 1px rgba(17,24,39,0.07), 0 2px 6px rgba(58,32,137,0.05)",
        ...fadeUp("0.5s", "0.6s"),
      }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, paddingBottom: 8 }}>
          <span style={{ fontWeight: 600, fontSize: 14.5 }}>Recent redemptions</span>
          <span style={{ fontSize: 12, color: "#9ca3af", fontWeight: 500 }}>Past 14 days</span>
        </div>
        <div style={{
          display: "grid", gridTemplateColumns: "2fr 1.6fr 1fr 1fr", gap: 12, padding: "6px 10px",
          fontSize: 11.5, fontWeight: 600, letterSpacing: "0.03em", color: "#9ca3af", textTransform: "uppercase",
        }}>
          <span>Creator</span><span>Reward</span><span>Redeemed</span><span style={{ textAlign: "right" }}>Status</span>
        </div>
        {redemptions.map((d) => {
          const s = STATUS[d.status];
          return (
            <div key={d.name + d.reward} className="hoverRowPurple" style={{
              display: "grid", gridTemplateColumns: "2fr 1.6fr 1fr 1fr", gap: 12, alignItems: "center",
              padding: 10, borderTop: "1px solid #f1eff8", borderRadius: 8,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{
                  width: 30, height: 30, borderRadius: "50%", background: d.avatarBg, flex: "0 0 auto",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 11.5, fontWeight: 600, color: "#fff",
                }}>{d.initials}</div>
                <span style={{ fontWeight: 500, fontSize: 13 }}>{d.name}</span>
              </div>
              <span style={{ fontSize: 13, color: "#4b5563" }}>{d.reward}</span>
              <span style={{ fontSize: 13, color: "#9ca3af" }}>{d.when}</span>
              <span style={{
                justifySelf: "end", fontSize: 11.5, fontWeight: 600, color: s.fg, background: s.bg,
                borderRadius: 99, padding: "3px 11px",
              }}>{d.status}</span>
            </div>
          );
        })}
      </div>
    </>
  );
}

function SortHead({ label, active, desc, onClick }: {
  label: string; active: boolean; desc: boolean; onClick: () => void;
}) {
  return (
    <button onClick={onClick} title={`Sort by ${label}`} className="hoverInk" style={{
      display: "inline-flex", alignItems: "center", gap: 4, justifySelf: "start",
      color: active ? "#6b7280" : "#9ca3af", userSelect: "none",
      fontSize: 11.5, fontWeight: 600, letterSpacing: "0.03em", textTransform: "uppercase",
    }}>
      {label}
      <span style={{ fontSize: 9, lineHeight: 1, opacity: active ? 1 : 0.3 }}>{active && !desc ? "▲" : "▼"}</span>
    </button>
  );
}
