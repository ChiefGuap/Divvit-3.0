"use client";

/* Campaigns — ask guests for specific videos and reward them for delivering.
   Campaign cards read as editable objects, not report cards. */

import React from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/lib/icons";
import { campStats, campFunnel, campaigns } from "@/lib/data";
import { EASE, PurpleButton, TabPair, fadeUp } from "@/lib/ui";

export default function CampaignsPage() {
  const router = useRouter();

  return (
    <>
      <TabPair
        value="campaigns"
        onChange={(v) => v === "rewards" && router.push("/rewards")}
        style={{ alignSelf: "flex-start", animation: "dvFadeIn 0.4s ease backwards" }}
        options={[
          { value: "rewards", label: <><Icon name="gift" size={15} />Rewards</> },
          { value: "campaigns", label: <><Icon name="megaphone" size={15} />Campaigns</> },
        ]}
      />

      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap", ...fadeUp("0.05s", "0.5s") }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, letterSpacing: "-0.01em" }}>Campaigns</h1>
          <p style={{ margin: 0, color: "#6b7280", fontSize: 13.5 }}>
            Ask guests for the videos you want — and reward them when they deliver.
          </p>
        </div>
        <PurpleButton style={{ boxShadow: "0 6px 16px rgba(140,82,255,0.22)" }}>
          <Icon name="plus" size={16} />New campaign
        </PurpleButton>
      </div>

      {/* hero */}
      <div style={{
        position: "relative", overflow: "hidden", borderRadius: 24, padding: "26px 28px",
        color: "#fff", boxShadow: "0 18px 44px rgba(75,41,180,0.28)",
        display: "flex", flexDirection: "column", gap: 22, flex: "0 0 auto",
        background: `radial-gradient(120% 130% at 88% -20%, rgba(255,255,255,0.26) 0%, rgba(255,255,255,0.05) 42%, transparent 68%),
                     radial-gradient(90% 120% at 5% 110%, rgba(24,8,72,0.38) 0%, transparent 60%),
                     linear-gradient(135deg,#9a63ff 0%,#7a45f2 34%,#5c31c9 68%,#41208f 100%)`,
        ...fadeUp("0.08s", "0.5s"),
      }}>
        <div style={{ position: "relative", display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: 24 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: "0.1em", color: "rgba(255,255,255,0.72)" }}>CAMPAIGNS THIS MONTH</span>
            <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
              <span style={{ fontSize: 54, fontWeight: 800, letterSpacing: "-0.04em", lineHeight: 1 }}>47</span>
              <span style={{ fontSize: 15, fontWeight: 600, color: "rgba(255,255,255,0.82)" }}>videos from campaigns</span>
            </div>
            <span style={{ fontSize: 13.5, color: "rgba(255,255,255,0.78)", maxWidth: "40ch" }}>
              3 campaigns live · 1 scheduled. Guests you asked directly deliver about 4× more often than guests you don&apos;t.
            </span>
          </div>
          <div style={{
            display: "flex", alignItems: "center", gap: 12, padding: "14px 18px", borderRadius: 16,
            background: "rgba(255,255,255,0.14)", boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.22)",
          }}>
            <span style={{
              display: "flex", alignItems: "center", justifyContent: "center", width: 36, height: 36,
              borderRadius: 11, background: "rgba(255,255,255,0.9)", color: "#7a3ef0", flex: "0 0 auto",
            }}>
              <Icon name="trendUp" size={18} />
            </span>
            <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.07em", color: "rgba(255,255,255,0.7)" }}>BEST PERFORMER</span>
              <span style={{ fontSize: 14, fontWeight: 700 }}>Weekday dinner rush</span>
              <span style={{ fontSize: 12, color: "rgba(255,255,255,0.75)" }}>22 videos · 73% of target</span>
            </span>
          </div>
        </div>

        <div style={{ position: "relative", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(175px,1fr))", gap: 12 }}>
          {campStats.map((t) => (
            <div key={t.label} style={{
              display: "flex", flexDirection: "column", gap: 7, padding: "16px 18px", borderRadius: 16,
              background: "linear-gradient(180deg, rgba(255,255,255,0.20), rgba(255,255,255,0.09))",
              boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.26)",
            }}>
              <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.09em", textTransform: "uppercase", color: "rgba(255,255,255,0.78)" }}>{t.label}</span>
              <span style={{ fontSize: 38, fontWeight: 800, letterSpacing: "-0.04em", lineHeight: 1, textShadow: "0 2px 12px rgba(24,8,72,0.25)" }}>{t.value}</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: t.positive ? "#a9f5cf" : "rgba(255,255,255,0.68)" }}>{t.sub}</span>
            </div>
          ))}
        </div>

        <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <span style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: "0.08em", color: "rgba(255,255,255,0.7)" }}>REQUEST → VIDEO FUNNEL</span>
            <span style={{ flex: 1 }} />
            <span style={{ fontSize: 12, color: "rgba(255,255,255,0.72)" }}>412 asked → 47 delivered</span>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {campFunnel.map((f) => (
              <div key={f.label} style={{ flex: f.flex, display: "flex", flexDirection: "column", gap: 5 }}>
                <div style={{ height: 10, borderRadius: 99, background: f.bg }} />
                <span style={{ fontSize: 11.5, color: "rgba(255,255,255,0.78)" }}>
                  <b style={{ fontWeight: 700, color: "#fff" }}>{f.value}</b> {f.label}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "2px 2px 0", ...fadeUp("0.14s", "0.5s") }}>
        <span style={{ fontWeight: 600, fontSize: 14.5 }}>All campaigns</span>
        <span style={{ fontSize: 11.5, fontWeight: 600, color: "#8c52ff", background: "rgba(140,82,255,0.1)", borderRadius: 99, padding: "3px 9px" }}>{campaigns.length}</span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 16, paddingBottom: 8 }}>
        {campaigns.map((c) => (
          <div key={c.id} className="cardLift" style={{
            background: "#fff", borderRadius: 16, padding: 20, display: "flex",
            flexDirection: "column", gap: 14, cursor: "pointer",
            boxShadow: "0 0 0 1px rgba(17,24,39,0.07), 0 2px 6px rgba(58,32,137,0.05)",
            animation: `dvFadeUp 0.55s ${c.delay} ${EASE} backwards`,
          }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <span style={{
                display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 700,
                letterSpacing: "0.05em", textTransform: "uppercase",
                color: c.statusFg, background: c.statusBg, borderRadius: 99, padding: "4px 11px",
              }}>{c.status}</span>
              <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 12.5, color: "#9ca3af" }}>{c.dates}</span>
                <span className="hoverPurple" style={{ display: "flex", color: "#c9c4d8" }} title="Edit campaign">
                  <Icon name="settings" size={14} />
                </span>
              </span>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: "-0.01em" }}>{c.title}</span>
              <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: "#6b7280" }}>{c.ask}</p>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 9, background: "#faf9fd", border: "1px solid #eee7fb", borderRadius: 10, padding: "9px 12px" }}>
              <Icon name="gift" size={15} color="#f59512" />
              <span style={{ fontSize: 12.5, fontWeight: 600, color: "#4b5563" }}>{c.reward}</span>
              <span style={{ flex: 1 }} />
              <span style={{ fontSize: 12, color: "#9ca3af" }}>{c.audience}</span>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5 }}>
                <span style={{ color: "#6b7280" }}>{c.progressLabel}</span>
                <span style={{ fontWeight: 600, color: c.barColor }}>{c.pct}</span>
              </div>
              <div style={{ height: 7, borderRadius: 99, background: "#f1f1f6", overflow: "hidden" }}>
                <div style={{
                  height: "100%", borderRadius: 99, background: c.barColor, width: c.pct,
                  animation: `dvGrowBar 0.9s ${c.delay} ${EASE} backwards`,
                }} />
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 22, borderTop: "1px solid #f1eff8", paddingTop: 13, marginTop: "auto" }}>
              {([["Requests sent", c.sent], ["Claimed", c.claimed], ["Videos in", c.videos]] as const).map(([label, value]) => (
                <div key={label} style={{ display: "flex", flexDirection: "column" }}>
                  <span style={{ fontSize: 15, fontWeight: 700, letterSpacing: "-0.01em" }}>{value}</span>
                  <span style={{ fontSize: 11.5, color: "#9ca3af" }}>{label}</span>
                </div>
              ))}
              <span style={{ flex: 1 }} />
              <button onClick={() => router.push("/collection")} className="btnQuiet" style={{ padding: "8px 14px", borderRadius: 9 }}>{c.cta}</button>
            </div>
          </div>
        ))}

        {/* suggested campaign — iridescent, slow chrome sweep */}
        <div style={{
          position: "relative", overflow: "hidden", borderRadius: 16,
          border: "1px solid rgba(140,82,255,0.3)", padding: 20,
          display: "flex", flexDirection: "column", gap: 12,
          background: "linear-gradient(120deg, rgba(140,82,255,0.14), rgba(224,231,255,0.55) 30%, rgba(255,214,245,0.4) 55%, rgba(140,82,255,0.18) 80%, rgba(140,82,255,0.14))",
          animation: `dvFadeUp 0.55s 0.5s ${EASE} backwards`,
        }}>
          <div style={{
            position: "absolute", inset: 0, pointerEvents: "none",
            background: "linear-gradient(105deg, transparent 20%, rgba(255,255,255,0.65) 45%, rgba(200,170,255,0.35) 55%, transparent 75%)",
            backgroundSize: "250% 100%", animation: "dvChrome 9s linear infinite",
          }} />
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Icon name="sparkle" size={15} color="#8c52ff" />
            <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.05em", color: "#8c52ff" }}>SUGGESTED CAMPAIGN</span>
          </div>
          <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: "-0.01em" }}>Signature dish close-ups</span>
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55, color: "#4b5563" }}>
            Food close-ups outperform interior shots 3-to-1 this month. Ask your Tuesday regulars for one 20-second dish shot and offer a dessert on the house.
          </p>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {["Est. 18 videos", "~$120 in rewards"].map((t) => (
              <span key={t} style={{ fontSize: 11.5, fontWeight: 600, color: "#8c52ff", background: "rgba(140,82,255,0.1)", borderRadius: 99, padding: "3px 10px" }}>{t}</span>
            ))}
          </div>
          <button className="btnPurple" style={{ alignSelf: "flex-start", marginTop: "auto", padding: "9px 15px", borderRadius: 9, fontSize: 12.5 }}>
            Create this campaign
          </button>
        </div>
      </div>
    </>
  );
}
