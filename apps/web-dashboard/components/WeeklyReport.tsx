"use client";

/* Weekly report modal — stepped reveal of the week's numbers, opened from the
   header. Each block fades up on its own beat rather than all at once. */

import React from "react";
import { useRouter } from "next/navigation";
import { Icon, type IconName } from "@/lib/icons";
import { EASE } from "@/lib/ui";

const METRICS: { label: string; value: string; note: string; icon: IconName }[] = [
  { label: "Videos from guests", value: "47", note: "+12 vs last week", icon: "video" },
  { label: "Views earned", value: "128K", note: "creator pages + yours", icon: "eye" },
  { label: "New creators", value: "7", note: "first time filming for you", icon: "users" },
  { label: "Rewards claimed", value: "31", note: "$840 in value issued", icon: "gift" },
];

export function WeeklyReport({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [step, setStep] = React.useState(0);

  React.useEffect(() => {
    const t = setInterval(() => setStep((s) => (s >= 5 ? (clearInterval(t), s) : s + 1)), 620);
    return () => clearInterval(t);
  }, []);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const reveal = (at: number) => ({
    opacity: step >= at ? 1 : 0,
    transform: step >= at ? "translateY(0)" : "translateY(10px)",
    transition: `opacity 0.5s ease, transform 0.5s ${EASE}`,
  });

  return (
    <div onClick={onClose} role="dialog" aria-modal aria-label="This week's report" style={{
      position: "absolute", inset: 0, zIndex: 80, display: "flex",
      alignItems: "center", justifyContent: "center", padding: 32,
      background: "rgba(17,24,39,0.34)", backdropFilter: "blur(6px)",
      WebkitBackdropFilter: "blur(6px)", animation: "dvFadeIn 0.25s ease",
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: "100%", maxWidth: 780, maxHeight: "100%", overflowY: "auto",
        borderRadius: 26, padding: "34px 36px 28px",
        background: "linear-gradient(160deg, rgba(255,255,255,0.94), rgba(255,255,255,0.86))",
        backdropFilter: "blur(28px) saturate(160%)", WebkitBackdropFilter: "blur(28px) saturate(160%)",
        boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.8), 0 30px 80px rgba(40,22,89,0.32)",
        display: "flex", flexDirection: "column", gap: 26,
        animation: `dvPop 0.4s ${EASE}`,
      }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: "0.09em", color: "#8c52ff" }}>
              THIS WEEK · ORGANIC BRAND HEALTH
            </span>
            <h2 style={{ margin: 0, fontSize: 24, fontWeight: 700, letterSpacing: "-0.02em" }}>
              People are talking about you.
            </h2>
          </div>
          <button onClick={onClose} className="hoverInk" aria-label="Close"
            style={{ display: "flex", color: "#9ca3af", marginTop: 4 }}>
            <Icon name="x" size={18} />
          </button>
        </div>

        <div style={{
          display: "flex", alignItems: "center", gap: 22, padding: "22px 24px", borderRadius: 20,
          background: "linear-gradient(135deg, #8c52ff, #6346cd)", color: "#fff",
          boxShadow: "0 14px 34px rgba(140,82,255,0.28)",
          opacity: step >= 1 ? 1 : 0, transition: "opacity 0.5s ease",
        }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ fontSize: 56, fontWeight: 800, letterSpacing: "-0.04em", lineHeight: 1 }}>83</span>
            <span style={{ fontSize: 15, fontWeight: 600, color: "rgba(255,255,255,0.75)" }}>/ 100</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <span style={{ fontSize: 15, fontWeight: 600 }}>Word of mouth score</span>
            <span style={{ fontSize: 13, color: "rgba(255,255,255,0.8)" }}>
              Up 4 points since last week — your best stretch this quarter.
            </span>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 14 }}>
          {METRICS.map((m, i) => (
            <div key={m.label} style={{
              display: "flex", flexDirection: "column", gap: 12, padding: "18px 20px",
              borderRadius: 18, background: "rgba(255,255,255,0.66)",
              boxShadow: "inset 0 0 0 1px rgba(17,24,39,0.06)", ...reveal(2 + Math.floor(i / 2)),
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{
                  display: "flex", alignItems: "center", justifyContent: "center",
                  width: 30, height: 30, borderRadius: 10, color: "#8c52ff",
                  background: "rgba(140,82,255,0.10)", flex: "0 0 auto",
                }}>
                  <Icon name={m.icon} size={15} />
                </span>
                <span style={{ fontSize: 12.5, fontWeight: 600, color: "#6b7280" }}>{m.label}</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                <span style={{ fontSize: 30, fontWeight: 800, letterSpacing: "-0.035em", lineHeight: 1 }}>{m.value}</span>
                <span style={{ fontSize: 12.5, color: "#9ca3af" }}>{m.note}</span>
              </div>
            </div>
          ))}
        </div>

        <div style={{
          display: "flex", flexDirection: "column", gap: 12, padding: "20px 22px",
          borderRadius: 18, background: "rgba(140,82,255,0.07)", ...reveal(4),
        }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 11 }}>
            <Icon name="radar" size={16} color="#8c52ff" style={{ alignSelf: "center" }} />
            <span style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.03em", color: "#7a3ef0" }}>66%</span>
            <span style={{ fontSize: 13, color: "#4b5563" }}>of everything you posted came in through Divvit</span>
          </div>
          <div style={{ height: 8, borderRadius: 99, background: "rgba(140,82,255,0.16)", overflow: "hidden" }}>
            <div style={{
              height: "100%", width: step >= 4 ? "66%" : "0%", borderRadius: 99,
              background: "linear-gradient(90deg,#9a63ff,#7a3ef0)",
              transition: `width 0.9s ${EASE}`,
            }} />
          </div>
        </div>

        <div style={{ display: "flex", gap: 13, padding: 20, borderRadius: 18, background: "rgba(22,160,107,0.08)", ...reveal(5) }}>
          <Icon name="message" size={17} color="#16a06b" style={{ marginTop: 2 }} />
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <span style={{ fontSize: 14, lineHeight: 1.5, fontWeight: 500 }}>
              “Ask for Priya. She remembered our anniversary from last year and comped the dessert.”
            </span>
            <span style={{ fontSize: 12, color: "#6b7280" }}>
              TikTok comment · 1.2K likes · shared 46 times · your most repeated comment this week
            </span>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <button className="btnPurple" onClick={() => { onClose(); router.push("/discover/brand-health"); }}
            style={{ padding: "11px 20px", borderRadius: 11, fontSize: 13.5, boxShadow: "0 8px 20px rgba(140,82,255,0.26)" }}>
            Open the full report
          </button>
          <button onClick={onClose} className="hoverInk" style={{
            padding: "11px 18px", borderRadius: 11, background: "rgba(17,24,39,0.05)",
            color: "#4b5563", fontSize: 13.5, fontWeight: 600,
          }}>Not now</button>
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 12, color: "#9ca3af" }}>Fresh every Monday</span>
        </div>
      </div>
    </div>
  );
}
