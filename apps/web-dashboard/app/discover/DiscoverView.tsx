"use client";

/* Discover — what the public web is actually saying about the roster.

   Client half: filtering only. Every figure is counted from rows on the
   server. The page this replaced showed mention tallies, quoted comments and
   per-comment recommendations that no table produced; none of that is
   reconstructed here, because a fabricated insight is worse than a missing
   one when a venue is about to act on it. */

import React from "react";
import { Icon, type IconName } from "@/lib/icons";
import { EASE, QuietButton, Segmented, fadeUp, useCountUp } from "@/lib/ui";
import { compactCount } from "@/lib/format";
import { NotBuiltYet } from "@/components/EmptyState";
import type { FeedVideo } from "@/lib/queries";

const PLATFORM: Record<string, { label: string; icon: IconName; fg: string; bg: string }> = {
  youtube:   { label: "YouTube",   icon: "play",      fg: "#c4302b", bg: "rgba(196,48,43,0.10)" },
  tiktok:    { label: "TikTok",    icon: "tiktok",    fg: "#111827", bg: "rgba(17,24,39,0.07)" },
  instagram: { label: "Instagram", icon: "instagram", fg: "#c13584", bg: "rgba(193,53,132,0.10)" },
};

function ago(iso: string | null): string {
  if (!iso) return "—";
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (d < 1) return "today";
  if (d < 30) return `${d}d ago`;
  if (d < 365) return `${Math.floor(d / 30)}mo ago`;
  return `${Math.floor(d / 365)}y ago`;
}

function duration(seconds: number | null): string | null {
  if (!seconds) return null;
  const m = Math.floor(seconds / 60), s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function DiscoverView({ videos, mix, venueCount, videoTotal }: {
  videos: FeedVideo[];
  mix: { platform: string; count: number }[];
  venueCount: number;
  videoTotal: number;
}) {
  const [platform, setPlatform] = React.useState("all");
  const found = useCountUp(videoTotal, 900, true);

  const shown = React.useMemo(
    () => (platform === "all" ? videos : videos.filter((v) => v.platform === platform)),
    [videos, platform],
  );

  // Counted over the loaded feed, not the corpus — labelled accordingly below,
  // because summing 120 rows and calling it the roster total would overstate
  // nothing but understate everything.
  const measured = videos.filter((v) => typeof v.view_count === "number");
  const totalViews = measured.reduce((s, v) => s + (v.view_count ?? 0), 0);

  return (
    <>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between",
                    gap: 16, flexWrap: "wrap", ...fadeUp("0.05s", "0.5s") }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, letterSpacing: "-0.01em" }}>Discover</h1>
          <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 13.5 }}>
            Public videos we have found about venues on the roster.
          </p>
        </div>
        <QuietButton><Icon name="radar" size={16} />Run a scan</QuietButton>
      </div>

      <div style={{
        background: "linear-gradient(180deg,#f7f4fe,#f1ecfb)", border: "1px solid #e7dffb",
        borderRadius: 16, padding: "18px 22px", display: "flex", alignItems: "center",
        gap: 28, flexWrap: "wrap", ...fadeUp("0.08s", "0.5s"),
      }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <span style={{ fontSize: 40, fontWeight: 800, letterSpacing: "-0.03em", lineHeight: 1 }}>
            {found}
          </span>
          <span style={{ fontSize: 14, color: "var(--text-muted)" }}>videos found</span>
        </div>
        <div style={{ flex: 1, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
          {[
            { label: "Across venues", value: String(venueCount) },
            { label: `Views across newest ${videos.length}`, value: compactCount(totalViews) },
            ...mix.map((m) => ({
              label: PLATFORM[m.platform]?.label ?? m.platform,
              value: String(m.count),
            })),
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

      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
                    ...fadeUp("0.12s") }}>
        <Segmented value={platform} onChange={setPlatform} options={[
          { value: "all", label: "All", count: videos.length },
          ...mix.map((m) => ({
            value: m.platform,
            label: PLATFORM[m.platform]?.label ?? m.platform,
            count: videos.filter((v) => v.platform === m.platform).length,
          })),
        ]} />
        <span style={{ flex: 1 }} />
        {/* The feed is capped, but the summary above counts the whole corpus.
            Saying "120 shown" beside a chip reading "YouTube 387" looks like a
            contradiction unless the cap is stated. */}
        <span style={{ fontSize: 13, color: "var(--text-muted)" }}>
          <b style={{ color: "var(--ink)" }}>{shown.length}</b>
          {videoTotal > videos.length ? ` of ${videoTotal}` : ""} · newest first
        </span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))",
                    gap: 14, ...fadeUp("0.16s") }}>
        {shown.map((v) => {
          const p = PLATFORM[v.platform ?? ""] ?? {
            label: v.platform ?? "—", icon: "video" as IconName,
            fg: "var(--text-muted)", bg: "var(--surface-sunken-2)" };
          const len = duration(v.duration_seconds);
          return (
            <a key={v.id} href={v.url ?? undefined} target="_blank" rel="noreferrer"
               style={{
                 display: "flex", flexDirection: "column", background: "var(--surface)",
                 borderRadius: 14, overflow: "hidden", textDecoration: "none",
                 color: "inherit",
                 boxShadow: "0 0 0 1px rgba(17,24,39,0.07), 0 2px 6px rgba(58,32,137,0.05)",
                 transition: `transform 0.18s ${EASE}, box-shadow 0.18s ${EASE}`,
               }}
               onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-2px)"; }}
               onMouseLeave={(e) => { e.currentTarget.style.transform = "none"; }}>
              <div style={{ position: "relative", aspectRatio: "16 / 9",
                            background: "var(--surface-sunken)" }}>
                {v.thumbnail_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={v.thumbnail_url} alt=""
                       style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                )}
                <span style={{ position: "absolute", top: 8, left: 8, display: "inline-flex",
                               alignItems: "center", gap: 5, fontSize: 11, fontWeight: 700,
                               color: p.fg, background: "rgba(255,255,255,0.92)",
                               borderRadius: 99, padding: "3px 9px" }}>
                  <Icon name={p.icon} size={11} color={p.fg} />{p.label}
                </span>
                {len && (
                  <span style={{ position: "absolute", bottom: 8, right: 8, fontSize: 11,
                                 fontWeight: 600, color: "#fff", background: "rgba(0,0,0,0.68)",
                                 borderRadius: 6, padding: "2px 6px",
                                 fontVariantNumeric: "tabular-nums" }}>{len}</span>
                )}
              </div>

              <div style={{ padding: "12px 14px 14px", display: "flex", flexDirection: "column", gap: 7 }}>
                <span style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.4,
                               display: "-webkit-box", WebkitLineClamp: 2,
                               WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                  {v.title || "Untitled"}
                </span>
                <span style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
                  {v.creator_display_name || v.creator_handle || "Unknown creator"}
                </span>
                {v.business_name && (
                  <span style={{ fontSize: 11.5, color: "var(--purple-deep)", fontWeight: 600 }}>
                    {v.business_name}{v.business_city ? ` · ${v.business_city}` : ""}
                  </span>
                )}
                <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 11.5,
                              color: "var(--text-faint)", fontVariantNumeric: "tabular-nums" }}>
                  <span title="views">{compactCount(v.view_count)} views</span>
                  <span title="likes">{compactCount(v.like_count)} likes</span>
                  <span style={{ marginLeft: "auto" }}>{ago(v.published_at)}</span>
                </div>
              </div>
            </a>
          );
        })}
      </div>

      {!shown.length && (
        <NotBuiltYet
          icon="radar"
          title="Nothing found on TikTok or Instagram"
          reason="Discover shows TikTok and Instagram only. The harvest so far is
                  entirely YouTube, which is excluded deliberately — it is the
                  one source keyless tooling reaches, and a news segment is not
                  the customer-filmed video this product is about. TikTok and
                  Instagram do not expose discovery without keyed access."
          table="discovered_videos · 0 tiktok/instagram"
        />
      )}

      <div style={{ display: "flex", alignItems: "flex-start", gap: 9, padding: "11px 14px",
                    borderRadius: 10, background: "var(--surface-sunken-3)",
                    border: "1px solid var(--surface-sunken-2)", fontSize: 12.5,
                    color: "var(--text-muted)", lineHeight: 1.6, ...fadeUp("0.2s") }}>
        <Icon name="info" size={14} color="var(--text-faint)" />
        <span>
          Sentiment, comment themes and per-comment recommendations are not
          shown because nothing measures them yet. These are the videos found
          by the discovery harvest, with the metrics their platforms reported.
        </span>
      </div>
    </>
  );
}
