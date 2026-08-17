"use client";

/* The Collection — triage inbound clips (accept / pass).
   Filters collapse behind one toggle; whatever is active shows as removable
   chips inline next to it. */

import React from "react";
import { Icon, type IconName } from "@/lib/icons";
import { useShell } from "@/components/Shell";
import { mktVideos, mktBullets, subKinds, subOf, type MktVideo } from "@/lib/data";
import { EASE, PlayBadge, PurpleButton, fadeUp, useCountUp } from "@/lib/ui";

const TYPE_META: Record<string, { label: string; fg: string }> = {
  review: { label: "Review", fg: "#8c52ff" },
  item: { label: "Dish", fg: "#f59512" },
  interior: { label: "Interior", fg: "#6346cd" },
  event: { label: "Event", fg: "#16a06b" },
  vlog: { label: "Vlog", fg: "#2563eb" },
};

const TIER_META: Record<string, { label: string; icon: IconName; fg: string; bg: string }> = {
  leaderboard: { label: "Top creator", icon: "crown", fg: "#b9700a", bg: "rgba(245,149,18,0.14)" },
  regular: { label: "Regular", icon: "heart", fg: "#8c52ff", bg: "rgba(140,82,255,0.12)" },
  first: { label: "First time", icon: "sparkle", fg: "#16a06b", bg: "rgba(22,160,107,0.12)" },
};

const SOURCE_META: Record<string, { label: string; icon: IconName; bg: string }> = {
  TikTok: { label: "TikTok", icon: "tiktok", bg: "rgba(17,24,39,0.78)" },
  Instagram: { label: "Instagram", icon: "instagram", bg: "rgba(214,41,118,0.85)" },
  upload: { label: "Divvit", icon: "upload", bg: "rgba(140,82,255,0.9)" },
};

const recency = (d: number) => (d === 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`);

type Filters = { recency: string; type: string; sub: string; tier: string };
const EMPTY: Filters = { recency: "all", type: "all", sub: "all", tier: "all" };

export default function CollectionPage() {
  const { toast } = useShell();
  const [filters, setFilters] = React.useState<Filters>(EMPTY);
  const [open, setOpen] = React.useState(false);
  const [decided, setDecided] = React.useState<Record<string, boolean>>({});
  const [removing, setRemoving] = React.useState<string | null>(null);
  const [detail, setDetail] = React.useState<MktVideo | null>(null);
  const [confirmAll, setConfirmAll] = React.useState(false);

  const todayCount = mktVideos.filter((v) => v.daysAgo === 0).length;
  const intake = useCountUp(todayCount, 900);

  const pool = mktVideos.filter((v) => !decided[v.id]);
  const matches = (v: MktVideo) =>
    (filters.recency === "all"
      || (filters.recency === "today" && v.daysAgo === 0)
      || (filters.recency === "week" && v.daysAgo <= 7)
      || (filters.recency === "older" && v.daysAgo > 7))
    && (filters.type === "all" || v.type === filters.type)
    && (filters.sub === "all" || subOf(v) === filters.sub)
    && (filters.tier === "all" || v.tier === filters.tier);

  const list = pool.filter(matches);
  const raw = list.filter((v) => v.source === "upload").length;
  const social = list.length - raw;

  const decide = (v: MktVideo, accept: boolean) => {
    setRemoving(v.id);
    window.setTimeout(() => {
      setDecided((d) => ({ ...d, [v.id]: true }));
      setRemoving(null);
    }, 320);
    setDetail(null);
    toast(accept ? "Accepted" : "Passed on", v.creator);
  };

  const acceptAll = () => {
    setDecided((d) => ({ ...d, ...Object.fromEntries(list.map((v) => [v.id, true])) }));
    setConfirmAll(false);
    toast("Accepted", `${list.length} videos`);
  };

  const count = (key: keyof Filters, value: string) =>
    pool.filter((v) => matches({ ...v } as MktVideo) || true).filter((v) => {
      const probe = { ...filters, [key]: value };
      return (probe.recency === "all"
          || (probe.recency === "today" && v.daysAgo === 0)
          || (probe.recency === "week" && v.daysAgo <= 7)
          || (probe.recency === "older" && v.daysAgo > 7))
        && (probe.type === "all" || v.type === probe.type)
        && (probe.sub === "all" || subOf(v) === probe.sub)
        && (probe.tier === "all" || v.tier === probe.tier);
    }).length;

  const GROUPS: { key: keyof Filters; label: string; chips: { value: string; label: string }[] }[] = [
    { key: "recency", label: "WHEN", chips: [
      { value: "all", label: "Any time" }, { value: "today", label: "Today" },
      { value: "week", label: "This week" }, { value: "older", label: "Older" }] },
    { key: "type", label: "WHAT'S IN IT", chips: [
      { value: "all", label: "All types" }, { value: "review", label: "Review" },
      { value: "item", label: "Dish" }, { value: "interior", label: "Interior" },
      { value: "event", label: "Event" }, { value: "vlog", label: "Vlog" }] },
    { key: "sub", label: "HOW IT ARRIVED", chips: [
      { value: "all", label: "Any kind" }, { value: "general", label: "General" },
      { value: "instructions", label: "To instructions" }, { value: "social", label: "Posted social" }] },
    { key: "tier", label: "WHO SENT IT", chips: [
      { value: "all", label: "Anyone" }, { value: "leaderboard", label: "Top creators" },
      { value: "regular", label: "Regulars" }, { value: "first", label: "First-time" }] },
  ];

  const activeChips = GROUPS.flatMap((g) =>
    filters[g.key] === "all" ? [] : [{
      key: g.key,
      label: g.chips.find((c) => c.value === filters[g.key])?.label ?? filters[g.key],
    }]);

  return (
    <>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap", ...fadeUp("0.05s", "0.5s") }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, letterSpacing: "-0.01em" }}>The Collection</h1>
          <p style={{ margin: 0, color: "#6b7280", fontSize: 13.5 }}>
            Track all inflow of videos that come in from Divvit users submitting raw or social media videos.
          </p>
        </div>
        <PurpleButton onClick={() => list.length && setConfirmAll(true)} disabled={!list.length}
          style={{ opacity: list.length ? 1 : 0.5, cursor: list.length ? "pointer" : "default" }}>
          <Icon name="check" size={16} />Accept all{list.length ? ` (${list.length})` : ""}
        </PurpleButton>
      </div>

      {/* intake counter + filters */}
      <div style={{
        background: "linear-gradient(180deg,#f7f4fe,#f1ecfb)", border: "1px solid #e7dffb",
        borderRadius: 16, padding: "18px 22px", flex: "0 0 auto",
        display: "flex", flexDirection: "column", gap: 16, ...fadeUp("0.08s", "0.5s"),
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 28, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, flex: "0 0 auto" }}>
            <span style={{ fontSize: 40, fontWeight: 800, letterSpacing: "-0.03em", lineHeight: 1 }}>{intake}</span>
            <span style={{ fontSize: 14, color: "#6b7280" }}>new today</span>
          </div>
          <span style={{ flex: 1 }} />
          <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 13, color: "#6b7280" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: "#8c52ff" }} />{raw} raw
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: "#16a06b" }} />{social} social
            </span>
          </div>
        </div>

        <div style={{ height: 1, background: "#e7dffb" }} />

        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
          <Icon name="filter" size={16} color="#8c52ff" />
          <span style={{ fontSize: 13.5, fontWeight: 600 }}>Browse by</span>
          <button onClick={() => setOpen((o) => !o)} style={{
            display: "inline-flex", alignItems: "center", gap: 7, padding: "6px 13px",
            borderRadius: 9, fontSize: 12.5, fontWeight: 600,
            color: open ? "#fff" : "#6f3bea",
            background: open ? "#8c52ff" : "rgba(140,82,255,0.1)",
            transition: "background 0.16s ease, color 0.16s ease",
          }}>
            Filters
            <span style={{ display: "flex", transform: open ? "rotate(180deg)" : "none", transition: `transform 0.22s ${EASE}` }}>
              <Icon name="chevron" size={13} />
            </span>
          </button>

          {!open && activeChips.map((c) => (
            <button key={c.key} onClick={() => setFilters((f) => ({ ...f, [c.key]: "all" }))}
              style={{
                display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 11px",
                borderRadius: 99, fontSize: 12, fontWeight: 600, color: "#6f3bea",
                background: "rgba(140,82,255,0.1)",
              }}>
              {c.label}<Icon name="x" size={11} />
            </button>
          ))}

          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 13, color: "#6b7280", whiteSpace: "nowrap" }}>
            <b style={{ color: "#111827" }}>{list.length}</b> {list.length === 1 ? "video" : "videos"}
          </span>
          {activeChips.length > 0 && (
            <button onClick={() => setFilters(EMPTY)} style={{
              display: "flex", alignItems: "center", gap: 5, fontSize: 12.5, fontWeight: 600,
              color: "#8c52ff", padding: "5px 10px", borderRadius: 8, background: "rgba(140,82,255,0.08)",
            }}>
              <Icon name="x" size={12} />Reset all
            </button>
          )}
        </div>

        {open && (
          <div style={{ display: "flex", flexDirection: "column", gap: 9, animation: "dvFadeIn 0.22s ease" }}>
            {GROUPS.map((g) => (
              <div key={g.key} style={{ display: "grid", gridTemplateColumns: "126px 1fr", gap: 14, alignItems: "center" }}>
                <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.07em", color: "#9089a8", textAlign: "right" }}>{g.label}</span>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
                  {g.chips.map((c) => {
                    const on = filters[g.key] === c.value;
                    const n = count(g.key, c.value);
                    return (
                      <button key={c.value} onClick={() => setFilters((f) => ({ ...f, [g.key]: c.value }))}
                        style={{
                          display: "inline-flex", alignItems: "center", gap: 7, padding: "7px 13px",
                          borderRadius: 99, fontSize: 12.5, fontWeight: 600, whiteSpace: "nowrap",
                          color: on ? "#fff" : "#4b5563",
                          background: on ? "#8c52ff" : "#ffffff",
                          boxShadow: on ? "0 1px 3px rgba(140,82,255,0.35)" : "inset 0 0 0 1px rgba(17,24,39,0.08)",
                          opacity: n === 0 && !on ? 0.45 : 1,
                          transition: "background 0.16s ease, color 0.16s ease, opacity 0.16s ease",
                        }}>
                        {c.label}
                        <span style={{ fontSize: 11, fontWeight: 700, color: on ? "rgba(255,255,255,0.75)" : "#9ca3af" }}>{n}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {list.length === 0 && (
        <div style={{
          background: "#fff", border: "1px dashed #cfc7e2", borderRadius: 14,
          padding: "52px 24px", textAlign: "center", color: "#9ca3af", fontSize: 13.5, flex: "0 0 auto",
        }}>No videos match these filters. Try widening your search.</div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 16, paddingBottom: 8 }}>
        {list.map((v, i) => {
          const t = TYPE_META[v.type];
          const tier = TIER_META[v.tier];
          const src = SOURCE_META[v.source];
          return (
            <div key={v.id} onClick={() => setDetail(v)} className="cardLift" style={{
              background: "#fff", borderRadius: 18, overflow: "hidden", display: "flex",
              flexDirection: "column", cursor: "pointer",
              boxShadow: "0 0 0 1px rgba(17,24,39,0.07), 0 2px 6px rgba(58,32,137,0.05)",
              animation: removing === v.id
                ? `dvPopOut 0.32s ${EASE} forwards`
                : `dvFadeUp 0.5s ${(0.04 * (i % 9)).toFixed(2)}s ${EASE} backwards`,
            }}>
              <div style={{ position: "relative", aspectRatio: "16/10", background: v.thumbBg, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <PlayBadge />
                <span style={{
                  position: "absolute", top: 9, left: 9, display: "inline-flex", alignItems: "center", gap: 5,
                  fontSize: 11, fontWeight: 700, color: "#fff", background: src.bg, borderRadius: 7, padding: "3px 9px 3px 7px",
                }}>
                  <Icon name={src.icon} size={12} />{src.label}
                </span>
                <span style={{ position: "absolute", bottom: 9, right: 9, fontSize: 11, fontWeight: 600, color: "#fff", background: "rgba(17,24,39,0.65)", borderRadius: 6, padding: "2px 7px" }}>{v.length}</span>
              </div>
              <div style={{ padding: "13px 14px", display: "flex", flexDirection: "column", gap: 9, flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, color: "#4b5563" }}>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: t.fg }} />{t.label}
                  </span>
                  <span title={tier.label} style={{
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                    width: 24, height: 24, borderRadius: 7, color: tier.fg, background: tier.bg,
                  }}>
                    <Icon name={tier.icon} size={14} />
                  </span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1 }}>
                  <span style={{ fontWeight: 700, fontSize: 14, letterSpacing: "-0.01em" }}>{v.creator}</span>
                  <span style={{ fontSize: 12, color: "#9ca3af" }}>{v.handle} · {recency(v.daysAgo)}</span>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 7 }}>
                    {(mktBullets[v.id] ?? []).map((b) => (
                      <span key={b} style={{ display: "flex", alignItems: "flex-start", gap: 7, fontSize: 12.5, lineHeight: 1.4, color: "#4b5563" }}>
                        <span style={{ width: 4, height: 4, borderRadius: "50%", background: "#c3b6e8", flex: "0 0 auto", marginTop: 6 }} />{b}
                      </span>
                    ))}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 11.5, color: "#9ca3af", padding: "2px 0" }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                    <Icon name={v.source === "upload" ? "download" : "eye"} size={13} />
                    {v.source === "upload" ? v.fileSize : `${v.views} views`}
                  </span>
                  {v.source !== "upload" && (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                      <Icon name="heart" size={13} />{v.likes}
                    </span>
                  )}
                </div>
                <div style={{ display: "flex", gap: 8 }} onClick={(e) => e.stopPropagation()}>
                  <button onClick={() => decide(v, true)} style={{
                    flex: 1, padding: "9px 0", borderRadius: 11,
                    background: "linear-gradient(135deg,#9a63ff,#7a3ef0)", color: "#fff",
                    fontSize: 13, fontWeight: 700, letterSpacing: "0.01em",
                    boxShadow: "0 2px 8px rgba(122,62,240,0.24)",
                  }}>Accept</button>
                  <button onClick={() => decide(v, false)} className="btnQuiet" style={{ flex: 1, padding: "9px 0", borderRadius: 9, fontSize: 13, color: "#6b7280" }}>Pass</button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {confirmAll && (
        <div onClick={() => setConfirmAll(false)} role="dialog" aria-modal style={{
          position: "fixed", inset: 0, zIndex: 60, background: "rgba(17,24,39,0.42)",
          display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
          animation: "dvFadeIn 0.2s ease",
        }}>
          <div onClick={(e) => e.stopPropagation()} style={{
            width: 404, maxWidth: "100%", background: "#fff", borderRadius: 18,
            boxShadow: "0 18px 48px rgba(17,24,39,0.16)", padding: 26,
            display: "flex", flexDirection: "column", gap: 8, animation: `dvPop 0.28s ${EASE}`,
          }}>
            <div style={{
              width: 46, height: 46, borderRadius: 12, background: "rgba(140,82,255,0.12)",
              color: "#8c52ff", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 4,
            }}>
              <Icon name="check" size={22} />
            </div>
            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, letterSpacing: "-0.01em" }}>Accept all {list.length} videos?</h3>
            <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5, color: "#6b7280" }}>
              Every video matching your current filters will move to your Content Manager library, ready to publish. You can archive any of them later.
            </p>
            <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
              <button onClick={() => setConfirmAll(false)} className="btnQuiet" style={{ flex: 1, padding: "10px 0", borderRadius: 10, fontSize: 13.5 }}>Cancel</button>
              <button onClick={acceptAll} className="btnPurple" style={{ flex: 1, padding: "10px 0", borderRadius: 10, fontSize: 13.5 }}>Accept all</button>
            </div>
          </div>
        </div>
      )}

      {detail && <DetailModal video={detail} onClose={() => setDetail(null)} onDecide={decide} />}
    </>
  );
}

function DetailModal({ video, onClose, onDecide }: {
  video: MktVideo;
  onClose: () => void;
  onDecide: (v: MktVideo, accept: boolean) => void;
}) {
  const kind = subKinds[subOf(video)];
  const src = SOURCE_META[video.source];
  const tier = TIER_META[video.tier];
  const t = TYPE_META[video.type];

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const rows = [
    { label: "Length", value: video.length },
    { label: "Type", value: t.label },
    { label: "Creator tier", value: tier.label },
    video.source === "upload"
      ? { label: "File size", value: video.fileSize }
      : { label: "Views", value: video.views },
  ];

  return (
    <div onClick={onClose} role="dialog" aria-modal aria-label={video.creator} style={{
      position: "fixed", inset: 0, zIndex: 60, background: "rgba(17,24,39,0.45)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
      animation: "dvFadeIn 0.2s ease",
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: 780, maxWidth: "100%", maxHeight: "calc(100vh - 48px)", background: "#fff",
        borderRadius: 20, boxShadow: "0 18px 48px rgba(17,24,39,0.18)", display: "flex",
        overflow: "hidden", animation: `dvPop 0.28s ${EASE}`,
      }}>
        <div style={{ flex: "0 0 46%", position: "relative", background: video.thumbBg, display: "flex", alignItems: "center", justifyContent: "center", minHeight: 420 }}>
          <PlayBadge size={58} />
          <span style={{
            position: "absolute", top: 12, left: 12, display: "inline-flex", alignItems: "center", gap: 5,
            fontSize: 11.5, fontWeight: 700, color: "#fff", background: src.bg, borderRadius: 7, padding: "4px 10px 4px 8px",
          }}>
            <Icon name={src.icon} size={12} />{src.label}
          </span>
          <span style={{ position: "absolute", bottom: 12, right: 12, fontSize: 11.5, fontWeight: 600, color: "#fff", background: "rgba(17,24,39,0.65)", borderRadius: 6, padding: "3px 9px" }}>{video.length}</span>
        </div>

        <div style={{ flex: 1, padding: "24px 26px", display: "flex", flexDirection: "column", gap: 14, overflow: "auto" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <span style={{ display: "inline-flex", alignItems: "center", fontSize: 10.5, fontWeight: 700, color: t.fg, background: `${t.fg}1f`, borderRadius: 6, padding: "4px 10px" }}>{t.label.toUpperCase()}</span>
            <button onClick={onClose} className="hoverInk" aria-label="Close" style={{
              width: 30, height: 30, borderRadius: 9, background: "#f5f5f9",
              boxShadow: "0 0 0 1px rgba(17,24,39,0.07)", display: "flex",
              alignItems: "center", justifyContent: "center", color: "#9ca3af",
            }}><Icon name="x" size={15} /></button>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ fontWeight: 800, fontSize: 20, letterSpacing: "-0.02em" }}>{video.creator}</span>
            <span style={{ fontSize: 13, color: "#9ca3af" }}>{video.handle} · {recency(video.daysAgo)}</span>
          </div>

          <span style={{
            display: "inline-flex", alignItems: "center", gap: 7, alignSelf: "flex-start",
            fontSize: 12, fontWeight: 600, color: tier.fg, background: tier.bg, borderRadius: 99, padding: "5px 12px",
          }}>
            <Icon name={tier.icon} size={13} />{tier.label}
          </span>

          <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55, color: "#4b5563" }}>{video.context}</p>

          <div style={{ display: "flex", flexDirection: "column", gap: 9, padding: 14, borderRadius: 14, background: "#faf9fd", boxShadow: "inset 0 0 0 1px rgba(17,24,39,0.06)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
              <span style={{
                display: "flex", alignItems: "center", justifyContent: "center", width: 32, height: 32,
                borderRadius: 10, flex: "0 0 auto", color: kind.fg, background: kind.bg,
              }}>
                <Icon name={kind.iconKey as IconName} size={16} />
              </span>
              <span style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.07em", color: "#9ca3af" }}>SUBMISSION TYPE</span>
                <span style={{ fontSize: 13.5, fontWeight: 700 }}>{kind.full}</span>
              </span>
            </div>
            <span style={{ fontSize: 12, lineHeight: 1.45, color: "#6b7280" }}>{kind.note}</span>
            <div style={{ height: 1, background: "rgba(17,24,39,0.07)" }} />
            <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
              <span style={{
                display: "flex", alignItems: "center", justifyContent: "center", width: 32, height: 32,
                borderRadius: 10, flex: "0 0 auto", color: "#b9700a", background: "rgba(245,149,18,0.13)",
              }}>
                <Icon name="gift" size={16} />
              </span>
              <span style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.07em", color: "#9ca3af" }}>THEY EARN</span>
                <span style={{ fontSize: 13.5, fontWeight: 700 }}>{kind.reward}</span>
              </span>
              <span style={{ flex: 1 }} />
              <span style={{ fontSize: 11.5, fontWeight: 600, color: "#0d7a4f", background: "rgba(22,160,107,0.1)", borderRadius: 99, padding: "4px 10px" }}>On accept</span>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", borderTop: "1px solid #f1eff8" }}>
            {rows.map((r) => (
              <div key={r.label} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "9px 0", borderBottom: "1px solid #f1eff8", fontSize: 12.5 }}>
                <span style={{ color: "#9ca3af", fontWeight: 500 }}>{r.label}</span>
                <span style={{ color: "#111827", fontWeight: 600 }}>{r.value}</span>
              </div>
            ))}
          </div>

          <div style={{ flex: 1 }} />
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={() => onDecide(video, true)} style={{
              flex: 1, padding: "11px 0", borderRadius: 12,
              background: "linear-gradient(135deg,#9a63ff,#7a3ef0)", color: "#fff",
              fontSize: 13.5, fontWeight: 700, boxShadow: "0 3px 10px rgba(122,62,240,0.26)",
            }}>Accept</button>
            <button onClick={() => onDecide(video, false)} className="btnQuiet" style={{ flex: 1, padding: "11px 0", borderRadius: 10, fontSize: 13.5, color: "#6b7280" }}>Pass</button>
          </div>
        </div>
      </div>
    </div>
  );
}
