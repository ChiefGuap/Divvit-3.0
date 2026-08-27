"use client";

/* Organic Brand Health — the full report behind the Discover score.
   Animated score, weighted aspect breakdown, a score/metrics tab pair, a metric
   chart with a selector, and recommended actions with estimated point impact. */

import React from "react";
import { Icon, type IconName } from "@/lib/icons";
import type { BrandHealthView as ViewData } from "./types";
import { EASE, TabPair, fadeUp, useCountUp } from "@/lib/ui";

export default function BrandHealthView({ data }: { data: ViewData }) {
  const { score: BH_SCORE, aspects: bhAspects, actions: bhActions, venue } = data;
  const [tab, setTab] = React.useState<"score" | "metrics">("score");
  const score = useCountUp(BH_SCORE ?? 0, 1100);


  return (
    <>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap", ...fadeUp("0.05s", "0.5s") }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, letterSpacing: "-0.01em" }}>Organic Brand Health</h1>
          <p style={{ margin: 0, color: "#6b7280", fontSize: 13.5 }}>
            One number for how much word of mouth you have, and what moves it.
          </p>
          {/* Say which venue this is and how much of the model was actually
              observed. A score whose confidence is "medium" because a quarter
              of it is unmeasured should not look like a score that isn't. */}
          {venue && (
            <p style={{ margin: "2px 0 0", color: "#6b7280", fontSize: 12.5 }}>
              <strong style={{ color: "#111827" }}>{venue.name}</strong>
              {venue.city ? ` · ${venue.city}` : ""}
              {" · "}
              {data.confidence} confidence
              {data.coverage !== null ? ` · ${Math.round(data.coverage * 100)}% of the model measured` : ""}
              {data.cohortSize ? ` · ranked against ${data.cohortSize} OC independents` : ""}
            </p>
          )}
        </div>
        <TabPair value={tab} onChange={(v) => setTab(v as "score" | "metrics")}
          options={[{ value: "score", label: "Score" }, { value: "metrics", label: "Metrics" }]} />
      </div>

      {tab === "score" ? (
        <>
          <div style={{
            position: "relative", overflow: "hidden", borderRadius: 26, padding: "30px 32px",
            color: "#fff", boxShadow: "0 20px 48px rgba(75,41,180,0.28)",
            display: "flex", flexWrap: "wrap", gap: 40, alignItems: "center", flex: "0 0 auto",
            background: "linear-gradient(116deg, #3f1f9e 0%, #6f3bea 32%, #8c52ff 60%, #b287ff 100%)",
            ...fadeUp("0.07s", "0.5s"),
          }}>
            <span style={{
              position: "absolute", inset: 0, pointerEvents: "none",
              background: "linear-gradient(205deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0) 44%)",
            }} />
            <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: 12, minWidth: 240 }}>
              <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.11em", color: "rgba(255,255,255,0.74)" }}>WORD OF MOUTH SCORE</span>
              <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
                <span style={{ fontSize: 88, fontWeight: 800, letterSpacing: "-0.05em", lineHeight: 1 }}>{score}</span>
                <span style={{ fontSize: 16, color: "rgba(255,255,255,0.72)", fontWeight: 600 }}>/ 100</span>
              </div>
              <div style={{ height: 8, borderRadius: 99, background: "rgba(255,255,255,0.22)", overflow: "hidden", maxWidth: 300 }}>
                <div style={{ height: "100%", width: `${score}%`, borderRadius: 99, background: "#fff", transition: `width 0.6s ${EASE}` }} />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: "#4b29b4", background: "#fff", borderRadius: 99, padding: "4px 13px" }}>
                  {BH_SCORE === null ? "Unscored" : BH_SCORE >= 80 ? "Strong" : BH_SCORE >= 60 ? "Healthy" : "Needs work"}
                </span>
                {/* No month-over-month claim: one snapshot exists per venue, so
                    a delta would be invented. It appears once history does. */}
                <span style={{ fontSize: 12.5, fontWeight: 600, color: "rgba(255,255,255,0.86)" }}>
                  Percentile-ranked against measured OC independents
                </span>
              </div>
            </div>

            <div style={{ position: "relative", background: "rgba(255,255,255,0.22)", alignSelf: "stretch", width: 1, minHeight: 160 }} />

            <div style={{ position: "relative", flex: 1, minWidth: 340, display: "flex", flexDirection: "column", gap: 14 }}>
              <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.11em", color: "rgba(255,255,255,0.7)" }}>HOW IT IS WEIGHTED</span>
              {bhAspects.map((a) => (
                <div key={a.label} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                    <span style={{ fontSize: 12.5, color: "rgba(255,255,255,0.9)", flex: 1, minWidth: 0 }}>{a.label}</span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.6)" }}>{a.weight}</span>
                    <span style={{ fontSize: 14, fontWeight: 800, letterSpacing: "-0.02em", minWidth: 34, textAlign: "right" }}>
                      {a.score === null ? "—" : Math.round(a.score)}
                    </span>
                  </div>
                  {/* An unmeasured component draws no bar. A zero-width bar and
                      a zero score look identical, and they are not the same claim. */}
                  <span style={{ height: 6, borderRadius: 99, background: "rgba(255,255,255,0.24)", overflow: "hidden" }}>
                    {a.score !== null && (
                      <span style={{ display: "block", height: "100%", width: `${a.score}%`, borderRadius: 99, background: "#fff" }} />
                    )}
                  </span>
                  <span style={{ fontSize: 11.5, color: "rgba(255,255,255,0.7)" }}>
                    {a.note}{a.score === null ? " · not counted" : ` · contributes ${a.pts} pts`}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* recommended actions with estimated point impact */}
          <div style={{
            background: "#fff", borderRadius: 18, padding: "20px 22px", display: "flex",
            flexDirection: "column", gap: 14, flex: "0 0 auto", marginBottom: 8,
            boxShadow: "0 0 0 1px rgba(17,24,39,0.07), 0 6px 20px rgba(58,32,137,0.05)",
            ...fadeUp("0.14s", "0.5s"),
          }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              <span style={{ fontSize: 14.5, fontWeight: 700 }}>What would move it most</span>
              <span style={{ fontSize: 12.5, color: "#9ca3af" }}>Ranked by estimated point impact on your weakest aspects</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px,1fr))", gap: 12 }}>
              {bhActions.map((a, i) => (
                <div key={a.title} style={{
                  display: "flex", gap: 13, padding: "16px 18px", borderRadius: 14,
                  background: "#faf9fd", boxShadow: "inset 0 0 0 1px rgba(17,24,39,0.05)",
                  animation: `dvFadeUp 0.45s ${(0.05 * i).toFixed(2)}s ${EASE} backwards`,
                }}>
                  <span style={{
                    display: "flex", alignItems: "center", justifyContent: "center", width: 34, height: 34,
                    borderRadius: 11, flex: "0 0 auto", color: a.color, background: a.tileBg,
                  }}>
                    <Icon name={a.iconKey as IconName} size={17} />
                  </span>
                  <div style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 700 }}>{a.title}</span>
                    <span style={{ fontSize: 12.5, lineHeight: 1.5, color: "#6b7280" }}>{a.desc}</span>
                    <span style={{
                      alignSelf: "flex-start", fontSize: 11.5, fontWeight: 700, color: "#0d7a4f",
                      background: "rgba(22,160,107,0.11)", borderRadius: 99, padding: "3px 10px", marginTop: 2,
                    }}>{a.impact}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      ) : (
        <div style={{
          background: "#fff", borderRadius: 18, padding: "26px 24px",
          display: "flex", flexDirection: "column", gap: 16,
          boxShadow: "0 0 0 1px rgba(17,24,39,0.07), 0 6px 20px rgba(58,32,137,0.05)",
          ...fadeUp("0.05s", "0.5s"),
        }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <span style={{ fontSize: 14.5, fontWeight: 700 }}>Score over time</span>
            <span style={{ fontSize: 12.5, color: "#6b7280" }}>
              {data.series.length < 2
                ? "One measurement so far — a trend appears once this venue has been measured twice."
                : `${data.series.length} measurement runs, oldest first. Points are runs, not weeks.`}
            </span>
          </div>

          {data.series.length >= 2 ? (
            <>
              <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 150 }}>
                {data.series.map((pt, i) => {
                  const lo = Math.min(...data.series.map((p) => p.score));
                  const hi = Math.max(...data.series.map((p) => p.score));
                  // A flat series must not collapse to zero-height bars.
                  const span = hi - lo || 1;
                  const h = 26 + ((pt.score - lo) / span) * 104;
                  const last = i === data.series.length - 1;
                  return (
                    <div key={pt.at + i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: last ? "#4b29b4" : "#9ca3af" }}>
                        {pt.score.toFixed(1)}
                      </span>
                      <span style={{
                        width: "100%", maxWidth: 46, height: h, borderRadius: 8,
                        background: last ? "#6346cd" : "#b79aff",
                        animation: `dvGrowBar 0.7s ${(0.04 * i).toFixed(2)}s ${EASE} backwards`,
                      }} />
                    </div>
                  );
                })}
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, color: "#9ca3af" }}>
                <span>{new Date(data.series[0].at).toLocaleString()}</span>
                <span>{new Date(data.series[data.series.length - 1].at).toLocaleString()}</span>
              </div>
            </>
          ) : (
            <p style={{ margin: 0, color: "#6b7280", fontSize: 13.5, lineHeight: 1.6, maxWidth: 560 }}>
              Brand Health is stored as an append-only series. Re-run{" "}
              <code>services.venues.cli metrics</code> and <code>health</code> to add a point.
            </p>
          )}
        </div>
      )}
    </>
  );
}
