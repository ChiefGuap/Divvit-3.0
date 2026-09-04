"use client";

/* Screen a video before posting it — the CREATOR's screen.

   The creator uploads their own footage here and gets a verdict before it
   goes anywhere; the venue receives only what passes. Screening has to happen
   before the post because neither platform will hand the video back
   afterwards, so this is also where the fingerprint is taken that the claim
   flow later matches the posted cover against.

   Each gate reports separately: the verdict alone is not useful to a person,
   the gate that produced it is. */

import React from "react";
import { Icon, type IconName } from "@/lib/icons";
import { Card, EASE, PageHead, PurpleButton, QuietButton, fadeUp } from "@/lib/ui";

/** Mirrors services/intake/provenance.GateResult exactly. The first version
 *  of this file guessed `name`/`passed` and crashed the page on the real
 *  payload — the contract is `gate` and a four-valued `status`. */
type Gate = {
  gate: string;
  status: "pass" | "reject" | "review" | "skipped" | string;
  reason?: string;
  evidence?: Record<string, unknown>;
};

type Outcome = {
  submission_id?: string;
  verdict?: string;
  reasons?: string[];
  gates?: Gate[];
  screening?: Record<string, unknown> | null;
  progress?: string[];
  original_filename?: string;
  bytes?: number;
  error?: string;
  detail?: string;
};

const VERDICT_META: Record<string, { label: string; fg: string; bg: string; icon: IconName; blurb: string }> = {
  approved_for_collection: {
    label: "Approved", fg: "#0d7a4f", bg: "rgba(22,160,107,0.12)", icon: "check",
    blurb: "Every gate passed. This one reaches the Collection.",
  },
  needs_review: {
    label: "Needs review", fg: "#b9700a", bg: "rgba(245,149,18,0.15)", icon: "info",
    blurb: "Something could not be confirmed automatically. A human decides.",
  },
  rejected: {
    label: "Rejected", fg: "#b91c1c", bg: "rgba(220,38,38,0.12)", icon: "x",
    blurb: "A gate refused it outright. The reason is below.",
  },
  unscreenable: {
    label: "Unscreenable", fg: "#6b7280", bg: "rgba(107,114,128,0.12)", icon: "info",
    blurb: "The file itself could not be processed — not a judgement about content.",
  },
};

const GATE_LABEL: Record<string, string> = {
  fingerprint: "Fingerprint",
  duplicate_submission: "Duplicate check",
  public_corpus: "Ownership check",
  venue_verification: "Venue verification",
};

const GATE_BLURB: Record<string, string> = {
  fingerprint: "Frames sampled and hashed, so the same video can be recognised again after a re-encode.",
  duplicate_submission: "Compared against every previous submission.",
  public_corpus: "Compared against videos already harvested from the public web.",
  venue_verification: "Does the footage actually show the venue that was claimed?",
};

const GATE_STYLE: Record<string, { bg: string; fg: string; mark: string }> = {
  pass: { bg: "rgba(22,160,107,0.15)", fg: "#0d7a4f", mark: "✓" },
  reject: { bg: "rgba(220,38,38,0.12)", fg: "#b91c1c", mark: "✕" },
  review: { bg: "rgba(245,149,18,0.15)", fg: "#b9700a", mark: "!" },
  skipped: { bg: "var(--surface-sunken-2)", fg: "var(--text-faint)", mark: "–" },
};

function prettyGate(gate?: string): string {
  if (!gate) return "Gate";
  return GATE_LABEL[gate]
    ?? gate.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

export default function SubmitPage() {
  const [file, setFile] = React.useState<File | null>(null);
  const [submitter, setSubmitter] = React.useState("");
  const [business, setBusiness] = React.useState("");
  const [location, setLocation] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [elapsed, setElapsed] = React.useState(0);
  const [outcome, setOutcome] = React.useState<Outcome | null>(null);
  const [dragging, setDragging] = React.useState(false);

  React.useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [busy]);

  const canSubmit = Boolean(file && submitter.trim() && business.trim() && !busy);

  async function submit() {
    if (!file) return;
    setBusy(true);
    setElapsed(0);
    setOutcome(null);
    const body = new FormData();
    body.append("video", file);
    body.append("submitter", submitter.trim());
    body.append("business", business.trim());
    body.append("location", location.trim());
    try {
      const res = await fetch("/api/intake", { method: "POST", body });
      setOutcome(await res.json());
    } catch (err) {
      setOutcome({ error: err instanceof Error ? err.message : "upload failed" });
    } finally {
      setBusy(false);
    }
  }

  const meta = outcome?.verdict ? VERDICT_META[outcome.verdict] : null;

  return (
    <>
      <PageHead
        title="Screen your video"
        subtitle="Check it before you post. Duplicate, ownership, then venue verification."
      />

      <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 14,
                    padding: "9px 14px", borderRadius: 10, background: "var(--purple-tint)",
                    fontSize: 12.5, color: "var(--purple-deepest)", ...fadeUp("0.02s") }}>
        <Icon name="info" size={14} color="var(--purple-deep)" />
        <span>
          Creator screen — a preview of the app, hosted here until the app design lands.
          Screen the clip here first, then post it and claim.
        </span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(320px,1fr) minmax(340px,1.1fr)", gap: 18, alignItems: "start" }}>
        {/* ---------------------------------------------------------- form */}
        <Card style={{ padding: 22, display: "flex", flexDirection: "column", gap: 16, ...fadeUp("0.04s") }}>
          <label
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault(); setDragging(false);
              const f = e.dataTransfer.files?.[0];
              if (f) setFile(f);
            }}
            style={{
              display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
              padding: "30px 20px", borderRadius: 16, cursor: "pointer",
              border: `1.5px dashed ${dragging ? "var(--purple)" : "#ddd8ee"}`,
              background: dragging ? "var(--purple-tint)" : "var(--surface-sunken-3)",
              transition: `background 0.2s ${EASE}, border-color 0.2s ${EASE}`,
            }}>
            <input type="file" accept="video/*" style={{ display: "none" }}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            <Icon name="upload" size={22} color="var(--purple-deep)" />
            <span style={{ fontSize: 14, fontWeight: 650 }}>
              {file ? file.name : "Drop a video, or click to choose"}
            </span>
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
              {file ? `${(file.size / 1e6).toFixed(1)}MB` : "MP4, MOV or WebM · up to 200MB"}
            </span>
          </label>

          <Field label="Your creator id" value={submitter} onChange={setSubmitter}
            placeholder="user id or handle"
            hint="Who is claiming this video. Two people submitting the same clip is how theft is caught." />
          <Field label="Which venue is this about?" value={business} onChange={setBusiness}
            placeholder="Coffee Dose"
            hint="Verified against what the video actually shows, not taken on trust." />
          <Field label="Location" value={location} onChange={setLocation}
            placeholder="Costa Mesa" hint="Optional, but it disambiguates common cafe names." />

          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <PurpleButton onClick={submit} disabled={!canSubmit}
              style={{ opacity: canSubmit ? 1 : 0.5, cursor: canSubmit ? "pointer" : "not-allowed" }}>
              {busy ? `Screening… ${elapsed}s` : "Run the gates"}
            </PurpleButton>
            {(file || outcome) && !busy && (
              <QuietButton onClick={() => { setFile(null); setOutcome(null); }}>Clear</QuietButton>
            )}
          </div>
          {busy && (
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
              Local gates run first and are fast. Venue verification calls TwelveLabs
              and usually takes 10–40s.
            </span>
          )}
        </Card>

        {/* -------------------------------------------------------- result */}
        <Card style={{ padding: 22, display: "flex", flexDirection: "column", gap: 14, minHeight: 260, ...fadeUp("0.1s") }}>
          {!outcome && !busy && (
            <div style={{ margin: "auto", textAlign: "center", maxWidth: 300 }}>
              <Icon name="shield" size={26} color="var(--text-faintest)" />
              <p style={{ margin: "10px 0 0", fontSize: 13.5, color: "var(--text-muted)", lineHeight: 1.6 }}>
                Nothing screened yet. Each check reports separately, so a
                rejection tells you what to fix rather than just failing.
              </p>
            </div>
          )}

          {busy && (
            <div style={{ margin: "auto", textAlign: "center" }}>
              <span style={{ fontSize: 13.5, color: "var(--text-muted)" }}>Running the gates…</span>
            </div>
          )}

          {outcome?.error && (
            <div style={{ background: "rgba(220,38,38,0.08)", borderRadius: 12, padding: 14 }}>
              <strong style={{ fontSize: 13.5, color: "#b91c1c" }}>{outcome.error}</strong>
              {outcome.detail && (
                <pre style={{ margin: "8px 0 0", fontSize: 11, whiteSpace: "pre-wrap",
                              color: "var(--text-muted)", maxHeight: 180, overflow: "auto" }}>
                  {outcome.detail}
                </pre>
              )}
            </div>
          )}

          {meta && (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 7,
                               background: meta.bg, color: meta.fg, borderRadius: 99,
                               padding: "6px 14px", fontSize: 13, fontWeight: 700 }}>
                  <Icon name={meta.icon} size={14} color={meta.fg} />
                  {meta.label}
                </span>
                {outcome?.submission_id && (
                  <code style={{ fontSize: 11, color: "var(--text-faint)" }}>
                    {String(outcome.submission_id).slice(0, 8)}
                  </code>
                )}
              </div>
              <span style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6 }}>{meta.blurb}</span>

              {outcome?.reasons?.length ? (
                <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 5 }}>
                  {outcome.reasons.map((r, i) => (
                    <li key={i} style={{ fontSize: 13, color: "var(--ink)" }}>{r}</li>
                  ))}
                </ul>
              ) : null}

              <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 6,
                            borderTop: "1px solid var(--surface-sunken-2)" }}>
                <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.11em",
                               color: "var(--text-faint)" }}>GATES</span>
                {(outcome?.gates ?? []).map((g, i) => {
                  const st = GATE_STYLE[g.status] ?? GATE_STYLE.skipped;
                  return (
                    <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                      <span style={{
                        marginTop: 2, width: 16, height: 16, borderRadius: 99, flex: "0 0 auto",
                        display: "inline-flex", alignItems: "center", justifyContent: "center",
                        background: st.bg, color: st.fg, fontSize: 10, fontWeight: 800,
                      }}>{st.mark}</span>
                      <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                        <span style={{ fontSize: 13, fontWeight: 600 }}>{prettyGate(g.gate)}</span>
                        <span style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
                          {g.reason || GATE_BLURB[g.gate] || "No detail reported."}
                        </span>
                      </div>
                    </div>
                  );
                })}
                {!(outcome?.gates ?? []).length && (
                  <span style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
                    No gate detail returned.
                  </span>
                )}
              </div>
            </>
          )}
        </Card>
      </div>
    </>
  );
}

function Field({ label, value, onChange, placeholder, hint }: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; hint?: string;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <span style={{ fontSize: 12.5, fontWeight: 650 }}>{label}</span>
      <input value={value} placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        style={{
          border: "1px solid #e6e2f2", borderRadius: 10, padding: "9px 12px",
          fontSize: 13.5, outline: "none", background: "var(--surface)",
          fontFamily: "inherit", color: "var(--ink)",
        }} />
      {hint && <span style={{ fontSize: 11.5, color: "var(--text-muted)", lineHeight: 1.5 }}>{hint}</span>}
    </label>
  );
}
