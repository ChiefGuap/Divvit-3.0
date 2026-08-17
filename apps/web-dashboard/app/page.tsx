"use client";

/* Dashboard (home) — the morning glance.
   Order per the handoff: Editor + submissions/Live Feed row, metrics row with
   the inflow graph, then the attention/CPM card. */

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon, type IconName } from "@/lib/icons";
import { useShell } from "@/components/Shell";
import {
  attention7d, homeSubmissions, inflowByDay, fmtK,
  PAID_CPM_LOW, PAID_CPM_HIGH,
} from "@/lib/data";
import { EASE, GlassCard, PlayBadge, PurpleButton, fadeUp, relativeTime } from "@/lib/ui";
import { WeeklyReport } from "@/components/WeeklyReport";

const REEL_CUTS = [
  { len: "0:24", bg: "url('/uploads/IMG_8222.jpg') center 50%/135% no-repeat, linear-gradient(135deg,#c4b0ff,#8c52ff)" },
  { len: "0:18", bg: "url('/uploads/IMG_8218.jpg') center 50%/135% no-repeat, linear-gradient(135deg,#b7c4ff,#6346cd)" },
  { len: "0:31", bg: "url('/uploads/IMG_8221.jpg') center 50%/135% no-repeat, linear-gradient(135deg,#a7e8cd,#16a06b)" },
];

export default function DashboardPage() {
  const router = useRouter();
  const { feed, liveVideos, now, toast } = useShell();
  const [subPage, setSubPage] = React.useState(0);
  const [decided, setDecided] = React.useState<Record<number, boolean>>({});
  const [barTip, setBarTip] = React.useState<string | null>(null);
  const [attHover, setAttHover] = React.useState<number | null>(null);
  const [reportOpen, setReportOpen] = React.useState(false);

  const greeting = React.useMemo(() => {
    const h = new Date().getHours();
    return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  }, []);
  const liveDate = React.useMemo(
    () => new Date().toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" }),
    [],
  );

  const visible = homeSubmissions.filter((_, i) => !decided[i]);
  const pages = Math.max(1, Math.ceil(visible.length / 3));
  const page = Math.min(subPage, pages - 1);

  const decide = (idx: number, accept: boolean, name: string) => {
    setDecided((d) => ({ ...d, [idx]: true }));
    toast(accept ? "Accepted" : "Passed on", name);
  };

  /* Inflow graph: 7 days x 3 sampled hours. */
  const inflowMax = Math.max(...inflowByDay.flatMap((d) => d.bars.map((b) => b.n)));
  const inflowTotal = inflowByDay.reduce((t, d) => t + d.bars.reduce((s, b) => s + b.n, 0), 0);
  const busiest = inflowByDay.reduce((best, d) => {
    const n = d.bars.reduce((s, b) => s + b.n, 0);
    return n > best.n ? { day: d.day, n } : best;
  }, { day: "", n: -1 });

  /* Attention: Divvit-sourced views vs their own posts. */
  const attMax = Math.max(...attention7d.map((d) => d.divvit + d.organic));
  const totalDivvit = attention7d.reduce((t, d) => t + d.divvit, 0);
  const totalOrganic = attention7d.reduce((t, d) => t + d.organic, 0);
  const sharePct = Math.round((totalDivvit / (totalDivvit + totalOrganic)) * 100);

  /* CPM is computed, never hardcoded: rewardsPaid / views * 1000. */
  const rewardsPaidUSD = 840;
  const divvitCpm = (rewardsPaidUSD / totalDivvit) * 1000;
  const cpmRows = [
    { label: "Divvit", value: `$${divvitCpm.toFixed(2)}`, fg: "#16a06b", w: `${(divvitCpm / PAID_CPM_HIGH) * 100}%`, weight: 700 },
    { label: "Paid social, low end", value: `$${PAID_CPM_LOW.toFixed(2)}`, fg: "#9ca3af", w: `${(PAID_CPM_LOW / PAID_CPM_HIGH) * 100}%`, weight: 500 },
    { label: "Paid social, high end", value: `$${PAID_CPM_HIGH.toFixed(2)}`, fg: "#c3bcd4", w: "100%", weight: 500 },
  ];

  const stats: { label: string; value: string; sub: string; fg: string; icon: IconName }[] = [
    { label: "Videos in today", value: String(liveVideos), sub: "clips from guests", fg: "#8c52ff", icon: "video" },
    { label: "Views this week", value: fmtK(totalDivvit + totalOrganic), sub: "creator + your pages", fg: "#111827", icon: "eye" },
    { label: "Unique creators", value: "29", sub: "+7 new this week", fg: "#16a06b", icon: "users" },
    { label: "Rewards paid", value: `$${rewardsPaidUSD}`, sub: "this month", fg: "#f59512", icon: "gift" },
  ];

  return (
    <>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: 16, ...fadeUp("0.05s", "0.5s") }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, letterSpacing: "-0.015em" }}>
            {greeting}, Elliott
          </h1>
          <span style={{ fontSize: 13, color: "#9ca3af" }}>{liveDate}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button onClick={() => setReportOpen(true)} className="hoverInk" style={{
            display: "flex", alignItems: "center", gap: 8, padding: "10px 16px", borderRadius: 11,
            background: "rgba(255,255,255,0.72)", backdropFilter: "blur(14px)",
            boxShadow: "inset 0 0 0 1px rgba(17,24,39,0.08)", color: "#4b5563",
            fontSize: 13.5, fontWeight: 600, whiteSpace: "nowrap",
          }}>
            <Icon name="pulse" size={16} color="#16a06b" />View this week&apos;s report
          </button>
          <PurpleButton onClick={() => router.push("/collection/campaigns")} style={{ borderRadius: 11, boxShadow: "0 8px 20px rgba(140,82,255,0.28)" }}>
            New video request
          </PurpleButton>
        </div>
      </div>

      {/* ROW 1 · new submissions + live feed */}
      <div style={{ flex: "0 0 auto", display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: 16, alignItems: "start", ...fadeUp("0.1s") }}>
        <GlassCard style={{ gap: 14 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontWeight: 600, fontSize: 14 }}>New submissions</span>
              <span style={{ fontSize: 11.5, fontWeight: 600, color: "#8c52ff", background: "rgba(140,82,255,0.1)", borderRadius: 99, padding: "3px 9px" }}>
                {visible.length} to review
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <Link href="/collection" style={{ fontSize: 12.5, fontWeight: 600 }}>Open The Collection</Link>
              <div style={{ display: "flex", gap: 6 }}>
                {([["left", () => setSubPage((p) => Math.max(0, p - 1)), page > 0],
                   ["right", () => setSubPage((p) => Math.min(pages - 1, p + 1)), page < pages - 1]] as const).map(([ico, fn, on]) => (
                  <button key={ico} onClick={fn} aria-label={ico === "left" ? "Previous" : "Next"} style={{
                    width: 28, height: 28, borderRadius: 9, background: "#f5f5f9",
                    boxShadow: "0 0 0 1px rgba(17,24,39,0.07)", display: "flex",
                    alignItems: "center", justifyContent: "center",
                    color: on ? "#4b5563" : "#d5d0e8",
                  }}>
                    <Icon name={ico as IconName} size={14} />
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div style={{ overflow: "hidden", margin: -6, padding: 6 }}>
            <div style={{
              display: "grid", gridAutoFlow: "column", gridAutoColumns: "calc((100% - 28px) / 3)",
              gap: 14, transform: `translateX(calc(${-page} * (100% + 14px)))`,
              transition: `transform 0.55s cubic-bezier(0.22,1,0.36,1)`,
            }}>
              {visible.map((v, i) => (
                <div key={v.creator + i} style={{
                  borderRadius: 12, overflow: "hidden", background: "#fff",
                  boxShadow: "0 0 0 1px rgba(17,24,39,0.07), 0 2px 6px rgba(58,32,137,0.05)",
                  display: "flex", flexDirection: "column",
                }}>
                  <div style={{ position: "relative", aspectRatio: "16/10", background: v.thumbBg, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <PlayBadge size={36} />
                    <span style={{ position: "absolute", bottom: 8, right: 8, fontSize: 11, fontWeight: 600, color: "#fff", background: "rgba(17,24,39,0.65)", borderRadius: 6, padding: "2px 7px" }}>{v.length}</span>
                    <span style={{ position: "absolute", top: 8, left: 8, fontSize: 11, fontWeight: 600, color: "#fff", background: v.srcBg, borderRadius: 6, padding: "2px 7px" }}>{v.source}</span>
                  </div>
                  <div style={{ padding: "11px 12px", display: "flex", flexDirection: "column", gap: 8, flex: 1 }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 1, flex: 1 }}>
                      <span style={{ fontWeight: 600, fontSize: 13 }}>{v.creator}</span>
                      <span style={{ fontSize: 12, color: "#9ca3af" }}>{v.meta}</span>
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button onClick={() => decide(homeSubmissions.indexOf(v), true, v.creator)} style={{
                        flex: 1, padding: "7px 0", borderRadius: 10,
                        background: "linear-gradient(135deg,#9a63ff,#7a3ef0)", color: "#fff",
                        fontSize: 12.5, fontWeight: 700, boxShadow: "0 2px 8px rgba(122,62,240,0.24)",
                      }}>Accept</button>
                      <button onClick={() => decide(homeSubmissions.indexOf(v), false, v.creator)} className="btnQuiet" style={{ flex: 1, padding: "7px 0", color: "#6b7280" }}>Pass</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </GlassCard>

        {/* Live Feed — clips in, rewards out. Newest first, self-ticking. */}
        <GlassCard style={{ padding: "18px 18px 12px", gap: 10, overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#16a06b", animation: "dvBreathe 2.4s ease-in-out infinite" }} />
            <span style={{ fontWeight: 600, fontSize: 14 }}>Live Feed</span>
            <span style={{ fontSize: 11.5, color: "#9ca3af" }}>clips in · rewards out</span>
            <span style={{ flex: 1 }} />
            <Link href="/collection" style={{ fontSize: 12.5 }}>Open</Link>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2, overflow: "hidden" }}>
            {feed.map((f) => (
              <div key={f.key} className="hoverRowPurple" style={{
                display: "flex", alignItems: "center", gap: 11, padding: "8px 6px", borderRadius: 10,
                animation: f.fresh ? `dvSlideIn 0.45s ${EASE}` : undefined,
              }}>
                <span style={{
                  display: "flex", alignItems: "center", justifyContent: "center",
                  width: 28, height: 28, borderRadius: 9, flex: "0 0 auto",
                  color: f.fg, background: f.clip ? "rgba(140,82,255,0.12)" : "rgba(245,149,18,0.14)",
                }}>
                  <Icon name={f.icon} size={14} />
                </span>
                <span style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0, flex: 1 }}>
                  <span style={{ fontSize: 12.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    <b style={{ fontWeight: 600 }}>{f.who}</b> {f.what}
                  </span>
                  <span style={{ fontSize: 11.5, color: "#9ca3af", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{f.meta}</span>
                </span>
                <span style={{ fontSize: 11, color: "#c9c4d8", flex: "0 0 auto" }}>{relativeTime(f.at, now)}</span>
              </div>
            ))}
          </div>
        </GlassCard>
      </div>

      {/* ROW 2 · editor */}
      <div style={{
        position: "relative", flex: "0 0 auto", overflow: "hidden", borderRadius: 20,
        padding: "18px 22px", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 30,
        background: "linear-gradient(135deg, rgba(255,255,255,0.86), rgba(255,255,255,0.62))",
        backdropFilter: "blur(20px) saturate(150%)", WebkitBackdropFilter: "blur(20px) saturate(150%)",
        boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.7), 0 14px 36px rgba(140,82,255,0.10)",
        ...fadeUp("0.16s"),
      }}>
        <span style={{ position: "absolute", top: -110, right: -60, width: 260, height: 260, borderRadius: "50%", background: "rgba(140,82,255,0.13)", filter: "blur(10px)", pointerEvents: "none" }} />
        <div style={{ position: "relative", flex: "0 0 auto", display: "flex", alignItems: "flex-end", gap: 12 }}>
          {REEL_CUTS.map((c, i) => (
            <div key={i} style={{
              position: "relative", width: 96, aspectRatio: "9/16", borderRadius: 13,
              overflow: "hidden", background: c.bg, boxShadow: "0 10px 26px rgba(75,41,180,0.2)",
            }}>
              <span style={{ position: "absolute", top: 7, left: 7, padding: "2px 7px", borderRadius: 5, background: "rgba(255,255,255,0.94)", color: "#4b29b4", fontSize: 9, fontWeight: 800, letterSpacing: "0.04em" }}>DONE</span>
              <span style={{ position: "absolute", bottom: 7, right: 7, padding: "2px 7px", borderRadius: 5, background: "rgba(17,24,39,0.7)", color: "#fff", fontSize: 9.5, fontWeight: 700 }}>{c.len}</span>
            </div>
          ))}
        </div>
        <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: 10, flex: "1 1 300px", minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, borderRadius: 9, color: "#8c52ff", background: "rgba(140,82,255,0.14)" }}>
              <Icon name="wand" size={15} />
            </span>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.09em", color: "#8c52ff" }}>EDITOR</span>
          </div>
          <h2 style={{ margin: 0, fontSize: 21, fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1.2 }}>3 cuts ready to post</h2>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 14, marginTop: 4 }}>
            <PurpleButton onClick={() => router.push("/editor")} style={{ borderRadius: 11, boxShadow: "0 8px 20px rgba(140,82,255,0.28)" }}>
              Make a video<Icon name="right" size={14} />
            </PurpleButton>
            <span style={{ fontSize: 12.5, color: "#6b7280" }}>Drop clips in, get a finished vertical video back.</span>
          </div>
        </div>
      </div>

      {/* ROW 3 · today's numbers, then inflow */}
      <GlassCard style={{ borderRadius: 18, padding: "18px 20px 16px", gap: 16, boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.7), 0 10px 30px rgba(140,82,255,0.07)", ...fadeUp("0.22s") }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "14px 34px" }}>
          {stats.map((s) => (
            <div key={s.label} style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 130 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, color: "#6b7280" }}>
                <Icon name={s.icon} size={14} color={s.fg} />{s.label}
              </span>
              <span style={{ fontSize: 27, fontWeight: 800, letterSpacing: "-0.03em", lineHeight: 1.1, color: s.fg }}>{s.value}</span>
              <span style={{ fontSize: 11.5, color: "#9ca3af" }}>{s.sub}</span>
            </div>
          ))}
        </div>
        <div style={{ height: 1, background: "rgba(17,24,39,0.10)" }} />
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: 10 }}>
            <span style={{ fontSize: 13.5, fontWeight: 600 }}>Videos coming in</span>
            <span style={{ fontSize: 12, color: "#9ca3af" }}>Last 7 days · sampled 9a, 12p, 3p</span>
            <span style={{ flex: 1 }} />
            <span style={{ fontSize: 12, color: "#6b7280" }}>Total <b style={{ color: "#8c52ff" }}>{inflowTotal}</b></span>
            <span style={{ fontSize: 12, color: "#6b7280" }}>Busiest <b style={{ color: "#111827" }}>{busiest.day}</b></span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 12 }}>
            {inflowByDay.map((d) => (
              <div key={d.day} style={{ position: "relative", display: "flex", flexDirection: "column", gap: 8 }}>
                {barTip?.startsWith(d.day + "|") && (
                  <div style={{
                    position: "absolute", left: "50%", bottom: "calc(100% + 6px)", transform: "translateX(-50%)",
                    zIndex: 6, padding: "7px 11px", borderRadius: 10, background: "#111827", color: "#fff",
                    fontSize: 11.5, fontWeight: 600, whiteSpace: "nowrap",
                    boxShadow: "0 8px 20px rgba(17,24,39,0.22)", animation: "dvFadeIn 0.14s ease",
                  }}>{barTip.split("|")[1]}</div>
                )}
                <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "center", gap: 6, height: 74 }}>
                  {d.bars.map((b) => {
                    const active = barTip === `${d.day}|${b.n} clips · ${b.hour}`;
                    return (
                      <span
                        key={b.hour}
                        onMouseEnter={() => setBarTip(`${d.day}|${b.n} clips · ${b.hour}`)}
                        onMouseLeave={() => setBarTip(null)}
                        style={{
                          width: 16, height: `${Math.max(8, (b.n / inflowMax) * 74)}px`,
                          borderRadius: "5px 5px 2px 2px",
                          background: active ? "#6346cd" : "#b79aff",
                          transition: "background 0.15s ease",
                        }}
                      />
                    );
                  })}
                </div>
                <span style={{ textAlign: "center", fontSize: 11, fontWeight: 600, color: d.day === busiest.day ? "#111827" : "#9ca3af" }}>{d.day}</span>
              </div>
            ))}
          </div>
        </div>
      </GlassCard>

      {/* ROW 4 · attention + CPM */}
      <GlassCard style={{ padding: "20px 22px 18px", gap: 18, boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.7), 0 10px 30px rgba(140,82,255,0.07)", ...fadeUp("0.28s") }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: 20 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <span style={{ fontWeight: 600, fontSize: 14.5 }}>Attention on your content</span>
            <span style={{ fontSize: 12.5, color: "#6b7280" }}>Views on everything you posted this week. Hover a day for its top posts.</span>
          </div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 28, flexWrap: "wrap" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", color: "#8c52ff" }}>DIVVIT&apos;S CONTRIBUTION</span>
              <div style={{ display: "flex", alignItems: "baseline", gap: 9 }}>
                <span style={{ fontSize: 38, fontWeight: 800, letterSpacing: "-0.04em", lineHeight: 1, color: "#8c52ff" }}>{sharePct}%</span>
                <span style={{ fontSize: 12.5, color: "#6b7280" }}>of all views this week</span>
              </div>
              <span style={{ width: "100%", maxWidth: 280, height: 7, borderRadius: 99, background: "rgba(17,24,39,0.08)", overflow: "hidden" }}>
                <span style={{ display: "block", height: "100%", width: `${sharePct}%`, borderRadius: 99, background: "linear-gradient(90deg,#9a63ff,#7a3ef0)" }} />
              </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11.5, color: "#6b7280" }}>
                <span style={{ width: 8, height: 8, borderRadius: 3, background: "#8c52ff" }} />From Divvit
              </span>
              <span style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.03em", lineHeight: 1.1 }}>{fmtK(totalDivvit)}</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11.5, color: "#6b7280" }}>
                <span style={{ width: 8, height: 8, borderRadius: 3, background: "#d7d3e2" }} />Your own posts
              </span>
              <span style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.03em", lineHeight: 1.1, color: "#4b5563" }}>{fmtK(totalOrganic)}</span>
            </div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1.9fr 1fr", gap: 26, alignItems: "stretch" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 14, alignItems: "flex-end", height: 168 }}>
            {attention7d.map((c, i) => {
              const total = c.divvit + c.organic;
              const on = attHover === i;
              return (
                <div key={c.day}
                  onMouseEnter={() => setAttHover(i)}
                  onMouseLeave={() => setAttHover(null)}
                  style={{ position: "relative", minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 7, height: "100%", justifyContent: "flex-end" }}>
                  {on && (
                    <div style={{
                      position: "absolute", left: i > 4 ? "auto" : "50%", right: i > 4 ? 0 : "auto",
                      transform: i > 4 ? "none" : "translateX(-50%)",
                      bottom: "calc(100% - 16px)", zIndex: 9, width: 246, padding: "12px 13px",
                      borderRadius: 13, background: "#111827", color: "#fff",
                      boxShadow: "0 14px 34px rgba(17,24,39,0.3)",
                      display: "flex", flexDirection: "column", gap: 9, animation: "dvFadeIn 0.15s ease",
                    }}>
                      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", color: "rgba(255,255,255,0.55)" }}>TOP POSTS · {c.day}</span>
                      {c.top.map((t) => (
                        <span key={t.title} style={{ display: "flex", alignItems: "center", gap: 9 }}>
                          <span style={{
                            fontSize: 9.5, fontWeight: 700, borderRadius: 99, padding: "2px 7px", flex: "0 0 auto",
                            color: t.src === "Divvit" ? "#fff" : "#c9c4d8",
                            background: t.src === "Divvit" ? "#8c52ff" : "rgba(255,255,255,0.14)",
                          }}>{t.src}</span>
                          <span style={{ flex: 1, minWidth: 0, fontSize: 11.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: "rgba(255,255,255,0.88)" }}>{t.title}</span>
                          <span style={{ fontSize: 11.5, fontWeight: 700, flex: "0 0 auto" }}>{t.views}</span>
                        </span>
                      ))}
                    </div>
                  )}
                  <span style={{ fontSize: 11, fontWeight: 600, color: on ? "#111827" : "#9ca3af", fontVariantNumeric: "tabular-nums" }}>{fmtK(total)}</span>
                  <div style={{ width: "100%", display: "flex", flexDirection: "column", justifyContent: "flex-end", gap: 2, flex: 1 }}>
                    <div style={{ height: `${(c.organic / attMax) * 100}%`, borderRadius: "5px 5px 0 0", background: on ? "#c3bcd4" : "#d7d3e2", transition: "background 0.15s ease" }} />
                    <div style={{ height: `${(c.divvit / attMax) * 100}%`, borderRadius: "0 0 5px 5px", background: on ? "#7a3ef0" : "#8c52ff", transition: "background 0.15s ease" }} />
                  </div>
                  <span style={{ fontSize: 11, color: on ? "#111827" : "#9ca3af" }}>{c.day}</span>
                </div>
              );
            })}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 14, paddingLeft: 26, boxShadow: "inset 1px 0 0 rgba(17,24,39,0.09)" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", color: "#9ca3af" }}>DIVVIT CPM PER VIDEO</span>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <span style={{ fontSize: 34, fontWeight: 800, letterSpacing: "-0.035em", lineHeight: 1, color: "#16a06b" }}>${divvitCpm.toFixed(2)}</span>
                <span style={{ fontSize: 12, color: "#9ca3af" }}>per 1,000 views</span>
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
              {cpmRows.map((r) => (
                <div key={r.label} style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                  <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
                    <span style={{ fontSize: 12, color: r.fg === "#16a06b" ? "#111827" : "#6b7280", fontWeight: r.weight }}>{r.label}</span>
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: r.fg, fontVariantNumeric: "tabular-nums" }}>{r.value}</span>
                  </div>
                  <span style={{ height: 7, borderRadius: 99, background: "rgba(17,24,39,0.06)", overflow: "hidden" }}>
                    <span style={{ display: "block", height: "100%", width: r.w, borderRadius: 99, background: r.fg }} />
                  </span>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 10, padding: "12px 13px", borderRadius: 12, background: "rgba(22,160,107,0.09)", marginTop: "auto" }}>
              <Icon name="trendUp" size={15} color="#16a06b" style={{ marginTop: 1 }} />
              <span style={{ fontSize: 12.5, lineHeight: 1.5, color: "#4b5563" }}>
                You reached {fmtK(totalDivvit)} people for ${rewardsPaidUSD} in rewards — about{" "}
                {Math.round(PAID_CPM_HIGH / divvitCpm)}× cheaper than buying the same reach.
              </span>
            </div>
          </div>
        </div>
      </GlassCard>

      {reportOpen && <WeeklyReport onClose={() => setReportOpen(false)} />}
    </>
  );
}
