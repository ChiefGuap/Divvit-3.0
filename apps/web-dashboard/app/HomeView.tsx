"use client";

/* Dashboard home.

   What this shows is bounded by what is measured. The version it replaces had
   a seven-day attention chart, a submission-inflow histogram and a paid-CPM
   comparison — all computed from fixtures, none backed by a table. They are
   gone rather than zeroed, because an empty chart still asserts that the axis
   means something we measure. */

import React from "react";
import Link from "next/link";
import { Icon, type IconName } from "@/lib/icons";
import { EASE, PlayBadge, fadeUp, useCountUp } from "@/lib/ui";
import { compactCount } from "@/lib/format";
import { NotBuiltYet } from "@/components/EmptyState";
import type { FeedVideo, RankedVenue } from "@/lib/queries";

export default function HomeView({ venue, videos, counts, submissionCount }: {
  venue: RankedVenue | null;
  videos: FeedVideo[];
  counts: { activeVenues: number; rankedVenues: number; videos: number };
  submissionCount: number;
}) {
  const greeting = React.useMemo(() => {
    const h = new Date().getHours();
    return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  }, []);
  const today = React.useMemo(
    () => new Date().toLocaleDateString(undefined, {
      weekday: "long", year: "numeric", month: "long", day: "numeric" }),
    [],
  );

  const score = venue?.snapshot?.score ?? venue?.organic_brand_health_score ?? null;
  const shown = useCountUp(score ?? 0, 1100, score !== null);

  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", gap: 2, ...fadeUp("0.04s", "0.5s") }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, letterSpacing: "-0.015em" }}>
          {greeting}
        </h1>
        <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 13.5 }}>{today}</p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(280px,1fr) minmax(300px,1.4fr)",
                    gap: 16, alignItems: "stretch", ...fadeUp("0.08s", "0.5s") }}>
        {/* Brand health — the one number on this page with a model behind it. */}
        <Link href="/discover/brand-health" style={{
          textDecoration: "none", color: "inherit",
          background: "linear-gradient(160deg,#6346cd,#41208f)", borderRadius: 18,
          padding: "22px 24px", display: "flex", flexDirection: "column", gap: 10,
          boxShadow: "0 10px 30px rgba(140,82,255,0.18)",
        }}>
          <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.11em",
                         color: "rgba(255,255,255,0.66)" }}>ORGANIC BRAND HEALTH</span>
          {score === null ? (
            <>
              <span style={{ fontSize: 34, fontWeight: 800, color: "#fff", lineHeight: 1 }}>—</span>
              <span style={{ fontSize: 12.5, color: "rgba(255,255,255,0.75)", lineHeight: 1.55 }}>
                Not measured for this venue yet.
              </span>
            </>
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <span style={{ fontSize: 46, fontWeight: 800, color: "#fff",
                               letterSpacing: "-0.03em", lineHeight: 1 }}>{shown}</span>
                <span style={{ fontSize: 15, color: "rgba(255,255,255,0.6)" }}>/ 100</span>
              </div>
              <span style={{ fontSize: 12.5, color: "rgba(255,255,255,0.8)", lineHeight: 1.55 }}>
                {venue?.name}{venue?.city ? ` · ${venue.city}` : ""}
                {venue?.snapshot?.confidence ? ` · ${venue.snapshot.confidence} confidence` : ""}
              </span>
            </>
          )}
        </Link>

        {/* Corpus coverage — counted, not estimated. */}
        <div style={{ background: "var(--surface)", borderRadius: 18, padding: "22px 24px",
                      display: "flex", flexDirection: "column", gap: 14,
                      boxShadow: "0 0 0 1px rgba(17,24,39,0.07), 0 2px 6px rgba(58,32,137,0.05)" }}>
          <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.11em",
                         color: "var(--text-faint)" }}>WHAT WE HAVE MEASURED</span>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
            {[
              { label: "Active venues", value: counts.activeVenues, href: "/discover/brand-health" },
              { label: "Scored + rankable", value: counts.rankedVenues, href: "/discover/brand-health" },
              { label: "Videos found", value: counts.videos, href: "/discover" },
            ].map((s) => (
              <Link key={s.label} href={s.href} style={{ textDecoration: "none", color: "inherit",
                                                         display: "flex", flexDirection: "column", gap: 3 }}>
                <span style={{ fontSize: 26, fontWeight: 750, letterSpacing: "-0.02em" }}>
                  {s.value}
                </span>
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{s.label}</span>
              </Link>
            ))}
          </div>
          <p style={{ margin: 0, fontSize: 11.5, color: "var(--text-faint)", lineHeight: 1.6 }}>
            Counted from rows. A venue is rankable only when enough of the model
            is measured for its score to compare against others.
          </p>
        </div>
      </div>

      {/* The triage queue this page used to lead with. */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10, ...fadeUp("0.13s") }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.11em",
                         color: "var(--text-faint)" }}>WAITING ON YOU</span>
        </div>
        {submissionCount === 0 ? (
          <NotBuiltYet
            icon="clapper"
            title="Nothing to review"
            reason="Guest submissions land here for accept or pass. Nothing can
                    submit yet, so the queue is empty rather than cleared."
            table="submissions"
          />
        ) : (
          <Link href="/collection" style={{ fontSize: 13.5, color: "var(--purple-deep)",
                                            fontWeight: 600, textDecoration: "none" }}>
            {submissionCount} waiting in The Collection →
          </Link>
        )}
      </div>

      {/* Newest discovered videos — real, and the liveliest thing on the page. */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10, ...fadeUp("0.18s") }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.11em",
                         color: "var(--text-faint)" }}>FOUND RECENTLY</span>
          <Link href="/discover" style={{ marginLeft: "auto", fontSize: 12.5,
                                          color: "var(--purple-deep)", fontWeight: 600,
                                          textDecoration: "none" }}>See all →</Link>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px,1fr))",
                      gap: 12 }}>
          {videos.slice(0, 8).map((v) => (
            <a key={v.id} href={v.url ?? undefined} target="_blank" rel="noreferrer"
               style={{ textDecoration: "none", color: "inherit", background: "var(--surface)",
                        borderRadius: 12, overflow: "hidden",
                        boxShadow: "0 0 0 1px rgba(17,24,39,0.07), 0 2px 6px rgba(58,32,137,0.05)",
                        transition: `transform 0.18s ${EASE}` }}
               onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-2px)"; }}
               onMouseLeave={(e) => { e.currentTarget.style.transform = "none"; }}>
              <div style={{ aspectRatio: "16 / 9", background: "var(--surface-sunken)" }}>
                {v.thumbnail_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={v.thumbnail_url} alt="" style={{ width: "100%", height: "100%",
                                                             objectFit: "cover", display: "block" }} />
                )}
              </div>
              <div style={{ padding: "10px 12px 12px", display: "flex",
                            flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: 12.5, fontWeight: 600, lineHeight: 1.35,
                               display: "-webkit-box", WebkitLineClamp: 2,
                               WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                  {v.title || "Untitled"}
                </span>
                <span style={{ fontSize: 11, color: "var(--text-faint)" }}>
                  {compactCount(v.view_count)} views
                  {v.business_name ? ` · ${v.business_name}` : ""}
                </span>
              </div>
            </a>
          ))}
        </div>
      </div>
    </>
  );
}
