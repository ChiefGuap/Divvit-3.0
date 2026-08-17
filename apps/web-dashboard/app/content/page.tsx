"use client";

/* Content Manager — the library of accepted content and what's been done with it.
   Counter tiles double as filters; every row expands in place to show metrics. */

import React from "react";
import { Icon, type IconName } from "@/lib/icons";
import { useShell } from "@/components/Shell";
import { cmVideos, cmUsage, cmEditorCuts, cmTopPerformers, cmMetricsFor } from "@/lib/data";
import { EASE, PlayBadge, TabPair, fadeUp } from "@/lib/ui";

type Bucket = "all" | "ready" | "used" | "cuts";

export default function ContentManagerPage() {
  const { toast } = useShell();
  const [tab, setTab] = React.useState<"library" | "archive">("library");
  const [bucket, setBucket] = React.useState<Bucket>("all");
  const [published, setPublished] = React.useState<string[]>(["Amir Khan", "Maya Sørensen"]);
  const [archived, setArchived] = React.useState<string[]>(["Devon Park"]);
  const [metricsOpen, setMetricsOpen] = React.useState<Record<string, boolean>>({});
  const [menuOpen, setMenuOpen] = React.useState<string | null>(null);

  const live = cmVideos.filter((v) => !archived.includes(v.creator));
  const ready = live.filter((v) => !published.includes(v.creator));
  const used = live.filter((v) => published.includes(v.creator));
  const archivedRows = cmVideos.filter((v) => archived.includes(v.creator));

  const toggleMetrics = (id: string) => setMetricsOpen((m) => ({ ...m, [id]: !m[id] }));

  const publish = (creator: string) => {
    setPublished((p) => [...p, creator]);
    toast("Published", creator);
  };
  const archive = (creator: string) => {
    setArchived((a) => [...a, creator]);
    setMenuOpen(null);
    toast("Archived", creator);
  };
  const activate = (creator: string) => {
    setArchived((a) => a.filter((c) => c !== creator));
    toast("Restored", creator);
  };

  const TILES: { key: Bucket; label: string; note: string; count: number; icon: IconName; fg: string; iconBg: string }[] = [
    { key: "ready", label: "Ready to post", note: "Accepted, not published yet", count: ready.length, icon: "upload", fg: "#8c52ff", iconBg: "rgba(140,82,255,0.12)" },
    { key: "used", label: "Already used", note: "Posted somewhere, reusable", count: used.length, icon: "check", fg: "#16a06b", iconBg: "rgba(22,160,107,0.12)" },
    { key: "cuts", label: "Divvit Editor cuts", note: "Made in the Editor", count: cmEditorCuts.length, icon: "wand", fg: "#f59512", iconBg: "rgba(245,149,18,0.14)" },
  ];

  const show = (b: Bucket) => bucket === "all" || bucket === b;

  return (
    <>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap", ...fadeUp("0.05s", "0.5s") }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, letterSpacing: "-0.01em" }}>Content Manager</h1>
          <p style={{ margin: 0, color: "#6b7280", fontSize: 13.5 }}>Your hub to manage all inflow and outflow of Content</p>
        </div>
        <TabPair value={tab} onChange={(v) => setTab(v as "library" | "archive")}
          options={[{ value: "library", label: "Library" }, { value: "archive", label: "Archive" }]} />
      </div>

      {tab === "library" ? (
        <>
          {/* top performers */}
          <div style={{
            background: "#fff", borderRadius: 18, padding: "18px 20px", display: "flex",
            flexDirection: "column", gap: 14, flex: "0 0 auto",
            boxShadow: "0 0 0 1px rgba(17,24,39,0.07), 0 2px 6px rgba(58,32,137,0.05)",
            ...fadeUp("0.06s", "0.5s"),
          }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <span style={{ fontWeight: 700, fontSize: 14.5 }}>Top performers</span>
              <span style={{ fontSize: 12.5, color: "#9ca3af" }}>Best of everything you&apos;ve published, creator pages included</span>
            </div>
            <div className="scrollThin" style={{ display: "flex", gap: 14, overflowX: "auto", paddingBottom: 4 }}>
              {cmTopPerformers.map((t) => (
                <div key={t.rank} style={{
                  flex: "0 0 218px", borderRadius: 14, background: "#f4f2fb", overflow: "hidden",
                  display: "flex", flexDirection: "column",
                  boxShadow: "0 0 0 1px rgba(17,24,39,0.07), 0 2px 6px rgba(58,32,137,0.05)",
                }}>
                  <div style={{ position: "relative", aspectRatio: "16/10", background: t.thumbBg, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <span style={{
                      position: "absolute", top: 8, left: 8, width: 24, height: 24, borderRadius: 8,
                      background: "rgba(17,24,39,0.7)", color: "#fff", display: "flex",
                      alignItems: "center", justifyContent: "center", fontSize: 11.5, fontWeight: 700,
                    }}>{t.rank}</span>
                    <PlayBadge size={34} />
                  </div>
                  <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 1 }}>
                    <span style={{ fontWeight: 600, fontSize: 12.5 }}>{t.creator}</span>
                    <span style={{ fontSize: 11.5, color: "#9ca3af" }}>{t.views} views · {t.platform}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* counter tiles double as filters */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 14, flex: "0 0 auto", ...fadeUp("0.1s", "0.5s") }}>
            {TILES.map((t) => {
              const on = bucket === t.key;
              return (
                <button key={t.key} onClick={() => setBucket(on ? "all" : t.key)} className="hoverWhite" style={{
                  display: "flex", alignItems: "center", gap: 14, padding: "16px 18px", borderRadius: 16,
                  textAlign: "left", background: on ? "#ffffff" : "rgba(255,255,255,0.6)",
                  boxShadow: on
                    ? "0 0 0 1.5px rgba(140,82,255,0.45), 0 10px 24px rgba(58,32,137,0.10)"
                    : "0 0 0 1px rgba(17,24,39,0.07), 0 2px 6px rgba(58,32,137,0.05)",
                  transition: "box-shadow 0.18s ease, background 0.18s ease",
                }}>
                  <span style={{
                    display: "flex", alignItems: "center", justifyContent: "center", width: 38, height: 38,
                    borderRadius: 12, flex: "0 0 auto", color: t.fg, background: t.iconBg,
                  }}>
                    <Icon name={t.icon} size={19} />
                  </span>
                  <span style={{ display: "flex", flexDirection: "column", gap: 1, flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 700 }}>{t.label}</span>
                    <span style={{ fontSize: 11.5, color: "#9ca3af", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.note}</span>
                  </span>
                  <span style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-0.03em", color: t.fg, flex: "0 0 auto" }}>{t.count}</span>
                </button>
              );
            })}
          </div>

          {/* ready to post */}
          {show("ready") && (
            <Section title="Ready to post" note="Accepted — not published anywhere yet" dot="#8c52ff" delay="0.16s">
              {ready.length === 0 && <Empty>Nothing waiting. Accept a video in The Collection and it lands here.</Empty>}
              {ready.map((r) => (
                <Row key={r.creator}
                  thumbBg={r.thumbBg}
                  title={r.creator}
                  meta={`${r.meta}${r.fileSize ? ` · ${r.fileSize}` : ""}`}
                  bg="rgba(140,82,255,0.05)"
                  hoverClass="hoverRowPurple"
                  status={{ label: "Ready", fg: "#6f3bea", bg: "rgba(140,82,255,0.12)" }}
                  actions={
                    <>
                      <button onClick={() => publish(r.creator)} className="btnPurple" style={{ padding: "7px 14px", fontSize: 12.5 }}>Publish</button>
                      <button onClick={() => toast("Downloading", r.creator)} className="btnQuiet" style={{ padding: "7px 14px" }}>Download</button>
                      <button onClick={() => archive(r.creator)} className="btnQuiet btnDanger" style={{ padding: "7px 14px", color: "#9ca3af" }}>Archive</button>
                    </>
                  }
                />
              ))}
            </Section>
          )}

          {/* already used */}
          {show("used") && (
            <Section title="Already used" note="Posted somewhere already — every one can be run again" dot="#16a06b" delay="0.22s">
              {used.length === 0 && <Empty>Nothing published yet. Hit Publish on a ready video and it moves here.</Empty>}
              {used.map((r) => {
                const usage = cmUsage[r.creator] ?? { n: 1, last: "recently", where: "Instagram" };
                const open = !!metricsOpen[r.creator];
                return (
                  <div key={r.creator} style={{ display: "flex", flexDirection: "column" }}>
                    <div className="hoverRowMint" style={{
                      display: "flex", alignItems: "center", gap: 14, padding: "11px 12px", marginTop: 4,
                      background: "rgba(22,160,107,0.05)", borderRadius: 11,
                    }}>
                      <div style={{ position: "relative", width: 78, aspectRatio: "16/10", borderRadius: 9, overflow: "hidden", background: r.thumbBg, flex: "0 0 auto", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <span style={{ position: "absolute", inset: 0, background: "rgba(17,24,39,0.34)" }} />
                        <span style={{
                          position: "relative", display: "flex", alignItems: "center", justifyContent: "center",
                          width: 22, height: 22, borderRadius: "50%", background: "rgba(255,255,255,0.94)", color: "#0d7a4f",
                        }}><Icon name="check" size={12} /></span>
                        <span style={{
                          position: "absolute", left: 0, right: 0, bottom: 0, padding: "2px 0", textAlign: "center",
                          background: "rgba(13,122,79,0.94)", color: "#fff", fontSize: 8.5, fontWeight: 800, letterSpacing: "0.08em",
                        }}>USED {usage.n}×</span>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1, minWidth: 0 }}>
                        <span style={{ fontWeight: 600, fontSize: 13.5 }}>{r.creator}</span>
                        <span style={{ fontSize: 12, fontWeight: 600, color: "#0d7a4f" }}>Last used {usage.last} · {usage.where}</span>
                      </div>
                      <span style={{ fontSize: 11.5, fontWeight: 700, color: "#0d7a4f", background: "rgba(22,160,107,0.12)", borderRadius: 99, padding: "4px 11px", flex: "0 0 auto" }}>Reusable</span>
                      <div style={{ display: "flex", gap: 8, flex: "0 0 auto", alignItems: "center" }}>
                        <button onClick={() => toggleMetrics(r.creator)} className="btnQuiet" style={{ padding: "7px 14px" }}>{open ? "Hide metrics" : "Metrics"}</button>
                        <button onClick={() => toast("Queued again", r.creator)} className="btnPurple" style={{ padding: "7px 14px", fontSize: 12.5 }}>Use again</button>
                        <div style={{ position: "relative", flex: "0 0 auto" }}>
                          <button onClick={() => setMenuOpen(menuOpen === r.creator ? null : r.creator)} className="btnQuiet" aria-label="More" style={{ width: 34, padding: "7px 0", justifyContent: "center", color: "#6b7280" }}>
                            <Icon name="more" size={15} />
                          </button>
                          {menuOpen === r.creator && (
                            <div style={{
                              position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 20, width: 172,
                              background: "#fff", borderRadius: 12, padding: 5, display: "flex", flexDirection: "column", gap: 1,
                              boxShadow: "0 0 0 1px rgba(17,24,39,0.07), 0 8px 20px rgba(17,24,39,0.10)",
                            }}>
                              <button className="menuItemPurpleTint" onClick={() => setMenuOpen(null)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 11px", borderRadius: 8, fontSize: 13, fontWeight: 500, color: "#374151" }}>
                                <Icon name="settings" size={16} color="#8c52ff" />Edit
                              </button>
                              <button className="menuItemPurpleTint" onClick={() => { setMenuOpen(null); toast("Downloading", r.creator); }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 11px", borderRadius: 8, fontSize: 13, fontWeight: 500, color: "#374151" }}>
                                <Icon name="download" size={16} color="#8c52ff" />Download video
                              </button>
                              <button className="menuItemDanger" onClick={() => archive(r.creator)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 11px", borderRadius: 8, fontSize: 13, fontWeight: 500, color: "#ef4444" }}>
                                <Icon name="trash" size={16} />Delete
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                    {open && <MetricsStrip id={r.creator} />}
                  </div>
                );
              })}
            </Section>
          )}

          {/* editor cuts */}
          {show("cuts") && (
            <Section title="Divvit Editor cuts" note="Made in the Editor and posted — tracked like any other post" dot="#f59512" delay="0.28s">
              {cmEditorCuts.map((r) => {
                const open = !!metricsOpen[r.id];
                return (
                  <div key={r.id} style={{ display: "flex", flexDirection: "column" }}>
                    <div onClick={() => toggleMetrics(r.id)} style={{
                      display: "flex", alignItems: "center", gap: 14, padding: "11px 12px", marginTop: 4,
                      background: "rgba(245,149,18,0.06)", cursor: "pointer", borderRadius: 11,
                    }}>
                      <div style={{ position: "relative", width: 52, aspectRatio: "9/16", borderRadius: 9, overflow: "hidden", flex: "0 0 auto", background: r.thumbBg }} />
                      <div style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <span style={{ fontWeight: 600, fontSize: 13.5 }}>{r.title}</span>
                          <span style={{
                            display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10.5, fontWeight: 700,
                            color: "#b9700a", background: "rgba(245,149,18,0.15)", borderRadius: 6, padding: "3px 8px",
                          }}>
                            <Icon name="wand" size={12} />{r.style}
                          </span>
                        </div>
                        <span style={{ fontSize: 12, color: "#9ca3af" }}>{r.posted} · {r.clips} clips</span>
                      </div>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 18, flex: "0 0 auto" }}>
                        <span style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.07em", color: "#9ca3af" }}>VIEWS</span>
                          <span style={{ fontSize: 16, fontWeight: 800, letterSpacing: "-0.02em" }}>{r.views}</span>
                        </span>
                        <span style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.07em", color: "#9ca3af" }}>CPM</span>
                          <span style={{ fontSize: 16, fontWeight: 800, letterSpacing: "-0.02em", color: "#16a06b" }}>{r.cpm}</span>
                        </span>
                      </div>
                      <div style={{ display: "flex", gap: 8, flex: "0 0 auto" }} onClick={(e) => e.stopPropagation()}>
                        <button onClick={() => toggleMetrics(r.id)} className="btnQuiet" style={{ padding: "7px 14px" }}>{open ? "Hide metrics" : "Metrics"}</button>
                        <button onClick={() => toast("Downloading", r.title)} className="btnQuiet" style={{ padding: "7px 14px" }}>Download</button>
                      </div>
                    </div>
                    {open && <MetricsStrip id={r.id} />}
                  </div>
                );
              })}
            </Section>
          )}
        </>
      ) : (
        <div style={{
          background: "#fff", borderRadius: 18, padding: 20, display: "flex", flexDirection: "column",
          gap: 4, flex: "0 0 auto",
          boxShadow: "0 0 0 1px rgba(17,24,39,0.07), 0 2px 6px rgba(58,32,137,0.05)",
          animation: `dvFadeUp 0.55s 0.15s ${EASE} backwards`,
        }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, paddingBottom: 10 }}>
            <span style={{ fontWeight: 600, fontSize: 14.5 }}>Archived videos</span>
            <span style={{
              display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: 20, height: 20,
              padding: "0 6px", borderRadius: 10, background: "#f1eff8", color: "#6b7280",
              fontSize: 11.5, fontWeight: 700, alignSelf: "center",
            }}>{archivedRows.length}</span>
            <span style={{ fontSize: 12, color: "#9ca3af", fontWeight: 500 }}>Kept for 14 days, then removed permanently</span>
          </div>
          {archivedRows.length === 0 && <Empty>Nothing archived. Videos you archive from the Library will show up here.</Empty>}
          {archivedRows.map((r) => (
            <div key={r.creator} style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 8px", borderTop: "1px solid #f1eff8" }}>
              <div style={{ width: 72, aspectRatio: "16/10", borderRadius: 8, background: r.thumbBg, flex: "0 0 auto", opacity: 0.6 }} />
              <div style={{ display: "flex", flexDirection: "column", gap: 1, flex: 1, minWidth: 0 }}>
                <span style={{ fontWeight: 600, fontSize: 13.5, color: "#6b7280" }}>{r.creator}</span>
                <span style={{ fontSize: 12, color: "#9ca3af" }}>{r.meta}</span>
              </div>
              <span style={{ fontSize: 11.5, fontWeight: 600, color: "#ef4444", background: "rgba(239,68,68,0.09)", borderRadius: 99, padding: "4px 11px", flex: "0 0 auto" }}>
                {r.archivedDays} days left
              </span>
              <button onClick={() => activate(r.creator)} className="btnPurple" style={{ padding: "7px 14px", fontSize: 12.5, flex: "0 0 auto" }}>Activate</button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function Section({ title, note, dot, delay, children }: {
  title: string; note: string; dot: string; delay: string; children: React.ReactNode;
}) {
  return (
    <div style={{
      background: "#fff", borderRadius: 18, padding: "18px 20px 14px", display: "flex",
      flexDirection: "column", gap: 6, flex: "0 0 auto",
      boxShadow: "0 0 0 1px rgba(17,24,39,0.07), 0 2px 6px rgba(58,32,137,0.05)",
      animation: `dvFadeUp 0.5s ${delay} ${EASE} backwards`,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, paddingBottom: 8, borderBottom: "1px solid #f1eff8" }}>
        <span style={{ width: 9, height: 9, borderRadius: 3, background: dot, flex: "0 0 auto" }} />
        <span style={{ fontWeight: 700, fontSize: 14.5 }}>{title}</span>
        <span style={{ fontSize: 12.5, color: "#9ca3af" }}>{note}</span>
      </div>
      {children}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div style={{ padding: "26px 0", textAlign: "center", color: "#9ca3af", fontSize: 13 }}>{children}</div>;
}

function Row({ thumbBg, title, meta, bg, hoverClass, status, actions }: {
  thumbBg: string; title: string; meta: string; bg: string; hoverClass: string;
  status: { label: string; fg: string; bg: string };
  actions: React.ReactNode;
}) {
  return (
    <div className={hoverClass} style={{
      display: "flex", alignItems: "center", gap: 14, padding: "11px 12px",
      marginTop: 4, background: bg, borderRadius: 11,
    }}>
      <div style={{ width: 78, aspectRatio: "16/10", borderRadius: 9, background: thumbBg, flex: "0 0 auto", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff" }}>
        <Icon name="play" size={13} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1, minWidth: 0 }}>
        <span style={{ fontWeight: 600, fontSize: 13.5 }}>{title}</span>
        <span style={{ fontSize: 12, color: "#9ca3af" }}>{meta}</span>
      </div>
      <span style={{ fontSize: 11.5, fontWeight: 700, color: status.fg, background: status.bg, borderRadius: 99, padding: "4px 11px", flex: "0 0 auto" }}>{status.label}</span>
      <div style={{ display: "flex", gap: 8, flex: "0 0 auto" }}>{actions}</div>
    </div>
  );
}

function MetricsStrip({ id }: { id: string }) {
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(118px,1fr))", gap: 14,
      margin: "0 2px 6px", padding: "14px 16px", borderRadius: 12, background: "#faf9fd",
      boxShadow: "inset 0 0 0 1px rgba(17,24,39,0.06)", animation: "dvFadeIn 0.2s ease",
    }}>
      {cmMetricsFor(id).map((m) => (
        <div key={m.label} style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", color: "#9ca3af" }}>{m.label}</span>
          <span style={{ fontSize: 19, fontWeight: 800, letterSpacing: "-0.025em", color: m.fg }}>{m.value}</span>
          <span style={{ fontSize: 11, color: "#9ca3af" }}>{m.note}</span>
        </div>
      ))}
    </div>
  );
}
