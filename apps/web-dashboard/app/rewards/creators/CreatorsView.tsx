"use client";

/* Creators — who has actually filmed about this roster.
   Client half: filtering and sorting only. Every number arrives measured
   from the server; nothing here derives a value the database did not carry. */

import React from "react";
import { Icon } from "@/lib/icons";
import { EASE, QuietButton, Segmented, fadeUp } from "@/lib/ui";
import { compactCount } from "@/lib/format";
import type { LeaderboardCreator } from "@/lib/queries";

const GRID = "22px 2.2fr 1fr 0.9fr 0.8fr 0.9fr 1fr";

type SortKey = "views" | "videos" | "followers" | "name";

const PLATFORM: Record<string, { label: string; fg: string; bg: string }> = {
  youtube:   { label: "YouTube",   fg: "#c4302b", bg: "rgba(196,48,43,0.10)" },
  tiktok:    { label: "TikTok",    fg: "#111827", bg: "rgba(17,24,39,0.07)" },
  instagram: { label: "Instagram", fg: "#c13584", bg: "rgba(193,53,132,0.10)" },
};

/** Bucketed by how much they post about the roster — the only tiering the
 *  data supports. The old fixture had Top/Regular/First-time backed by
 *  nothing, and a reward tier invented in the UI would misprice real payouts. */
function band(c: LeaderboardCreator): "prolific" | "repeat" | "single" {
  if (c.video_count >= 3) return "prolific";
  if (c.video_count === 2) return "repeat";
  return "single";
}

const BAND_LABEL: Record<string, string> = {
  prolific: "3+ videos", repeat: "2 videos", single: "1 video",
};

function since(iso: string | null): string {
  if (!iso) return "—";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days < 1) return "today";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

export default function CreatorsView({ creators, videoTotal }: {
  creators: LeaderboardCreator[];
  videoTotal: number;
}) {
  const [filter, setFilter] = React.useState("all");
  const [sort, setSort] = React.useState<SortKey>("views");
  const [desc, setDesc] = React.useState(true);

  const counts = React.useMemo(() => ({
    all: creators.length,
    prolific: creators.filter((c) => band(c) === "prolific").length,
    repeat: creators.filter((c) => band(c) === "repeat").length,
    single: creators.filter((c) => band(c) === "single").length,
  }), [creators]);

  const shown = React.useMemo(() => {
    const base = filter === "all" ? creators : creators.filter((c) => band(c) === filter);
    const dir = desc ? -1 : 1;
    // Nulls sort last in either direction: "not measured" is not a low value,
    // and flipping the sort must not float unmeasured rows to the top.
    const num = (v: number | null) => (v === null ? undefined : v);
    return [...base].sort((a, b) => {
      if (sort === "name")
        return dir * (a.display_name ?? "").localeCompare(b.display_name ?? "");
      const [x, y] = sort === "views"
        ? [num(a.total_views), num(b.total_views)]
        : sort === "followers"
          ? [num(a.follower_count), num(b.follower_count)]
          : [a.video_count, b.video_count];
      if (x === undefined && y === undefined) return 0;
      if (x === undefined) return 1;
      if (y === undefined) return -1;
      return dir * (x - y);
    });
  }, [creators, filter, sort, desc]);

  const toggle = (key: SortKey) => {
    if (sort === key) setDesc((d) => !d);
    else { setSort(key); setDesc(true); }
  };

  const measuredViews = creators.reduce((s, c) => s + (c.total_views ?? 0), 0);
  const unmeasured = creators.filter((c) => c.total_views === null).length;

  return (
    <>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between",
                    gap: 16, flexWrap: "wrap", ...fadeUp("0.05s", "0.5s") }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, letterSpacing: "-0.01em" }}>Creators</h1>
          <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 13.5 }}>
            Everyone we have found posting about the Orange County roster.
          </p>
        </div>
        <QuietButton><Icon name="users" size={16} />Invite creators</QuietButton>
      </div>

      {/* Summary. Every figure here is counted from rows, not asserted. */}
      <div style={{
        background: "linear-gradient(180deg,#f7f4fe,#f1ecfb)", border: "1px solid #e7dffb",
        borderRadius: 16, padding: "18px 22px", display: "flex", alignItems: "center",
        gap: 28, flexWrap: "wrap", ...fadeUp("0.08s", "0.5s"),
      }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <span style={{ fontSize: 40, fontWeight: 800, letterSpacing: "-0.03em", lineHeight: 1 }}>
            {creators.length}
          </span>
          <span style={{ fontSize: 14, color: "var(--text-muted)" }}>creators</span>
        </div>
        <div style={{ flex: 1, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
          {[
            { label: "Videos discovered", value: String(videoTotal) },
            { label: "Views measured", value: compactCount(measuredViews) },
            { label: "Posted more than once", value: String(counts.prolific + counts.repeat) },
            ...(unmeasured
              ? [{ label: "Views not measured", value: String(unmeasured) }]
              : []),
          ].map((t) => (
            <span key={t.label} style={{
              display: "inline-flex", alignItems: "center", gap: 7, fontSize: 13, fontWeight: 500,
              color: "var(--text-secondary)", border: "1px solid #e7dffb", background: "#fff",
              borderRadius: 8, padding: "5px 11px",
            }}>
              {t.label}<span style={{ color: "var(--text-faint)", fontWeight: 600 }}>{t.value}</span>
            </span>
          ))}
        </div>
      </div>

      <div style={{
        background: "var(--surface)", borderRadius: 14, padding: 20, display: "flex",
        flexDirection: "column", gap: 4, marginBottom: 8,
        boxShadow: "0 0 0 1px rgba(17,24,39,0.07), 0 2px 6px rgba(58,32,137,0.05)",
        ...fadeUp("0.16s", "0.6s"),
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, paddingBottom: 12, flexWrap: "wrap" }}>
          <Segmented value={filter} onChange={setFilter} options={[
            { value: "all", label: "All", count: counts.all },
            { value: "prolific", label: "3+ videos", count: counts.prolific },
            { value: "repeat", label: "2 videos", count: counts.repeat },
            { value: "single", label: "1 video", count: counts.single },
          ]} />
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 13, color: "var(--text-muted)" }}>
            <b style={{ color: "var(--ink)" }}>{shown.length}</b> shown
          </span>
        </div>

        <div style={{
          display: "grid", gridTemplateColumns: GRID, gap: 12, padding: "6px 10px",
          fontSize: 11.5, fontWeight: 600, letterSpacing: "0.03em",
          color: "var(--text-faint)", textTransform: "uppercase",
        }}>
          <span>#</span>
          <SortHead label="Creator" active={sort === "name"} desc={desc} onClick={() => toggle("name")} />
          <span>Platform</span>
          <SortHead label="Followers" active={sort === "followers"} desc={desc} onClick={() => toggle("followers")} />
          <SortHead label="Videos" active={sort === "videos"} desc={desc} onClick={() => toggle("videos")} />
          <SortHead label="Views" active={sort === "views"} desc={desc} onClick={() => toggle("views")} />
          <span style={{ justifySelf: "end" }}>Last posted</span>
        </div>

        {shown.map((c, i) => {
          const p = PLATFORM[c.platform ?? ""] ?? { label: c.platform ?? "—", fg: "var(--text-muted)", bg: "var(--surface-sunken-2)" };
          return (
            <div key={c.id} className="hoverRowPurple" style={{
              display: "grid", gridTemplateColumns: GRID, gap: 12, alignItems: "center",
              padding: 10, borderTop: "1px solid #f1eff8", borderRadius: 8,
            }}>
              <span style={{ fontSize: 12, color: "var(--text-faint)", fontVariantNumeric: "tabular-nums" }}>
                {String(i + 1).padStart(2, "0")}
              </span>
              <div style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
                <span style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: "nowrap",
                               overflow: "hidden", textOverflow: "ellipsis" }}>
                  {c.display_name || c.handle || "—"}
                </span>
                <span style={{ fontSize: 11.5, color: "var(--text-faint)" }}>
                  {c.handle ?? "—"} · {BAND_LABEL[band(c)]}
                </span>
              </div>
              <span style={{ justifySelf: "start", fontSize: 11.5, fontWeight: 600,
                             color: p.fg, background: p.bg, borderRadius: 99, padding: "3px 9px" }}>
                {p.label}
              </span>
              <span style={{ fontSize: 13, fontVariantNumeric: "tabular-nums" }}>
                {compactCount(c.follower_count)}
              </span>
              <span style={{ fontSize: 13, fontVariantNumeric: "tabular-nums" }}>{c.video_count}</span>
              <span style={{ fontSize: 13, fontVariantNumeric: "tabular-nums",
                             color: c.total_views === null ? "var(--text-faint)" : "var(--ink)" }}>
                {compactCount(c.total_views)}
              </span>
              <span style={{ justifySelf: "end", fontSize: 12.5, color: "var(--text-muted)" }}>
                {since(c.last_published_at)}
              </span>
            </div>
          );
        })}

        {!shown.length && (
          <div style={{ padding: "28px 10px", textAlign: "center", fontSize: 13,
                        color: "var(--text-muted)" }}>
            No creators in this band yet.
          </div>
        )}
      </div>

      {/* Said plainly rather than filled with a plausible number. */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 9, padding: "11px 14px",
                    borderRadius: 10, background: "var(--surface-sunken-3)",
                    border: "1px solid var(--surface-sunken-2)", fontSize: 12.5,
                    color: "var(--text-muted)", lineHeight: 1.6, ...fadeUp("0.2s") }}>
        <Icon name="info" size={14} color="var(--text-faint)" />
        <span>
          Rewards, redemptions and visit history are not shown because nothing
          records them yet — the tables exist and are empty. These are creators
          discovered posting publicly about venues on the roster, not people who
          have claimed anything.
        </span>
      </div>
    </>
  );
}

function SortHead({ label, active, desc, onClick }: {
  label: string; active: boolean; desc: boolean; onClick: () => void;
}) {
  return (
    <button onClick={onClick} style={{
      display: "inline-flex", alignItems: "center", gap: 4, background: "none", border: "none",
      padding: 0, cursor: "pointer", font: "inherit", letterSpacing: "inherit",
      textTransform: "inherit", color: active ? "var(--purple-deep)" : "inherit",
      transition: `color 0.15s ${EASE}`,
    }}>
      {label}
      <span style={{ fontSize: 8, opacity: active ? 1 : 0.25 }}>{active && !desc ? "▲" : "▼"}</span>
    </button>
  );
}
