"use client";

/* Organic Brand Health — the full report behind the Discover score.
   Animated score, weighted aspect breakdown, a score/metrics tab pair, a metric
   chart with a selector, and recommended actions with estimated point impact. */

import React from "react";
import { Icon, type IconName } from "@/lib/icons";
import { BH_SCORE, bhAspects, bhActions } from "@/lib/data";
import { EASE, TabPair, fadeUp, useCountUp } from "@/lib/ui";

const SERIES: Record<string, { label: string; note: string; unit: string; points: number[] }> = {
  score: { label: "Brand health score", note: "Weekly, last 12 weeks", unit: "", points: [61, 63, 64, 68, 67, 71, 73, 74, 77, 79, 81, 83] },
  videos: { label: "Videos from guests", note: "Weekly, last 12 weeks", unit: "", points: [4, 6, 5, 9, 8, 11, 13, 12, 16, 15, 19, 22] },
  mentions: { label: "Social mentions", note: "Weekly, last 12 weeks", unit: "", points: [22, 26, 31, 29, 38, 42, 47, 44, 58, 63, 71, 84] },
  impressions: { label: "Organic impressions", note: "Weekly, last 12 weeks · thousands", unit: "K", points: [12, 15, 14, 22, 26, 31, 34, 33, 46, 52, 61, 78] },
};

export default function BrandHealthPage() {
  const [tab, setTab] = React.useState<"score" | "metrics">("score");
  const [metric, setMetric] = React.useState<keyof typeof SERIES>("score");
  const score = useCountUp(BH_SCORE, 1100);

  const s = SERIES[metric];
  const max = Math.max(...s.points);
  const latest = s.points[s.points.length - 1];
  const prev = s.points[s.points.length - 2];
  const delta = Math.round(((latest - prev) / prev) * 100);

  return (
    <>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap", ...fadeUp("0.05s", "0.5s") }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, letterSpacing: "-0.01em" }}>Organic Brand Health</h1>
          <p style={{ margin: 0, color: "#6b7280", fontSize: 13.5 }}>
            One number for how much word of mouth you have, and what moves it.
          </p>
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
                <span style={{ fontSize: 12.5, fontWeight: 700, color: "#4b29b4", background: "#fff", borderRadius: 99, padding: "4px 13px" }}>Strong</span>
                <span style={{ fontSize: 12.5, fontWeight: 600, color: "rgba(255,255,255,0.86)" }}>+4 this month · best stretch this quarter</span>
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
                    <span style={{ fontSize: 14, fontWeight: 800, letterSpacing: "-0.02em", minWidth: 34, textAlign: "right" }}>{a.score}</span>
                  </div>
                  <span style={{ height: 6, borderRadius: 99, background: "rgba(255,255,255,0.24)", overflow: "hidden" }}>
                    <span style={{ display: "block", height: "100%", width: `${a.score}%`, borderRadius: 99, background: "#fff" }} />
                  </span>
                  <span style={{ fontSize: 11.5, color: "rgba(255,255,255,0.7)" }}>{a.note} · contributes {a.pts} pts</span>
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
          background: "#fff", borderRadius: 18, padding: "20px 22px", display: "flex",
          flexDirection: "column", gap: 18, flex: "0 0 auto", marginBottom: 8,
          boxShadow: "0 0 0 1px rgba(17,24,39,0.07), 0 6px 20px rgba(58,32,137,0.05)",
          ...fadeUp("0.07s", "0.5s"),
        }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", justifyContent: "space-between", gap: 14 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              <span style={{ fontSize: 14.5, fontWeight: 600 }}>{s.label}</span>
              <span style={{ fontSize: 12.5, color: "#9ca3af" }}>{s.note}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <select value={metric} onChange={(e) => setMetric(e.target.value as keyof typeof SERIES)}
                aria-label="Choose metric"
                style={{
                  padding: "8px 12px", borderRadius: 10, border: "none", background: "#f5f5f9",
                  boxShadow: "inset 0 0 0 1px rgba(17,24,39,0.08)", fontFamily: "inherit",
                  fontSize: 13, fontWeight: 600, color: "#4b5563", cursor: "pointer",
                }}>
                {Object.entries(SERIES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
                <span style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.03em", lineHeight: 1 }}>{latest}{s.unit}</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: delta >= 0 ? "#16a06b" : "#b9700a" }}>
                  {delta >= 0 ? "+" : ""}{delta}% vs last week
                </span>
              </div>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 180 }}>
            {s.points.map((p, i) => (
              <span key={i} title={`${p}${s.unit}`} style={{
                flex: 1, height: `${Math.max(6, (p / max) * 100)}%`,
                borderRadius: "5px 5px 3px 3px",
                background: i === s.points.length - 1 ? "#6346cd" : "#b79aff",
                animation: `dvGrowBar 0.7s ${(0.03 * i).toFixed(2)}s ${EASE} backwards`,
                transition: "height 0.5s cubic-bezier(0.16,1,0.3,1), background 0.3s ease",
              }} />
            ))}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, color: "#c9c4d8" }}>
            <span>12 weeks ago</span><span>6 weeks ago</span><span>This week</span>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px,1fr))", gap: 14, paddingTop: 4, borderTop: "1px solid #f1eff8" }}>
            {bhAspects.map((a) => (
              <div key={a.label} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ fontSize: 11.5, color: "#6b7280" }}>{a.label}</span>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                  <span style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-0.03em", color: a.barColor }}>{a.score}</span>
                  <span style={{ fontSize: 11.5, color: "#9ca3af" }}>weight {a.weight}</span>
                </div>
                <span style={{ height: 6, borderRadius: 99, background: "#f1f1f6", overflow: "hidden" }}>
                  <span style={{ display: "block", height: "100%", width: `${a.score}%`, borderRadius: 99, background: a.barColor }} />
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
