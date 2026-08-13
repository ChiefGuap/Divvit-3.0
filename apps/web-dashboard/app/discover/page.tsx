"use client";

/* Discover — what the internet is saying, and what Divvit changed.
   Entry runs a scan that resolves into a found-count, then the score band,
   the three feedback groups, and the impact block. */

import React from "react";
import { Icon, type IconName } from "@/lib/icons";
import { BH_SCORE, bhAspects, discVideos } from "@/lib/data";
import { EASE, QuietButton, fadeUp, useCountUp } from "@/lib/ui";

const SCAN_STEPS = [
  { label: "TikTok", note: "hashtags, geotags, mentions", icon: "tiktok" as IconName },
  { label: "Instagram", note: "tagged posts and reels", icon: "instagram" as IconName },
  { label: "Comments", note: "reading every reply", icon: "message" as IconName },
  { label: "Sentiment", note: "sorting good from bad", icon: "pulse" as IconName },
];

type FeedbackTab = "keep" | "fix" | "said";

const WORKING = [
  { label: "Your patio", value: "38 mentions", note: "People keep filming the golden-hour tables. It is the single most repeated visual in your content." },
  { label: "Staff by name", value: "21 mentions", note: "Priya and Marco get named directly. Guests remember people, not menus." },
  { label: "The pasta", value: "34 mentions", note: "Called “best in the city” four separate times this month." },
];

const FIXING = [
  { label: "Wait times", value: "12 mentions", note: "Friday between 7 and 8 comes up repeatedly. Nobody is angry — but it is the one repeated gripe." },
  { label: "Dessert menu", value: "9 mentions", note: "Several first-timers asked for more options. Two said they would have stayed longer." },
  { label: "Music volume", value: "5 mentions", note: "Mentioned on late weekend nights only. Low signal, easy fix." },
];

const COMMENTS = [
  { who: "@sofiaeats", platform: "tiktok" as IconName, sent: "pos", quote: "The truffle pasta genuinely changed my week. Ask for the patio.", eng: "1.2K likes · 46 shares", topic: "Dish", rec: "Pin this to your profile and reply publicly — it is your highest-shared comment this month." },
  { who: "@jameseatsla", platform: "instagram" as IconName, sent: "pos", quote: "Priya remembered our anniversary from last year. Who does that?", eng: "840 likes · 22 shares", topic: "Staff", rec: "Share this to your story and tag Priya. Staff recognition drives repeat visits more than discounts." },
  { who: "@nicoeats", platform: "tiktok" as IconName, sent: "neg", quote: "Food was unreal but we waited 40 min on a Friday with a booking.", eng: "310 likes · 8 shares", topic: "Wait times", rec: "Reply acknowledging it and mention your new Friday seating window. Visible responses cut repeat complaints." },
  { who: "@priyaeats", platform: "instagram" as IconName, sent: "pos", quote: "Date night sorted. The room at 6pm is unmatched.", eng: "620 likes · 19 shares", topic: "Interior", rec: "This is your best interior quote — use it as the caption on your next Editor cut." },
  { who: "@marcobites", platform: "tiktok" as IconName, sent: "neg", quote: "Wish there were more than two desserts honestly.", eng: "180 likes · 4 shares", topic: "Menu", rec: "Third mention this month. Worth a seasonal dessert test — then ask these creators back." },
  { who: "@mayacooks", platform: "instagram" as IconName, sent: "pos", quote: "Went for coffee, stayed three hours. No one rushed us.", eng: "540 likes · 31 shares", topic: "Service", rec: "Turn this into a campaign ask: “film your slow afternoon here”." },
];

export default function DiscoverPage() {
  const [scanning, setScanning] = React.useState(true);
  const [step, setStep] = React.useState(0);
  const [platform, setPlatform] = React.useState<"all" | "tiktok" | "instagram">("all");
  const [tab, setTab] = React.useState<FeedbackTab>("keep");
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});

  const score = useCountUp(BH_SCORE, 1100, !scanning);

  const runScan = React.useCallback(() => {
    setScanning(true);
    setStep(0);
    const t = setInterval(() => {
      setStep((s) => {
        if (s >= SCAN_STEPS.length) { clearInterval(t); setScanning(false); return s; }
        return s + 1;
      });
    }, 620);
    return () => clearInterval(t);
  }, []);

  React.useEffect(() => runScan(), [runScan]);

  const filtered = COMMENTS.filter((c) =>
    platform === "all" || (platform === "tiktok" ? c.platform === "tiktok" : c.platform === "instagram"));

  const posShare = Math.round((COMMENTS.filter((c) => c.sent === "pos").length / COMMENTS.length) * 100);
  const found = discVideos.length;

  if (scanning) {
    const pct = Math.round((step / SCAN_STEPS.length) * 100);
    return (
      <div style={{
        position: "absolute", inset: 0, zIndex: 40, display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center", gap: 30, padding: 40,
        background: "linear-gradient(180deg,#faf8ff,#f3eeff)", animation: "dvFadeIn 0.25s ease",
      }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
          <span style={{
            display: "flex", alignItems: "center", justifyContent: "center", width: 56, height: 56,
            borderRadius: 18, color: "#fff", background: "linear-gradient(135deg,#9a63ff,#6f3bea)",
            boxShadow: "0 10px 26px rgba(122,62,240,0.32)",
          }}>
            <span style={{ display: "flex", animation: "dvSpin 3.4s linear infinite" }}><Icon name="radar" size={27} /></span>
          </span>
          <span style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.025em" }}>Reading the internet about you</span>
          <span style={{ fontSize: 13.5, color: "#6b7280" }}>Two sources · last 30 days · this usually takes a few seconds.</span>
        </div>

        <div style={{ width: "100%", maxWidth: 520, display: "flex", flexDirection: "column", gap: 10 }}>
          {SCAN_STEPS.map((s, i) => {
            const done = step > i;
            const active = step === i;
            return (
              <div key={s.label} style={{
                display: "flex", alignItems: "center", gap: 14, padding: "15px 18px", borderRadius: 16,
                background: done || active ? "#ffffff" : "rgba(255,255,255,0.5)",
                boxShadow: active ? "0 0 0 1.5px rgba(140,82,255,0.45)" : "0 0 0 1px rgba(17,24,39,0.06)",
                opacity: done || active ? 1 : 0.55,
                transition: "opacity 0.35s ease, background 0.35s ease, box-shadow 0.35s ease",
              }}>
                <span style={{
                  display: "flex", alignItems: "center", justifyContent: "center", width: 28, height: 28,
                  borderRadius: "50%", flex: "0 0 auto",
                  color: done ? "#fff" : "#8c52ff",
                  background: done ? "#16a06b" : "rgba(140,82,255,0.12)",
                }}>
                  <Icon name={done ? "check" : s.icon} size={15} />
                </span>
                <span style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 14, fontWeight: done || active ? 700 : 500 }}>{s.label}</span>
                  <span style={{ fontSize: 12, color: "#9ca3af" }}>{s.note}</span>
                </span>
                <span style={{ fontSize: 12, fontWeight: 700, color: done ? "#16a06b" : "#c9c4d8", flex: "0 0 auto" }}>
                  {done ? "Done" : active ? "Reading…" : "Waiting"}
                </span>
              </div>
            );
          })}
        </div>

        <div style={{ width: "100%", maxWidth: 520, display: "flex", flexDirection: "column", gap: 7 }}>
          <div style={{ height: 6, borderRadius: 99, background: "rgba(140,82,255,0.16)", overflow: "hidden" }}>
            <div style={{ height: "100%", borderRadius: 99, width: `${pct}%`, background: "linear-gradient(90deg,#9a63ff,#6f3bea)", transition: `width 0.5s ${EASE}` }} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, color: "#9ca3af" }}>
            <span>Found {Math.round((step / SCAN_STEPS.length) * found)} posts so far</span><span>{pct}%</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap", ...fadeUp("0.05s", "0.5s") }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, letterSpacing: "-0.01em" }}>Discover</h1>
          <p style={{ margin: 0, color: "#6b7280", fontSize: 13.5 }}>
            We read your social pages and every comment so you don&apos;t have to. Here&apos;s the last 30 days.
          </p>
        </div>
        <QuietButton onClick={runScan}><Icon name="radar" size={16} />Refresh the read</QuietButton>
      </div>

      {/* score band — gradient, no circular gauge, metrics dominant */}
      <div style={{
        position: "relative", overflow: "hidden", borderRadius: 26, padding: "28px 32px",
        color: "#fff", boxShadow: "0 20px 48px rgba(75,41,180,0.28)",
        display: "flex", flexWrap: "wrap", gap: 34, alignItems: "center", flex: "0 0 auto",
        background: "linear-gradient(116deg, #3f1f9e 0%, #6f3bea 32%, #8c52ff 60%, #b287ff 100%)",
        ...fadeUp("0.07s", "0.5s"),
      }}>
        <span style={{
          position: "absolute", inset: 0, pointerEvents: "none",
          background: "linear-gradient(205deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0) 44%), linear-gradient(20deg, rgba(20,6,60,0.28) 0%, rgba(20,6,60,0) 52%)",
        }} />
        <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: 12, minWidth: 200 }}>
          <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.11em", color: "rgba(255,255,255,0.74)" }}>ORGANIC BRAND SCORE</span>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <span style={{ fontSize: 76, fontWeight: 800, letterSpacing: "-0.05em", lineHeight: 1 }}>{score}</span>
            <span style={{ fontSize: 15, color: "rgba(255,255,255,0.72)", fontWeight: 600 }}>out of 100</span>
          </div>
          <div style={{ height: 8, borderRadius: 99, background: "rgba(255,255,255,0.22)", overflow: "hidden", maxWidth: 260 }}>
            <div style={{ height: "100%", width: `${score}%`, borderRadius: 99, background: "#fff", transition: `width 0.6s ${EASE}` }} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: "#4b29b4", background: "#fff", borderRadius: 99, padding: "4px 13px" }}>Strong</span>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: "rgba(255,255,255,0.86)" }}>+4 this month</span>
          </div>
        </div>

        <div style={{ position: "relative", background: "rgba(255,255,255,0.22)", alignSelf: "stretch", width: 1, minHeight: 150 }} />

        <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: 20, minWidth: 340, flex: 1 }}>
          <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.11em", color: "rgba(255,255,255,0.7)" }}>EARNED ATTENTION · LAST 30 DAYS</span>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(148px,1fr))", gap: 18 }}>
            {[["312K", "organic impressions"], ["214", "mentions"], [`${found}`, "posts found"], ["29", "creators talking"]].map(([v, l]) => (
              <div key={l} style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
                <span style={{ fontSize: 42, fontWeight: 800, letterSpacing: "-0.045em", lineHeight: 1 }}>{v}</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.82)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{l}</span>
              </div>
            ))}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px,1fr))", gap: "10px 24px", paddingTop: 4, borderTop: "1px solid rgba(255,255,255,0.2)" }}>
            {bhAspects.map((a) => (
              <div key={a.label} style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 0, paddingTop: 10 }}>
                <span style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
                  <span style={{ fontSize: 12, color: "rgba(255,255,255,0.8)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.label}</span>
                  <span style={{ fontSize: 13, fontWeight: 800, letterSpacing: "-0.02em", flex: "0 0 auto" }}>{a.score}</span>
                </span>
                <span style={{ height: 5, borderRadius: 99, background: "rgba(255,255,255,0.24)", overflow: "hidden" }}>
                  <span style={{ display: "block", height: "100%", width: `${a.score}%`, borderRadius: 99, background: "#fff" }} />
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* impact */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 16, flex: "0 0 auto", ...fadeUp("0.12s", "0.5s") }}>
        <ImpactCard label="BRAND SCORE, BEFORE DIVVIT → NOW">
          <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
            <span style={{ fontSize: 32, fontWeight: 800, letterSpacing: "-0.035em", lineHeight: 1, color: "#c3bcd4" }}>61</span>
            <Icon name="right" size={18} color="#c3bcd4" style={{ alignSelf: "center" }} />
            <span style={{ fontSize: 38, fontWeight: 800, letterSpacing: "-0.04em", lineHeight: 1, color: "#8c52ff" }}>{BH_SCORE}</span>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: "#16a06b", background: "rgba(22,160,107,0.11)", borderRadius: 99, padding: "4px 10px" }}>+22</span>
          </div>
          <div style={{ display: "flex", height: 8, borderRadius: 99, overflow: "hidden", background: "rgba(17,24,39,0.06)" }}>
            <span style={{ width: "61%", background: "#d7d3e2" }} />
            <span style={{ width: "22%", background: "linear-gradient(90deg,#9a63ff,#7a3ef0)" }} />
          </div>
          <span style={{ fontSize: 12.5, color: "#6b7280" }}>Since you joined, six months ago.</span>
        </ImpactCard>

        <ImpactCard label="SHARE OF VOICE">
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <span style={{ fontSize: 38, fontWeight: 800, letterSpacing: "-0.04em", lineHeight: 1, color: "#8c52ff" }}>66%</span>
            <span style={{ fontSize: 12.5, color: "#6b7280" }}>of your views came from Divvit content</span>
          </div>
          <span style={{ height: 8, borderRadius: 99, background: "rgba(17,24,39,0.06)", overflow: "hidden", display: "block" }}>
            <span style={{ display: "block", height: "100%", width: "66%", borderRadius: 99, background: "linear-gradient(90deg,#9a63ff,#7a3ef0)" }} />
          </span>
          <span style={{ fontSize: 12.5, color: "#6b7280" }}>Up from 41% when you started.</span>
        </ImpactCard>

        <ImpactCard label="COST SAVED THIS MONTH">
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <span style={{ fontSize: 38, fontWeight: 800, letterSpacing: "-0.04em", lineHeight: 1, color: "#16a06b" }}>$2,890</span>
            <span style={{ fontSize: 12.5, color: "#6b7280" }}>vs buying the same reach</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            {[["What you paid in rewards", "$840", "#111827"], ["What that reach costs paid", "$3,730", "#9ca3af"]].map(([l, v, fg]) => (
              <div key={l} style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
                <span style={{ fontSize: 12, color: "#6b7280" }}>{l}</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: fg, fontVariantNumeric: "tabular-nums" }}>{v}</span>
              </div>
            ))}
          </div>
        </ImpactCard>
      </div>

      {/* feedback */}
      <div style={{
        background: "#fff", borderRadius: 18, padding: "20px 22px", display: "flex",
        flexDirection: "column", gap: 16, flex: "0 0 auto", marginBottom: 8,
        boxShadow: "0 0 0 1px rgba(17,24,39,0.07), 0 6px 20px rgba(58,32,137,0.05)",
        ...fadeUp("0.18s", "0.5s"),
      }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: 14 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <span style={{ fontSize: 14.5, fontWeight: 700 }}>Feedback</span>
            <span style={{ fontSize: 12.5, color: "#9ca3af" }}>{COMMENTS.length} comments read across TikTok and Instagram · {posShare}% positive</span>
          </div>
          <div style={{ display: "flex", padding: 4, background: "#f1f1f6", borderRadius: 12, boxShadow: "0 0 0 1px rgba(17,24,39,0.07)", gap: 2 }}>
            {([["keep", "Keep doing", "trendUp", WORKING.length], ["fix", "Worth fixing", "info", FIXING.length], ["said", "What people said", "message", COMMENTS.length]] as const).map(([k, label, ico, n]) => {
              const on = tab === k;
              return (
                <button key={k} onClick={() => setTab(k)} style={{
                  display: "flex", alignItems: "center", gap: 8, padding: "7px 14px", borderRadius: 9,
                  fontSize: 13, fontWeight: 600, whiteSpace: "nowrap",
                  color: on ? "#fff" : "#6b7280", background: on ? "#8c52ff" : "transparent",
                  transition: "background 0.18s ease, color 0.18s ease",
                }}>
                  <Icon name={ico as IconName} size={14} />{label}
                  <span style={{ fontSize: 11, fontWeight: 700, color: on ? "rgba(255,255,255,0.75)" : "#9ca3af" }}>{n}</span>
                </button>
              );
            })}
          </div>
        </div>

        {tab === "keep" && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px,1fr))", gap: 12 }}>
            {WORKING.map((w) => <FeedbackCard key={w.label} {...w} tone="mint" />)}
          </div>
        )}
        {tab === "fix" && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px,1fr))", gap: 12 }}>
            {FIXING.map((w) => <FeedbackCard key={w.label} {...w} tone="mango" />)}
          </div>
        )}
        {tab === "said" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
              {([["all", "All sources", COMMENTS.length],
                 ["tiktok", "TikTok", COMMENTS.filter((c) => c.platform === "tiktok").length],
                 ["instagram", "Instagram", COMMENTS.filter((c) => c.platform === "instagram").length]] as const).map(([k, label, n]) => {
                const on = platform === k;
                return (
                  <button key={k} onClick={() => setPlatform(k)} style={{
                    display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 99,
                    fontSize: 12.5, fontWeight: 600, whiteSpace: "nowrap",
                    color: on ? "#fff" : "#4b5563", background: on ? "#8c52ff" : "#f5f5f9",
                    boxShadow: on ? "0 1px 3px rgba(140,82,255,0.35)" : "inset 0 0 0 1px rgba(17,24,39,0.07)",
                    transition: "background 0.2s ease, color 0.2s ease",
                  }}>
                    {label}<span style={{ fontSize: 11, color: on ? "rgba(255,255,255,0.75)" : "#9ca3af" }}>{n}</span>
                  </button>
                );
              })}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 12 }}>
              {filtered.map((c, i) => {
                const open = !!expanded[c.who + c.quote];
                const pos = c.sent === "pos";
                return (
                  <div key={c.who + i} style={{
                    display: "flex", flexDirection: "column", gap: 10, padding: 16, borderRadius: 14,
                    background: "#faf9fd", boxShadow: "inset 0 0 0 1px rgba(17,24,39,0.05)",
                    animation: `dvFadeUp 0.45s ${(0.04 * i).toFixed(2)}s ${EASE} backwards`,
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <Icon name={c.platform} size={14} color={c.platform === "tiktok" ? "#111827" : "#d62976"} />
                      <span style={{ fontSize: 12.5, fontWeight: 600 }}>{c.who}</span>
                      <span style={{ flex: 1 }} />
                      <span style={{
                        fontSize: 11, fontWeight: 600, borderRadius: 99, padding: "3px 9px", whiteSpace: "nowrap",
                        color: pos ? "#0d7a4f" : "#b9700a",
                        background: pos ? "rgba(22,160,107,0.12)" : "rgba(245,149,18,0.14)",
                      }}>{pos ? "Positive" : "Worth fixing"}</span>
                    </div>
                    <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, fontWeight: 500 }}>“{c.quote}”</p>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 11.5, color: "#9ca3af" }}>
                      <span>{c.eng}</span>
                      <span style={{ width: 3, height: 3, borderRadius: "50%", background: "#d3cee0" }} />
                      <span style={{ fontWeight: 600, color: "#6b7280" }}>{c.topic}</span>
                    </div>
                    <button onClick={() => setExpanded((e) => ({ ...e, [c.who + c.quote]: !open }))}
                      style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, color: "#8c52ff" }}>
                      <Icon name="sparkle" size={13} />{open ? "Hide suggestion" : "What to do about it"}
                    </button>
                    {open && (
                      <div style={{ display: "flex", gap: 10, padding: 12, borderRadius: 11, background: "rgba(140,82,255,0.08)", animation: "dvFadeIn 0.3s ease" }}>
                        <span style={{ fontSize: 12.5, lineHeight: 1.55, color: "#4b5563" }}>{c.rec}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {filtered.length === 0 && (
              <div style={{ padding: "40px 20px", textAlign: "center", color: "#9ca3af", fontSize: 13.5 }}>
                Nothing from this source in that mood yet.
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}

function ImpactCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{
      background: "#fff", borderRadius: 18, padding: "20px 22px", display: "flex",
      flexDirection: "column", gap: 12,
      boxShadow: "0 0 0 1px rgba(17,24,39,0.07), 0 6px 20px rgba(58,32,137,0.05)",
    }}>
      <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.08em", color: "#9ca3af" }}>{label}</span>
      {children}
    </div>
  );
}

function FeedbackCard({ label, value, note, tone }: {
  label: string; value: string; note: string; tone: "mint" | "mango";
}) {
  const mint = tone === "mint";
  return (
    <div style={{
      display: "flex", flexDirection: "column", gap: 5, padding: "16px 18px", borderRadius: 14,
      background: mint ? "rgba(22,160,107,0.06)" : "rgba(245,149,18,0.07)",
      boxShadow: `inset 0 0 0 1px ${mint ? "rgba(22,160,107,0.16)" : "rgba(245,149,18,0.2)"}`,
      animation: `dvFadeUp 0.4s ${EASE} backwards`,
    }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
        <span style={{ fontSize: 13.5, fontWeight: 700 }}>{label}</span>
        <span style={{ fontSize: 14, fontWeight: 800, letterSpacing: "-0.02em", color: mint ? "#0d7a4f" : "#b9700a", flex: "0 0 auto" }}>{value}</span>
      </div>
      <span style={{ fontSize: 12.5, lineHeight: 1.5, color: "#4b5563" }}>{note}</span>
    </div>
  );
}
