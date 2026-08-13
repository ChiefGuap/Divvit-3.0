"use client";

/* Editor — turn accepted clips into a finished vertical video.
   Landing (Automate / Customize) → wizard or auto-run → render → result.
   Render progress is interval-driven here; the real app polls a job API. */

import React from "react";
import Link from "next/link";
import { Icon, type IconName } from "@/lib/icons";
import { useShell } from "@/components/Shell";
import { edStyleDefs, edClipLib, edStyleRefs, edDrafts, edKindLabel, fmtK } from "@/lib/data";
import { EASE, fadeUp } from "@/lib/ui";

type Stage = "home" | "wizard" | "render" | "result";
const STEPS = ["Style", "Clips", "Look & length", "Voiceover"];
const MAX_CLIPS = 7;

const RENDER_STEPS: { label: string; icon: IconName }[] = [
  { label: "Reading your clips", icon: "film" },
  { label: "Matching the style", icon: "wand" },
  { label: "Cutting to the beat", icon: "sliders" },
  { label: "Adding captions", icon: "type" },
  { label: "Rendering vertical", icon: "video" },
];

const FONTS = [
  { id: "bold", label: "Bold sans", weight: 800, tracking: "-0.02em", caps: "none" },
  { id: "caps", label: "All caps", weight: 700, tracking: "0.06em", caps: "uppercase" },
  { id: "soft", label: "Soft rounded", weight: 600, tracking: "0", caps: "none" },
  { id: "editorial", label: "Editorial", weight: 500, tracking: "-0.01em", caps: "none" },
];

const LENGTHS = [
  { id: "short", label: "0:15", note: "Fast, loops well" },
  { id: "mid", label: "0:22", note: "Most posted length" },
  { id: "long", label: "0:30", note: "Room for a story" },
];

const VOICES = [
  { id: "none", label: "No voiceover", note: "Use the original audio from your clips", icon: "mic" as IconName, beta: false },
  { id: "warm", label: "Warm narrator", note: "Calm, unhurried — suits interior and ambience cuts", icon: "mic" as IconName, beta: true },
  { id: "punchy", label: "Punchy host", note: "Higher energy — suits dish highlights and reviews", icon: "mic" as IconName, beta: true },
];

export default function EditorPage() {
  const { toast } = useShell();
  const [stage, setStage] = React.useState<Stage>("home");
  const [mode, setMode] = React.useState<"automate" | "customize">("automate");
  const [step, setStep] = React.useState(0);
  const [styleId, setStyleId] = React.useState(edStyleDefs[0].id);
  const [picked, setPicked] = React.useState<string[]>([]);
  const [font, setFont] = React.useState("bold");
  const [length, setLength] = React.useState("mid");
  const [voice, setVoice] = React.useState("none");
  const [progress, setProgress] = React.useState(0);

  const style = edStyleDefs.find((s) => s.id === styleId) ?? edStyleDefs[0];
  const recommended = edClipLib.filter((c) => style.tags.includes(c.kind)).map((c) => c.id);
  const renderClips = picked.length ? picked : recommended.slice(0, 5);

  const startRender = (m: "automate" | "customize") => {
    setMode(m);
    setStage("render");
    setProgress(0);
  };

  React.useEffect(() => {
    if (stage !== "render") return;
    const t = setInterval(() => {
      setProgress((p) => {
        if (p >= 100) { clearInterval(t); setStage("result"); return 100; }
        return Math.min(100, p + 3.4);
      });
    }, 190);
    return () => clearInterval(t);
  }, [stage]);

  const togglePick = (id: string) =>
    setPicked((p) => p.includes(id) ? p.filter((x) => x !== id)
      : p.length >= MAX_CLIPS ? p : [...p, id]);

  const reset = () => { setStage("home"); setStep(0); setPicked([]); setProgress(0); };

  /* ---------------- landing ---------------- */
  if (stage === "home") {
    return (
      <>
        <div style={{ display: "flex", flexDirection: "column", gap: 5, flex: "0 0 auto", animation: `dvFadeUp 0.45s ${EASE} backwards` }}>
          <h1 style={{ margin: 0, fontSize: 21, fontWeight: 700, letterSpacing: "-0.015em" }}>Make a video</h1>
          <p style={{ margin: 0, fontSize: 13.5, color: "#6b7280" }}>
            {edClipLib.length} accepted clips ready. Let us cut one, or build it yourself.
          </p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18, flex: "0 0 auto", ...fadeUp("0.08s", "0.5s") }}>
          <button onClick={() => startRender("automate")} className="cardLift" style={{
            position: "relative", overflow: "hidden", borderRadius: 22, padding: "26px 28px 22px",
            display: "flex", flexDirection: "column", gap: 14, textAlign: "left", color: "#fff",
            background: "linear-gradient(122deg, #3f1f9e 0%, #6f3bea 40%, #8c52ff 100%)",
            boxShadow: "0 16px 40px rgba(75,41,180,0.28)",
          }}>
            <span style={{ position: "absolute", top: 14, right: 14, padding: "5px 12px", borderRadius: 99, background: "#fff", color: "#4b29b4", fontSize: 10.5, fontWeight: 800, letterSpacing: "0.07em" }}>RECOMMENDED</span>
            <span style={{
              display: "flex", alignItems: "center", justifyContent: "center", width: 44, height: 44,
              borderRadius: 14, background: "rgba(255,255,255,0.18)", boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.25)",
            }}><Icon name="wand" size={22} /></span>
            <h2 style={{ margin: 0, fontSize: 26, fontWeight: 800, letterSpacing: "-0.03em" }}>Automate</h2>
            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: "rgba(255,255,255,0.86)", maxWidth: "34ch" }}>
              We pick the clips and the style. One finished video, about a minute.
            </p>
            <div style={{ position: "relative", display: "flex", gap: 5, height: 26, marginTop: 2 }}>
              {[1, 1.6, 0.8, 1.3].map((f, i) => (
                <span key={i} style={{
                  flex: f, borderRadius: 6,
                  background: i % 2 ? "rgba(255,255,255,0.22)" : "rgba(255,255,255,0.34)",
                  animation: `dvEdClip 3.6s ease-in-out ${i * 0.5}s infinite`,
                }} />
              ))}
              <span style={{ position: "absolute", top: -4, bottom: -4, width: 2, borderRadius: 2, background: "#fff", animation: "dvEdPlay 3.6s cubic-bezier(0.4,0,0.6,1) infinite" }} />
            </div>
            <span style={{
              alignSelf: "flex-start", marginTop: 6, padding: "12px 22px", borderRadius: 12,
              background: "#fff", color: "#4b29b4", fontSize: 13.5, fontWeight: 700,
            }}>Make it for me</span>
          </button>

          <button onClick={() => { setMode("customize"); setStage("wizard"); }} className="cardLift" style={{
            position: "relative", overflow: "hidden", borderRadius: 22, padding: "26px 28px 22px",
            display: "flex", flexDirection: "column", gap: 14, textAlign: "left", background: "#fff",
            boxShadow: "0 0 0 1px rgba(17,24,39,0.08), 0 8px 26px rgba(58,32,137,0.06)",
          }}>
            <span style={{ position: "absolute", top: 14, right: 14, padding: "5px 12px", borderRadius: 99, background: "#f3f0fb", color: "#7a3ef0", fontSize: 10.5, fontWeight: 800, letterSpacing: "0.07em" }}>FULL CONTROL</span>
            <span style={{
              display: "flex", alignItems: "center", justifyContent: "center", width: 44, height: 44,
              borderRadius: 14, color: "#8c52ff", background: "rgba(140,82,255,0.12)",
            }}><Icon name="sliders" size={22} /></span>
            <h2 style={{ margin: 0, fontSize: 26, fontWeight: 800, letterSpacing: "-0.03em" }}>Customize</h2>
            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: "#4b5563", maxWidth: "34ch" }}>
              Choose the style, the clips and the look. Four short steps.
            </p>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2, height: 26, flexWrap: "wrap" }}>
              {STEPS.map((p) => (
                <span key={p} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, fontWeight: 600, color: "#9089a8" }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#c3b6e8" }} />{p}
                </span>
              ))}
            </div>
            <span className="btnPurple" style={{
              alignSelf: "flex-start", marginTop: 6, padding: "12px 22px", borderRadius: 12,
              fontSize: 13.5, fontWeight: 700, boxShadow: "0 8px 20px rgba(140,82,255,0.28)",
            }}>Build it myself</span>
          </button>
        </div>

        {/* drafts strip — centered, image thumbs, date + status dot only */}
        <div style={{
          background: "#fff", borderRadius: 20, padding: "18px 22px 20px", display: "flex",
          flexDirection: "column", gap: 14, flex: "0 0 auto", marginTop: "auto",
          boxShadow: "0 0 0 1px rgba(17,24,39,0.07), 0 8px 26px rgba(58,32,137,0.06)",
          ...fadeUp("0.16s", "0.5s"),
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.08em", color: "#9ca3af" }}>DRAFTS &amp; HISTORY</span>
            <span style={{ flex: 1 }} />
            <Link href="/content" style={{ fontSize: 12 }}>Open Content Manager</Link>
          </div>
          <div className="scrollThin" style={{ display: "flex", overflowX: "auto", paddingBottom: 2 }}>
            <div style={{ display: "flex", gap: 12, margin: "0 auto" }}>
              {edDrafts.map((d) => (
                <button key={d.title} title={d.title} style={{ flex: "0 0 auto", display: "flex", flexDirection: "column", alignItems: "center", gap: 7 }}>
                  <div style={{
                    position: "relative", width: 76, aspectRatio: "9/16", borderRadius: 11,
                    overflow: "hidden", background: d.thumbBg, boxShadow: "0 4px 14px rgba(75,41,180,0.14)",
                  }}>
                    <span style={{
                      position: "absolute", top: 5, left: 5, width: 7, height: 7, borderRadius: "50%",
                      background: d.state === "Posted" ? "#16a06b" : "#f59512",
                      boxShadow: "0 0 0 2px rgba(255,255,255,0.9)",
                    }} />
                  </div>
                  <span style={{ fontSize: 11, color: "#9ca3af", whiteSpace: "nowrap" }}>{d.when}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </>
    );
  }

  /* ---------------- render ---------------- */
  if (stage === "render") {
    const activeStep = Math.min(RENDER_STEPS.length - 1, Math.floor((progress / 100) * RENDER_STEPS.length));
    return (
      <div style={{
        background: "#fff", borderRadius: 20, padding: "26px 28px", display: "flex",
        flexDirection: "column", gap: 20, flex: "0 0 auto",
        boxShadow: "0 0 0 1px rgba(17,24,39,0.07), 0 8px 26px rgba(58,32,137,0.06)",
        animation: `dvFadeUp 0.5s ${EASE} backwards`,
      }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: 16 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.1em", color: "#8c52ff" }}>RENDERING</span>
            <h2 style={{ margin: 0, fontSize: 21, fontWeight: 700, letterSpacing: "-0.02em" }}>
              {mode === "automate" ? "Cutting your video" : style.name}
            </h2>
            <span style={{ fontSize: 13, color: "#6b7280" }}>
              {renderClips.length} clips · {style.name} · about {style.len}
            </span>
          </div>
          <span style={{ fontSize: 34, fontWeight: 800, letterSpacing: "-0.04em", lineHeight: 1, color: "#8c52ff" }}>{Math.round(progress)}%</span>
        </div>

        <div style={{ height: 8, borderRadius: 99, background: "rgba(140,82,255,0.14)", overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${progress}%`, borderRadius: 99, background: "linear-gradient(90deg,#9a63ff,#6f3bea)", transition: `width 0.4s ${EASE}` }} />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1.15fr", gap: 26 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.08em", color: "#9ca3af" }}>CLIPS GOING IN</span>
            {renderClips.map((id, i) => {
              const c = edClipLib.find((x) => x.id === id)!;
              const done = progress > ((i + 1) / renderClips.length) * 100;
              return (
                <div key={id} style={{
                  display: "flex", alignItems: "center", gap: 12, padding: "9px 11px", borderRadius: 12,
                  background: done ? "rgba(22,160,107,0.07)" : "#faf9fd",
                  boxShadow: `inset 0 0 0 1px ${done ? "rgba(22,160,107,0.18)" : "rgba(17,24,39,0.06)"}`,
                  opacity: done ? 1 : 0.75, transition: "background 0.3s ease, opacity 0.3s ease",
                }}>
                  <div style={{ width: 32, aspectRatio: "9/16", borderRadius: 7, overflow: "hidden", flex: "0 0 auto", background: c.thumbBg }} />
                  <span style={{ display: "flex", flexDirection: "column", gap: 1, flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.who}</span>
                    <span style={{ fontSize: 11, color: "#9ca3af" }}>{c.len} · {edKindLabel[c.kind]}</span>
                  </span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: done ? "#16a06b" : "#c9c4d8", flex: "0 0 auto" }}>{done ? "In" : "Queued"}</span>
                </div>
              );
            })}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.08em", color: "#9ca3af" }}>MATCHED AGAINST STYLES THAT ALREADY WORK</span>
            <div style={{ display: "flex", gap: 12 }}>
              {edStyleRefs.map((t) => {
                const active = t.name === style.name;
                return (
                  <div key={t.name} style={{
                    flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 8, padding: 10,
                    borderRadius: 14, background: active ? "rgba(140,82,255,0.07)" : "#faf9fd",
                    boxShadow: `inset 0 0 0 1px ${active ? "rgba(140,82,255,0.28)" : "rgba(17,24,39,0.06)"}`,
                    transition: "background 0.3s ease, box-shadow 0.3s ease",
                  }}>
                    <div style={{ position: "relative", width: "100%", aspectRatio: "9/16", borderRadius: 10, overflow: "hidden", background: t.thumbBg }}>
                      {active && <span style={{ position: "absolute", inset: 0, boxShadow: "inset 0 0 0 2.5px #8c52ff", borderRadius: 10 }} />}
                    </div>
                    <span style={{ fontSize: 12, fontWeight: 700, color: active ? "#6f3bea" : "#4b5563", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.name}</span>
                    <span style={{ fontSize: 10.5, color: "#9ca3af", lineHeight: 1.35 }}>{t.note}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, paddingTop: 4, borderTop: "1px solid #f1eff8" }}>
          {RENDER_STEPS.map((p, i) => {
            const done = i < activeStep;
            const on = i === activeStep;
            return (
              <span key={p.label} style={{
                display: "inline-flex", alignItems: "center", gap: 7, padding: "7px 12px", borderRadius: 99,
                fontSize: 12, fontWeight: 600,
                color: done ? "#0d7a4f" : on ? "#fff" : "#9ca3af",
                background: done ? "rgba(22,160,107,0.12)" : on ? "#8c52ff" : "#f5f5f9",
                transition: "background 0.3s ease, color 0.3s ease",
              }}>
                <Icon name={done ? "check" : p.icon} size={13} />{p.label}
              </span>
            );
          })}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={reset} className="btnQuiet" style={{ padding: "12px 20px", borderRadius: 12, fontSize: 13.5 }}>Cancel</button>
          <span style={{ fontSize: 12.5, color: "#9ca3af" }}>You can leave this page — the finished video will be waiting here.</span>
        </div>
      </div>
    );
  }

  /* ---------------- result ---------------- */
  if (stage === "result") {
    const lengthLabel = LENGTHS.find((l) => l.id === length)?.label ?? style.len;
    const roi = [
      { label: "TikTok", value: fmtK(Math.round(style.reach * 0.62)), note: "projected views", icon: "tiktok" as IconName, fg: "#111827", bg: "#faf9fd" },
      { label: "Instagram", value: fmtK(Math.round(style.reach * 0.38)), note: "projected views", icon: "instagram" as IconName, fg: "#d62976", bg: "#faf9fd" },
      { label: "Projected CPM", value: `$${style.cpm.toFixed(2)}`, note: "vs $7–12 paid", icon: "trendUp" as IconName, fg: "#16a06b", bg: "rgba(22,160,107,0.07)" },
    ];
    return (
      <div style={{
        background: "#fff", borderRadius: 20, padding: "26px 28px", display: "flex",
        flexWrap: "wrap", gap: 30, flex: "0 0 auto",
        boxShadow: "0 0 0 1px rgba(17,24,39,0.07), 0 8px 26px rgba(58,32,137,0.06)",
        animation: `dvPop 0.5s ${EASE} backwards`,
      }}>
        <div style={{ flex: "0 0 auto", display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{
            position: "relative", width: 216, aspectRatio: "9/16", borderRadius: 18,
            overflow: "hidden", background: style.thumbBg, boxShadow: "0 18px 40px rgba(75,41,180,0.24)",
          }}>
            <span style={{ position: "absolute", top: 10, left: 10, padding: "4px 10px", borderRadius: 7, background: "rgba(255,255,255,0.94)", color: "#4b29b4", fontSize: 10.5, fontWeight: 800, letterSpacing: "0.04em" }}>{style.name}</span>
            <span style={{ position: "absolute", bottom: 10, right: 10, padding: "3px 9px", borderRadius: 6, background: "rgba(17,24,39,0.72)", color: "#fff", fontSize: 11, fontWeight: 700 }}>{lengthLabel}</span>
          </div>
          <span style={{ fontSize: 11.5, color: "#9ca3af", textAlign: "center" }}>{renderClips.length} clips used</span>
        </div>

        <div style={{ flex: "1 1 380px", minWidth: 0, display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.1em", color: "#16a06b" }}>YOUR VIDEO IS READY</span>
            <h2 style={{ margin: 0, fontSize: 24, fontWeight: 800, letterSpacing: "-0.03em" }}>{style.name}, cut for you</h2>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.08em", color: "#9ca3af" }}>PROJECTED REACH</span>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px,1fr))", gap: 14 }}>
              {roi.map((r) => (
                <div key={r.label} style={{ display: "flex", flexDirection: "column", gap: 3, padding: "13px 15px", borderRadius: 14, background: r.bg }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11.5, fontWeight: 600, color: "#6b7280" }}>
                    <Icon name={r.icon} size={13} color={r.fg} />{r.label}
                  </span>
                  <span style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-0.035em", lineHeight: 1.1, color: r.fg }}>{r.value}</span>
                  <span style={{ fontSize: 11, color: "#9ca3af" }}>{r.note}</span>
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 9, padding: "16px 18px", borderRadius: 16, background: "#faf9fd", boxShadow: "inset 0 0 0 1px rgba(17,24,39,0.06)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Icon name="sparkle" size={14} color="#8c52ff" />
              <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.08em", color: "#9ca3af" }}>SUGGESTED CAPTION</span>
              <span style={{ flex: 1 }} />
              <button onClick={() => { navigator.clipboard?.writeText(`${style.caption} ${style.hashtags.join(" ")}`); toast("Copied", "caption"); }}
                style={{ fontSize: 12, fontWeight: 700, color: "#8c52ff" }}>Copy</button>
            </div>
            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, fontWeight: 500 }}>{style.caption}</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
              {style.hashtags.map((t) => (
                <span key={t} style={{ fontSize: 12, fontWeight: 600, color: "#7a3ef0", background: "rgba(140,82,255,0.1)", borderRadius: 99, padding: "4px 11px" }}>{t}</span>
              ))}
            </div>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginTop: "auto" }}>
            <button onClick={() => toast("Downloading", style.name)} className="btnPurple" style={{ padding: "12px 22px", borderRadius: 12, fontSize: 13.5, fontWeight: 700, boxShadow: "0 8px 20px rgba(140,82,255,0.28)" }}>Download</button>
            <button onClick={() => startRender(mode)} className="btnQuiet" style={{ padding: "12px 20px", borderRadius: 12, fontSize: 13.5 }}>Re-process</button>
            <button onClick={reset} className="btnQuiet" style={{ padding: "12px 20px", borderRadius: 12, fontSize: 13.5 }}>Close</button>
          </div>
        </div>
      </div>
    );
  }

  /* ---------------- wizard ---------------- */
  const canAdvance = step !== 1 || picked.length > 0;
  const nextHint = step === 1
    ? `${picked.length} of ${MAX_CLIPS} picked`
    : step === 3 ? "Voiceover is in beta — you can skip it" : "";

  return (
    <>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 14, flex: "0 0 auto", animation: "dvFadeIn 0.35s ease backwards" }}>
        <button onClick={reset} className="hoverInk" style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13, fontWeight: 600, color: "#6b7280" }}>
          <Icon name="left" size={15} />Editor
        </button>
        <div style={{ width: 1, height: 16, background: "#d8d3e6" }} />
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
          {STEPS.map((label, i) => {
            const on = i === step;
            const done = i < step;
            return (
              <button key={label} onClick={() => i <= step && setStep(i)} style={{
                display: "inline-flex", alignItems: "center", gap: 8, padding: "7px 13px", borderRadius: 99,
                fontSize: 12.5, fontWeight: 600, cursor: i <= step ? "pointer" : "default",
                color: on ? "#fff" : done ? "#6f3bea" : "#9ca3af",
                background: on ? "#8c52ff" : done ? "rgba(140,82,255,0.1)" : "#f5f5f9",
                transition: "background 0.18s ease, color 0.18s ease",
              }}>
                <span style={{
                  display: "flex", alignItems: "center", justifyContent: "center", width: 18, height: 18,
                  borderRadius: "50%", fontSize: 10.5, fontWeight: 800,
                  color: on ? "#8c52ff" : "#fff",
                  background: on ? "#fff" : done ? "#8c52ff" : "#c9c4d8",
                }}>{i + 1}</span>
                {label}
              </button>
            );
          })}
        </div>
      </div>

      <div style={{
        background: "#fff", borderRadius: 20, padding: "24px 26px", display: "flex",
        flexDirection: "column", gap: 18, flex: "0 0 auto",
        boxShadow: "0 0 0 1px rgba(17,24,39,0.07), 0 8px 26px rgba(58,32,137,0.06)",
        ...fadeUp("0.05s", "0.45s"),
      }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, letterSpacing: "-0.02em" }}>
            {["Pick a style", "Choose your clips", "Look & length", "Voiceover"][step]}
          </h2>
          <span style={{ fontSize: 13, color: "#6b7280" }}>
            {["Each one is cut differently and lands on a different platform.",
              `Up to ${MAX_CLIPS}. Highlighted ones suit ${style.name}.`,
              "How the captions read, and how long the cut runs.",
              "Optional — your clips already have their own audio."][step]}
          </span>
        </div>

        {step === 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px,1fr))", gap: 14 }}>
            {edStyleDefs.map((t, i) => {
              const on = t.id === styleId;
              return (
                <button key={t.id} onClick={() => { setStyleId(t.id); setPicked([]); }} className="cardLift" style={{
                  display: "flex", flexDirection: "column", gap: 10, padding: 12, borderRadius: 16, textAlign: "left",
                  background: on ? "rgba(140,82,255,0.06)" : "#fff",
                  boxShadow: on ? "0 0 0 2px rgba(140,82,255,0.5)" : "0 0 0 1px rgba(17,24,39,0.07)",
                  animation: `dvStepIn 0.4s ${(0.04 * i).toFixed(2)}s ${EASE} backwards`,
                }}>
                  <div style={{ position: "relative", width: "100%", aspectRatio: "9/16", borderRadius: 12, overflow: "hidden", background: t.thumbBg }}>
                    {on && (
                      <span style={{
                        position: "absolute", top: 8, right: 8, display: "flex", alignItems: "center", justifyContent: "center",
                        width: 24, height: 24, borderRadius: "50%", background: "#8c52ff", color: "#fff",
                        boxShadow: "0 4px 10px rgba(75,41,180,0.34)",
                      }}><Icon name="check" size={13} /></span>
                    )}
                  </div>
                  <span style={{ fontSize: 13.5, fontWeight: 700, color: on ? "#6f3bea" : "#111827" }}>{t.name}</span>
                  <span style={{ fontSize: 12, lineHeight: 1.4, color: "#6b7280" }}>{t.desc}</span>
                  <span style={{ fontSize: 11, fontWeight: 600, color: "#9089a8" }}>
                    {t.len} · best on {t.best} · ~{fmtK(t.reach)} reach · ${t.cpm.toFixed(2)} CPM
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {step === 1 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: "#7a3ef0", background: "rgba(140,82,255,0.1)", borderRadius: 99, padding: "5px 13px" }}>
                {picked.length} of {MAX_CLIPS} picked
              </span>
              <span style={{ fontSize: 12.5, color: "#6b7280" }}>Highlighted ones suit {style.name}.</span>
              <span style={{ flex: 1 }} />
              <button onClick={() => setPicked(recommended.slice(0, MAX_CLIPS))} style={{ fontSize: 12.5, fontWeight: 600, color: "#8c52ff" }}>
                Pick the recommended ones
              </button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(158px,1fr))", gap: 12 }}>
              {edClipLib.map((c) => {
                const on = picked.includes(c.id);
                const rec = recommended.includes(c.id);
                const full = picked.length >= MAX_CLIPS && !on;
                return (
                  <button key={c.id} onClick={() => togglePick(c.id)} disabled={full} className={full ? "" : "cardLift"} style={{
                    position: "relative", display: "flex", flexDirection: "column", gap: 8, padding: 10,
                    borderRadius: 14, textAlign: "left", opacity: full ? 0.45 : 1,
                    background: on ? "rgba(140,82,255,0.06)" : "#fff",
                    boxShadow: on ? "0 0 0 2px rgba(140,82,255,0.5)" : "0 0 0 1px rgba(17,24,39,0.07)",
                  }}>
                    <div style={{ position: "relative", width: "100%", aspectRatio: "9/16", borderRadius: 10, overflow: "hidden", background: c.thumbBg }}>
                      <span style={{ position: "absolute", bottom: 6, right: 6, padding: "2px 6px", borderRadius: 5, background: "rgba(17,24,39,0.72)", color: "#fff", fontSize: 9.5, fontWeight: 700 }}>{c.len}</span>
                      {on && (
                        <span style={{
                          position: "absolute", top: 6, left: 6, display: "flex", alignItems: "center", justifyContent: "center",
                          width: 22, height: 22, borderRadius: "50%", background: "#8c52ff", color: "#fff",
                        }}><Icon name="check" size={12} /></span>
                      )}
                      {rec && !on && (
                        <span style={{ position: "absolute", top: 6, right: 6, padding: "2px 7px", borderRadius: 5, background: "rgba(245,149,18,0.94)", color: "#fff", fontSize: 9, fontWeight: 800, letterSpacing: "0.04em" }}>PICK</span>
                      )}
                    </div>
                    <span style={{ fontSize: 12.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.who}</span>
                    <span style={{ fontSize: 11, color: "#9ca3af" }}>{edKindLabel[c.kind]}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {step === 2 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.08em", color: "#9ca3af" }}>CAPTION FONT</span>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px,1fr))", gap: 12 }}>
                {FONTS.map((f) => {
                  const on = f.id === font;
                  return (
                    <button key={f.id} onClick={() => setFont(f.id)} style={{
                      display: "flex", flexDirection: "column", gap: 6, padding: "14px 16px", borderRadius: 14, textAlign: "left",
                      background: on ? "rgba(140,82,255,0.06)" : "#fff",
                      boxShadow: on ? "0 0 0 2px rgba(140,82,255,0.5)" : "0 0 0 1px rgba(17,24,39,0.07)",
                      transition: "box-shadow 0.18s ease, background 0.18s ease",
                    }}>
                      <span style={{ fontSize: 19, fontWeight: f.weight, letterSpacing: f.tracking, textTransform: f.caps as "none" | "uppercase" }}>Best pasta</span>
                      <span style={{ fontSize: 12, fontWeight: 600, color: on ? "#6f3bea" : "#9ca3af" }}>{f.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.08em", color: "#9ca3af" }}>LENGTH</span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                {LENGTHS.map((l) => {
                  const on = l.id === length;
                  return (
                    <button key={l.id} onClick={() => setLength(l.id)} style={{
                      display: "flex", flexDirection: "column", gap: 2, padding: "13px 20px", borderRadius: 14, textAlign: "left",
                      background: on ? "rgba(140,82,255,0.06)" : "#fff",
                      boxShadow: on ? "0 0 0 2px rgba(140,82,255,0.5)" : "0 0 0 1px rgba(17,24,39,0.07)",
                    }}>
                      <span style={{ fontSize: 17, fontWeight: 800, letterSpacing: "-0.02em", color: on ? "#6f3bea" : "#111827" }}>{l.label}</span>
                      <span style={{ fontSize: 11.5, color: "#9ca3af" }}>{l.note}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {step === 3 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {VOICES.map((v) => {
              const on = v.id === voice;
              return (
                <button key={v.id} onClick={() => setVoice(v.id)} style={{
                  display: "flex", alignItems: "center", gap: 14, padding: "15px 17px", borderRadius: 14, textAlign: "left",
                  background: on ? "rgba(140,82,255,0.06)" : "#fff",
                  boxShadow: on ? "0 0 0 2px rgba(140,82,255,0.5)" : "0 0 0 1px rgba(17,24,39,0.07)",
                }}>
                  <span style={{
                    display: "flex", alignItems: "center", justifyContent: "center", width: 34, height: 34,
                    borderRadius: 11, flex: "0 0 auto", color: on ? "#8c52ff" : "#9ca3af",
                    background: on ? "rgba(140,82,255,0.12)" : "#f5f5f9",
                  }}><Icon name={v.icon} size={17} /></span>
                  <span style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1, minWidth: 0 }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 13.5, fontWeight: 700, color: on ? "#6f3bea" : "#111827" }}>{v.label}</span>
                      {v.beta && <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.06em", color: "#b9700a", background: "rgba(245,149,18,0.15)", borderRadius: 99, padding: "2px 8px" }}>BETA</span>}
                    </span>
                    <span style={{ fontSize: 12, color: "#6b7280" }}>{v.note}</span>
                  </span>
                  {on && (
                    <span style={{
                      display: "flex", alignItems: "center", justifyContent: "center", width: 24, height: 24,
                      borderRadius: "50%", background: "#8c52ff", color: "#fff", flex: "0 0 auto",
                    }}><Icon name="check" size={13} /></span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 12, paddingTop: 6, borderTop: "1px solid #f1eff8" }}>
          <button onClick={() => (step === 0 ? reset() : setStep(step - 1))} className="btnQuiet" style={{ padding: "12px 20px", borderRadius: 12, fontSize: 13.5 }}>
            {step === 0 ? "Cancel" : "Back"}
          </button>
          <span style={{ flex: 1 }} />
          {nextHint && <span style={{ fontSize: 12.5, color: "#9ca3af" }}>{nextHint}</span>}
          <button
            onClick={() => (step === STEPS.length - 1 ? startRender("customize") : canAdvance && setStep(step + 1))}
            disabled={!canAdvance}
            className={canAdvance ? "btnPurple" : ""}
            style={{
              padding: "12px 24px", borderRadius: 12, fontSize: 13.5, fontWeight: 700,
              background: canAdvance ? undefined : "#f1f1f6",
              color: canAdvance ? "#fff" : "#c9c4d8",
              cursor: canAdvance ? "pointer" : "default",
              boxShadow: canAdvance ? "0 8px 20px rgba(140,82,255,0.28)" : "none",
            }}>
            {step === STEPS.length - 1 ? "Make the video" : "Next"}
          </button>
        </div>
      </div>
    </>
  );
}
