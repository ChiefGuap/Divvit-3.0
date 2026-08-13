"use client";

/* Rewards — the catalog guests earn against.
   Three category columns; every card carries its own CPM against the $9.50
   paid benchmark. Create/edit opens a drawer. */

import React from "react";
import { useRouter } from "next/navigation";
import { Icon, type IconName } from "@/lib/icons";
import { useShell } from "@/components/Shell";
import {
  rewardList, rewardImage, subKinds, REWARD_PAID_BENCHMARK, fmtK,
  type Reward, type SubKind,
} from "@/lib/data";
import { EASE, PurpleButton, TabPair, fadeUp } from "@/lib/ui";

type Overrides = Record<string, Partial<Reward>>;
type Form = { name: string; cost: number; cap: number; sub: SubKind; live: boolean };

const cpmOf = (r: Reward) => r.value / (r.avgViews / 1000);

export default function RewardsPage() {
  const router = useRouter();
  const { toast } = useShell();
  const [overrides, setOverrides] = React.useState<Overrides>({});
  const [drawer, setDrawer] = React.useState(false);
  const [editing, setEditing] = React.useState<string | null>(null);
  const [form, setForm] = React.useState<Form>({ name: "", cost: 250, cap: 50, sub: "general", live: true });

  const all: Reward[] = rewardList.map((r) => ({ ...r, ...overrides[r.id] }));
  const claimed = all.reduce((a, r) => a + r.claimed, 0);
  const capacity = all.reduce((a, r) => a + r.cap, 0);
  const spend = all.reduce((t, r) => t + r.claimed * r.value, 0);
  const views = all.reduce((t, r) => t + r.claimed * r.avgViews, 0);
  const blended = spend / (views / 1000);
  const best = [...all].sort((a, b) => cpmOf(a) - cpmOf(b))[0];

  const stats = [
    { label: "Rewards live", value: String(all.filter((r) => r.live).length) },
    { label: "Claimed this month", value: String(claimed) },
    { label: "Still unclaimed", value: String(capacity - claimed) },
    { label: "Value issued", value: `$${Math.round(spend).toLocaleString()}` },
    { label: "Views it bought", value: fmtK(views) },
  ];

  const openNew = () => {
    setEditing(null);
    setForm({ name: "", cost: 250, cap: 50, sub: "general", live: true });
    setDrawer(true);
  };
  const openEdit = (r: Reward) => {
    setEditing(r.id);
    setForm({ name: r.name, cost: r.cost, cap: r.cap, sub: r.sub, live: r.live });
    setDrawer(true);
  };
  const save = () => {
    if (editing) {
      setOverrides((o) => ({ ...o, [editing]: { name: form.name, cost: form.cost, cap: form.cap, sub: form.sub, live: form.live } }));
      toast("Updated", form.name);
    } else {
      toast("Created", form.name || "a new reward");
    }
    setDrawer(false);
    setEditing(null);
  };

  return (
    <>
      <TabPair
        value="rewards"
        onChange={(v) => v === "campaigns" && router.push("/collection/campaigns")}
        style={{ alignSelf: "flex-start", animation: "dvFadeIn 0.4s ease backwards" }}
        options={[
          { value: "rewards", label: <><Icon name="gift" size={15} />Rewards</> },
          { value: "campaigns", label: <><Icon name="megaphone" size={15} />Campaigns</> },
        ]}
      />

      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap", ...fadeUp("0.05s", "0.5s") }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, letterSpacing: "-0.01em" }}>Rewards</h1>
          <p style={{ margin: 0, color: "#6b7280", fontSize: 13.5 }}>
            What a guest earns when their video lands. Keep them worth filming for.
          </p>
        </div>
        <PurpleButton onClick={openNew}><Icon name="plus" size={16} />New reward</PurpleButton>
      </div>

      {/* blended CPM summary */}
      <div style={{
        background: "linear-gradient(180deg,#f7f4fe,#f1ecfb)", border: "1px solid #e7dffb",
        borderRadius: 16, padding: "18px 22px", flex: "0 0 auto",
        display: "flex", flexDirection: "column", gap: 16, ...fadeUp("0.08s", "0.5s"),
      }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 28 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, flex: "0 0 auto" }}>
            <span style={{ fontSize: 40, fontWeight: 800, letterSpacing: "-0.03em", lineHeight: 1 }}>
              {Math.round((claimed / capacity) * 100)}%
            </span>
            <span style={{ fontSize: 14, color: "#6b7280" }}>claimed</span>
          </div>
          <div style={{ flex: 1, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
            {stats.map((t) => (
              <span key={t.label} style={{
                display: "inline-flex", alignItems: "center", gap: 7, fontSize: 13, fontWeight: 500,
                color: "#4b5563", border: "1px solid #e7dffb", background: "#fff", borderRadius: 8, padding: "5px 11px",
              }}>
                {t.label}<span style={{ color: "#9ca3af", fontWeight: 600 }}>{t.value}</span>
              </span>
            ))}
          </div>
        </div>
        <div style={{ height: 1, background: "#e7dffb" }} />
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 14 }}>
          <span style={{
            display: "flex", alignItems: "center", justifyContent: "center", width: 32, height: 32,
            borderRadius: 10, color: "#16a06b", background: "rgba(22,160,107,0.13)", flex: "0 0 auto",
          }}><Icon name="trendUp" size={16} /></span>
          <span style={{ display: "flex", flexDirection: "column", gap: 1 }}>
            <span style={{ fontSize: 13.5, fontWeight: 700 }}>{best.name} is your cheapest reach</span>
            <span style={{ fontSize: 12.5, color: "#6b7280" }}>
              ${cpmOf(best).toFixed(2)} per 1,000 views — {Math.round((1 - cpmOf(best) / REWARD_PAID_BENCHMARK) * 100)}% under what a paid post costs you.
            </span>
          </span>
          <span style={{ flex: 1 }} />
          <span style={{
            display: "inline-flex", alignItems: "baseline", gap: 7, padding: "8px 14px",
            borderRadius: 12, background: "#fff", boxShadow: "0 0 0 1px #e7dffb",
          }}>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", color: "#9ca3af" }}>BLENDED CPM</span>
            <span style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-0.03em", color: "#16a06b" }}>${blended.toFixed(2)}</span>
            <span style={{ fontSize: 11.5, color: "#9ca3af" }}>vs ${REWARD_PAID_BENCHMARK.toFixed(2)} paid</span>
          </span>
        </div>
      </div>

      {/* three category columns */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 16, paddingBottom: 8, alignItems: "start" }}>
        {(Object.keys(subKinds) as SubKind[]).map((key, gi) => {
          const k = subKinds[key];
          const items = all.filter((r) => r.sub === key);
          return (
            <div key={key} style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0, animation: `dvFadeUp 0.55s ${(0.1 + gi * 0.06).toFixed(2)}s ${EASE} backwards` }}>
              <div style={{
                display: "flex", alignItems: "center", gap: 11, padding: "12px 14px", borderRadius: 14,
                background: k.bg.replace(/[\d.]+\)$/, "0.06)"), boxShadow: `inset 0 0 0 1px ${k.bg}`,
              }}>
                <span style={{
                  display: "flex", alignItems: "center", justifyContent: "center", width: 32, height: 32,
                  borderRadius: 10, flex: "0 0 auto", color: k.fg, background: k.bg,
                }}><Icon name={k.iconKey as IconName} size={16} /></span>
                <span style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0, flex: 1 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 700, letterSpacing: "-0.01em" }}>{k.full}</span>
                  <span style={{ fontSize: 11.5, color: "#9ca3af", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{k.note}</span>
                </span>
              </div>

              {items.map((r) => {
                const cpm = cpmOf(r);
                const saved = Math.round((1 - cpm / REWARD_PAID_BENCHMARK) * 100);
                const good = cpm <= 3.2, ok = cpm <= 6;
                const fg = good ? "#16a06b" : ok ? "#8c52ff" : "#b9700a";
                const pct = Math.round((r.claimed / r.cap) * 100);
                return (
                  <button key={r.id} onClick={() => openEdit(r)} className="cardLift" style={{
                    background: "#fff", borderRadius: 18, overflow: "hidden", display: "flex",
                    flexDirection: "column", textAlign: "left",
                    boxShadow: "0 0 0 1px rgba(17,24,39,0.07), 0 4px 14px rgba(58,32,137,0.06)",
                  }}>
                    <div style={{ position: "relative", width: "100%", aspectRatio: "16/10", background: rewardImage[r.id] }}>
                      <span style={{
                        position: "absolute", top: 9, left: 9, padding: "4px 10px", borderRadius: 99,
                        background: r.live ? "rgba(214,250,232,0.95)" : "rgba(255,255,255,0.92)",
                        color: r.live ? "#0d7a4f" : "#6b7280", fontSize: 10, fontWeight: 800, letterSpacing: "0.06em",
                      }}>{r.live ? "LIVE" : "PAUSED"}</span>
                      <span style={{
                        position: "absolute", top: 9, right: 9, display: "inline-flex", alignItems: "center", gap: 5,
                        padding: "4px 10px", borderRadius: 99, background: "rgba(255,255,255,0.94)",
                        color: "#4b29b4", fontSize: 10.5, fontWeight: 800,
                      }}>
                        <Icon name={r.iconKey as IconName} size={11} />{r.cost === 0 ? "Free" : `${r.cost.toLocaleString()} pts`}
                      </span>
                    </div>

                    <div style={{ padding: "14px 15px 15px", display: "flex", flexDirection: "column", gap: 12 }}>
                      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                        <span style={{ fontSize: 15, fontWeight: 700, letterSpacing: "-0.01em" }}>{r.name}</span>
                        <span style={{ fontSize: 12, color: "#9ca3af" }}>{r.type} · ${r.value.toFixed(2).replace(/\.00$/, "")} a claim</span>
                      </div>

                      <div style={{
                        display: "flex", flexDirection: "column", gap: 8, padding: "12px 13px", borderRadius: 13,
                        background: good ? "rgba(22,160,107,0.07)" : ok ? "rgba(140,82,255,0.06)" : "rgba(245,149,18,0.08)",
                      }}>
                        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                          <span style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.035em", lineHeight: 1, color: fg }}>${cpm.toFixed(2)}</span>
                          <span style={{ fontSize: 11.5, fontWeight: 600, color: "#6b7280" }}>CPM · {saved}% under paid</span>
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                          <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
                            <span style={{ width: 36, fontSize: 9.5, fontWeight: 700, letterSpacing: "0.05em", color: fg, flex: "0 0 auto" }}>THIS</span>
                            <span style={{ flex: 1, height: 6, borderRadius: 99, background: "rgba(17,24,39,0.07)", overflow: "hidden" }}>
                              <span style={{ display: "block", height: "100%", width: `${Math.max(6, Math.round((cpm / REWARD_PAID_BENCHMARK) * 100))}%`, borderRadius: 99, background: fg }} />
                            </span>
                          </span>
                          <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
                            <span style={{ width: 36, fontSize: 9.5, fontWeight: 700, letterSpacing: "0.05em", color: "#b3aec4", flex: "0 0 auto" }}>PAID</span>
                            <span style={{ flex: 1, height: 6, borderRadius: 99, background: "rgba(17,24,39,0.07)", overflow: "hidden" }}>
                              <span style={{ display: "block", height: "100%", width: "100%", borderRadius: 99, background: "#d7d3e2" }} />
                            </span>
                          </span>
                        </div>
                        <span style={{ fontSize: 11.5, color: "#6b7280" }}>
                          {r.claimed} {r.claimed === 1 ? "claim" : "claims"} → {fmtK(r.claimed * r.avgViews)} views
                          {" for $"}{Math.round(r.claimed * r.value).toLocaleString()}
                        </span>
                      </div>

                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                          <span style={{ color: "#6b7280" }}>{r.claimed} of {r.cap} claimed</span>
                          <span style={{ fontWeight: 700 }}>{pct}%</span>
                        </div>
                        <div style={{ height: 6, borderRadius: 99, background: "#f1f1f6", overflow: "hidden" }}>
                          <div style={{ height: "100%", borderRadius: 99, background: r.fg, width: `${pct}%` }} />
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>

      {drawer && (
        <div onClick={() => setDrawer(false)} role="dialog" aria-modal style={{
          position: "absolute", inset: 0, zIndex: 80, display: "flex", justifyContent: "flex-end",
          background: "rgba(17,24,39,0.3)", backdropFilter: "blur(5px)", WebkitBackdropFilter: "blur(5px)",
          animation: "dvFadeIn 0.22s ease",
        }}>
          <div onClick={(e) => e.stopPropagation()} style={{
            width: 420, maxWidth: "100%", height: "100%", overflowY: "auto", padding: 28,
            display: "flex", flexDirection: "column", gap: 18,
            background: "linear-gradient(180deg, rgba(255,255,255,0.95), rgba(255,255,255,0.88))",
            backdropFilter: "blur(28px) saturate(160%)", WebkitBackdropFilter: "blur(28px) saturate(160%)",
            boxShadow: "-24px 0 60px rgba(40,22,89,0.22)",
            animation: `dvSlideIn 0.32s ${EASE}`,
          }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 14 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                <span style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: "0.09em", color: "#8c52ff" }}>
                  {editing ? "EDIT REWARD" : "NEW REWARD"}
                </span>
                <h2 style={{ margin: 0, fontSize: 21, fontWeight: 700, letterSpacing: "-0.02em" }}>
                  {editing ? "Tune it until it gets claimed." : "Make it worth filming for."}
                </h2>
              </div>
              <button onClick={() => setDrawer(false)} className="hoverInk" aria-label="Close" style={{ display: "flex", color: "#9ca3af", marginTop: 4 }}>
                <Icon name="x" size={18} />
              </button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: "#4b5563" }}>Which submissions earn it</span>
              {(Object.keys(subKinds) as SubKind[]).map((id) => {
                const k = subKinds[id];
                const on = form.sub === id;
                return (
                  <button key={id} onClick={() => setForm((f) => ({ ...f, sub: id }))} style={{
                    display: "flex", alignItems: "flex-start", gap: 11, padding: "13px 14px", borderRadius: 13, textAlign: "left",
                    background: on ? "rgba(140,82,255,0.07)" : "#fff",
                    boxShadow: on ? "0 0 0 1.5px rgba(140,82,255,0.5)" : "inset 0 0 0 1px rgba(17,24,39,0.10)",
                    transition: "box-shadow 0.18s ease, background 0.18s ease",
                  }}>
                    <Icon name={k.iconKey as IconName} size={16} color={on ? "#8c52ff" : "#9ca3af"} style={{ marginTop: 1 }} />
                    <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      <span style={{ fontSize: 13.5, fontWeight: 600, color: on ? "#111827" : "#4b5563" }}>{k.full}</span>
                      <span style={{ fontSize: 12, lineHeight: 1.45, color: on ? "#6b7280" : "#9ca3af" }}>{k.note}</span>
                    </span>
                  </button>
                );
              })}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <label htmlFor="rw-name" style={{ fontSize: 13, fontWeight: 600, color: "#4b5563" }}>What they get</label>
              <input id="rw-name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Free dessert on us"
                style={{
                  padding: "11px 13px", borderRadius: 11, border: "1.5px solid rgba(17,24,39,0.10)",
                  background: "#fff", fontFamily: "inherit", fontSize: 13.5, color: "#111827", outline: "none",
                }} />
            </div>

            <div style={{ display: "flex", gap: 12 }}>
              <Stepper label="Points to claim" value={form.cost === 0 ? "Free" : form.cost.toLocaleString()}
                onDown={() => setForm((f) => ({ ...f, cost: Math.max(0, f.cost - 50) }))}
                onUp={() => setForm((f) => ({ ...f, cost: f.cost + 50 }))} />
              <Stepper label="How many" value={String(form.cap)}
                onDown={() => setForm((f) => ({ ...f, cap: Math.max(1, f.cap - 5) }))}
                onUp={() => setForm((f) => ({ ...f, cap: f.cap + 5 }))} />
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: "#4b5563" }}>Status</span>
              <div style={{ display: "flex", gap: 8 }}>
                {([[true, "Live"], [false, "Paused"]] as const).map(([v, label]) => {
                  const on = form.live === v;
                  return (
                    <button key={label} onClick={() => setForm((f) => ({ ...f, live: v }))} style={{
                      flex: 1, padding: "10px 0", borderRadius: 11, fontSize: 13, fontWeight: 700,
                      color: on ? "#fff" : "#6b7280",
                      background: on ? (v ? "#16a06b" : "#9ca3af") : "#fff",
                      boxShadow: on ? "none" : "inset 0 0 0 1px rgba(17,24,39,0.10)",
                      transition: "background 0.18s ease, color 0.18s ease",
                    }}>{label}</button>
                  );
                })}
              </div>
            </div>

            <div style={{ display: "flex", gap: 11, padding: 14, borderRadius: 13, background: "rgba(245,149,18,0.10)" }}>
              <Icon name="info" size={16} color="#f59512" style={{ marginTop: 1 }} />
              <span style={{ fontSize: 12.5, lineHeight: 1.5, color: "#4b5563" }}>
                Rewards between 200 and 400 points get claimed most. Anything over 1,500 tends to sit.
              </span>
            </div>

            <div style={{ display: "flex", gap: 10, marginTop: "auto", paddingTop: 6 }}>
              <button onClick={save} className="btnPurple" style={{ flex: 1, padding: "12px 0", borderRadius: 11, fontSize: 13.5, boxShadow: "0 8px 20px rgba(140,82,255,0.26)" }}>
                {editing ? "Save changes" : "Create reward"}
              </button>
              <button onClick={() => setDrawer(false)} className="hoverInk" style={{
                padding: "12px 18px", borderRadius: 11, background: "rgba(17,24,39,0.05)",
                color: "#4b5563", fontSize: 13.5, fontWeight: 600,
              }}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Stepper({ label, value, onDown, onUp }: {
  label: string; value: string; onDown: () => void; onUp: () => void;
}) {
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
      <span style={{ fontSize: 13, fontWeight: 600, color: "#4b5563" }}>{label}</span>
      <div style={{
        display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", borderRadius: 11,
        background: "#fff", boxShadow: "inset 0 0 0 1.5px rgba(17,24,39,0.10)",
      }}>
        <button onClick={onDown} aria-label={`Decrease ${label}`} style={{
          display: "flex", alignItems: "center", justifyContent: "center", width: 28, height: 28,
          borderRadius: 8, background: "#f5f5f9", color: "#4b5563", fontSize: 17, fontWeight: 600, flex: "0 0 auto",
        }}>−</button>
        <span style={{ flex: 1, textAlign: "center", fontSize: 15, fontWeight: 700, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums" }}>{value}</span>
        <button onClick={onUp} aria-label={`Increase ${label}`} style={{
          display: "flex", alignItems: "center", justifyContent: "center", width: 28, height: 28,
          borderRadius: 8, background: "#f5f5f9", color: "#4b5563", fontSize: 17, fontWeight: 600, flex: "0 0 auto",
        }}>+</button>
      </div>
    </div>
  );
}
