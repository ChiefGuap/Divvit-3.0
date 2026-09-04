"use client";

/* Claim a reward against a posted link.

   The five gates tick in order, and the post plays alongside them. That
   pairing is the point: a rejection is only actionable if you can see the
   post it is about. */

import React from "react";
import { Icon, type IconName } from "@/lib/icons";
import { Card, EASE, PageHead, PurpleButton, QuietButton, fadeUp } from "@/lib/ui";

type Gate = {
  gate: string;
  status: "pass" | "soft" | "fail" | "no_data" | "retry" | "skipped" | string;
  reason?: string;
  evidence?: Record<string, unknown>;
  diner_message?: string;
};

type Post = {
  handle?: string;
  author_name?: string;
  caption?: string | null;
  thumbnail_url?: string | null;
  embed_html?: string | null;
  created_at?: string | null;
  created_at_source?: string;
  video_id?: string;
};

type Claim = {
  verdict?: string;
  tier?: number;
  gates?: Gate[];
  post?: Post | null;
  soft_passes?: string[];
  diner_message?: string;
  screened?: boolean;
  claim_id?: string;
  duplicate_of?: string;
  error?: string;
  detail?: string;
};

const VERDICT: Record<string, { label: string; fg: string; bg: string; icon: IconName }> = {
  auto_approve:      { label: "Approved",        fg: "#0d7a4f", bg: "rgba(22,160,107,0.12)", icon: "check" },
  auto_approve_soft: { label: "Approved",        fg: "#0d7a4f", bg: "rgba(22,160,107,0.12)", icon: "check" },
  hold_for_review:   { label: "In review",       fg: "#b9700a", bg: "rgba(245,149,18,0.15)", icon: "info" },
  reject:            { label: "Not eligible",    fg: "#b91c1c", bg: "rgba(220,38,38,0.12)",  icon: "x" },
  retry:             { label: "Trying again",    fg: "#4b5563", bg: "rgba(107,114,128,0.12)", icon: "info" },
};

/* Five steps, in the order they run. The diner sees these names — never the
   gate names. "Ownership" and "Content match" read as accusations; these read
   as housekeeping. */
const STEP_LABEL: Record<string, string> = {
  resolve:       "Finding your post",
  ownership:     "Matching your account",
  window:        "Checking the timing",
  content_match: "Confirming your video",
  screening:     "Reviewing your video",
};

const STATUS_STYLE: Record<string, { bg: string; fg: string; mark: string; note: string }> = {
  pass:    { bg: "rgba(22,160,107,0.15)", fg: "#0d7a4f", mark: "✓", note: "" },
  soft:    { bg: "rgba(22,160,107,0.15)", fg: "#0d7a4f", mark: "✓", note: "" },
  fail:    { bg: "rgba(220,38,38,0.12)",  fg: "#b91c1c", mark: "✕", note: "" },
  no_data: { bg: "rgba(245,149,18,0.15)", fg: "#b9700a", mark: "?", note: "We'll take a look" },
  retry:   { bg: "rgba(107,114,128,0.12)", fg: "#6b7280", mark: "…", note: "" },
  skipped: { bg: "var(--surface-sunken-2)", fg: "var(--text-faint)", mark: "–", note: "" },
};

const TIER_LABEL: Record<number, string> = {
  1: "500 points", 2: "Free drip coffee", 3: "Free pastry + drink", 4: "Free entrée",
};

export default function ClaimPage() {
  const [url, setUrl] = React.useState("");
  const [submitter, setSubmitter] = React.useState("");
  const [handle, setHandle] = React.useState("");
  const [tier, setTier] = React.useState(2);
  const [connected, setConnected] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [claim, setClaim] = React.useState<Claim | null>(null);
  const [staff, setStaff] = React.useState(false);

  const canSubmit = Boolean(url.trim() && submitter.trim() && handle.trim() && !busy);

  async function submit() {
    setBusy(true);
    setClaim(null);
    try {
      const res = await fetch("/api/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: url.trim(), submitter: submitter.trim(),
                               handle: handle.trim(), tier, connected }),
      });
      setClaim(await res.json());
    } catch (err) {
      setClaim({ error: err instanceof Error ? err.message : "request failed" });
    } finally {
      setBusy(false);
    }
  }

  const meta = claim?.verdict ? VERDICT[claim.verdict] : null;
  const post = claim?.post ?? null;

  return (
    <>
      <PageHead
        title="Claim a reward"
        subtitle="Paste the link to your post. Five checks run in about two seconds."
        action={
          <QuietButton onClick={() => setStaff((s) => !s)}>
            {staff ? "Diner view" : "Staff view"}
          </QuietButton>
        }
      />

      <div style={{ display: "grid", gridTemplateColumns: "minmax(300px,0.9fr) minmax(320px,1fr) minmax(260px,0.8fr)",
                    gap: 18, alignItems: "start" }}>
        {/* ---------------------------------------------------------- form */}
        <Card style={{ padding: 22, display: "flex", flexDirection: "column", gap: 15, ...fadeUp("0.04s") }}>
          <Field label="Your post link" value={url} onChange={setUrl}
            placeholder="https://www.tiktok.com/@you/video/…"
            hint="TikTok works from a pasted link. Instagram needs a connected account." />
          <Field label="Diner" value={submitter} onChange={setSubmitter} placeholder="user id" />
          <Field label="TikTok handle on file" value={handle} onChange={setHandle}
            placeholder="@yourhandle"
            hint="Checked against the post's author." />

          <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <span style={{ fontSize: 12.5, fontWeight: 650 }}>Reward tier</span>
            <select value={tier} onChange={(e) => setTier(Number(e.target.value))}
              style={{ border: "1px solid #e6e2f2", borderRadius: 10, padding: "9px 12px",
                       fontSize: 13.5, background: "var(--surface)", fontFamily: "inherit",
                       color: "var(--ink)" }}>
              {[1, 2, 3, 4].map((t) => (
                <option key={t} value={t}>Tier {t} — {TIER_LABEL[t]}</option>
              ))}
            </select>
            <span style={{ fontSize: 11.5, color: "var(--text-muted)", lineHeight: 1.5 }}>
              Higher tiers hold anything that isn&apos;t fully proven, rather than paying it out.
            </span>
          </label>

          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5 }}>
            <input type="checkbox" checked={connected}
              onChange={(e) => setConnected(e.target.checked)} />
            <span>Account connected via TikTok Login</span>
          </label>

          <div style={{ display: "flex", gap: 10 }}>
            <PurpleButton onClick={submit} disabled={!canSubmit}
              style={{ opacity: canSubmit ? 1 : 0.5, cursor: canSubmit ? "pointer" : "not-allowed" }}>
              {busy ? "Checking…" : "Claim reward"}
            </PurpleButton>
            {claim && !busy && <QuietButton onClick={() => setClaim(null)}>Clear</QuietButton>}
          </div>
        </Card>

        {/* -------------------------------------------------------- result */}
        <Card style={{ padding: 22, display: "flex", flexDirection: "column", gap: 14,
                       minHeight: 280, ...fadeUp("0.1s") }}>
          {!claim && !busy && (
            <div style={{ margin: "auto", textAlign: "center", maxWidth: 280 }}>
              <Icon name="shield" size={26} color="var(--text-faintest)" />
              <p style={{ margin: "10px 0 0", fontSize: 13.5, color: "var(--text-muted)", lineHeight: 1.6 }}>
                Paste a link to see the checks run. They stop at the first
                problem, so a private post never reaches the expensive ones.
              </p>
            </div>
          )}

          {busy && (
            <div style={{ display: "flex", flexDirection: "column", gap: 11, margin: "auto 0" }}>
              {Object.values(STEP_LABEL).map((label, i) => (
                <div key={label} style={{ display: "flex", alignItems: "center", gap: 10,
                                          opacity: 0.45, animation: `pulse 1.4s ${EASE} ${i * 0.12}s infinite` }}>
                  <span style={{ width: 16, height: 16, borderRadius: 99,
                                 background: "var(--surface-sunken-2)" }} />
                  <span style={{ fontSize: 13 }}>{label}</span>
                </div>
              ))}
              <style>{`@keyframes pulse{0%,100%{opacity:.35}50%{opacity:.75}}`}</style>
            </div>
          )}

          {claim?.error && (
            <div style={{ background: "rgba(220,38,38,0.08)", borderRadius: 12, padding: 14 }}>
              <strong style={{ fontSize: 13.5, color: "#b91c1c" }}>{claim.error}</strong>
              {claim.detail && (
                <pre style={{ margin: "8px 0 0", fontSize: 11, whiteSpace: "pre-wrap",
                              color: "var(--text-muted)", maxHeight: 160, overflow: "auto" }}>
                  {claim.detail}
                </pre>
              )}
            </div>
          )}

          {meta && (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 7,
                               background: meta.bg, color: meta.fg, borderRadius: 99,
                               padding: "6px 14px", fontSize: 13, fontWeight: 700 }}>
                  <Icon name={meta.icon} size={14} color={meta.fg} />
                  {meta.label}
                </span>
                {claim?.tier && (
                  <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                    Tier {claim.tier} · {TIER_LABEL[claim.tier]}
                  </span>
                )}
              </div>

              <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: "var(--ink)" }}>
                {claim?.diner_message}
              </p>

              <div style={{ display: "flex", flexDirection: "column", gap: 9, paddingTop: 8,
                            borderTop: "1px solid var(--surface-sunken-2)" }}>
                {(claim?.gates ?? []).map((g, i) => {
                  const st = STATUS_STYLE[g.status] ?? STATUS_STYLE.skipped;
                  const label = STEP_LABEL[g.gate] ?? g.gate;
                  return (
                    <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                      <span style={{ marginTop: 2, width: 16, height: 16, borderRadius: 99,
                                     flex: "0 0 auto", display: "inline-flex",
                                     alignItems: "center", justifyContent: "center",
                                     background: st.bg, color: st.fg, fontSize: 10, fontWeight: 800 }}>
                        {st.mark}
                      </span>
                      <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                        <span style={{ fontSize: 13, fontWeight: 600,
                                       color: g.status === "skipped" ? "var(--text-faint)" : "var(--ink)" }}>
                          {label}
                        </span>
                        {/* Staff see the engine's own reason. Diners see only
                            the line written for them — no gate names, no
                            scores, because those are what a fraudster would
                            calibrate against. */}
                        {staff && g.reason && (
                          <span style={{ fontSize: 11.5, color: "var(--text-muted)",
                                         lineHeight: 1.5, fontFamily: "ui-monospace, monospace" }}>
                            {g.reason}
                          </span>
                        )}
                        {!staff && g.status === "no_data" && st.note && (
                          <span style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{st.note}</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {staff && (
                <div style={{ fontSize: 11.5, color: "var(--text-muted)", paddingTop: 8,
                              borderTop: "1px solid var(--surface-sunken-2)", lineHeight: 1.7 }}>
                  <div>verdict <code>{claim?.verdict}</code></div>
                  {claim?.soft_passes?.length ? (
                    <div>soft passes <code>{claim.soft_passes.join(", ")}</code></div>
                  ) : null}
                  <div>screened in-app <code>{String(claim?.screened)}</code></div>
                  {claim?.claim_id && <div>claim <code>{claim.claim_id}</code></div>}
                  {claim?.duplicate_of && <div>duplicate of <code>{claim.duplicate_of}</code></div>}
                </div>
              )}
            </>
          )}
        </Card>

        {/* ---------------------------------------------------------- post */}
        <Card style={{ padding: 18, display: "flex", flexDirection: "column", gap: 12, ...fadeUp("0.16s") }}>
          <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.11em",
                         color: "var(--text-faint)" }}>THE POST</span>
          {!post && (
            <p style={{ margin: 0, fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.6 }}>
              Nothing fetched yet. TikTok returns a cover frame and a player —
              never the video file, which is why screening happens in the app
              before you post.
            </p>
          )}
          {post && (
            <>
              {post.thumbnail_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={post.thumbnail_url} alt="Post cover"
                  style={{ width: "100%", borderRadius: 12, display: "block",
                           background: "var(--surface-sunken)" }} />
              )}
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: 13, fontWeight: 650 }}>@{post.handle}</span>
                {post.caption && (
                  <span style={{ fontSize: 12.5, color: "var(--text-secondary)", lineHeight: 1.55 }}>
                    {post.caption}
                  </span>
                )}
                {post.created_at && (
                  <span style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
                    Posted {new Date(post.created_at).toLocaleString()}
                    {staff && post.created_at_source === "snowflake" && " · decoded from the post id"}
                  </span>
                )}
              </div>
              {post.video_id && (
                <a href={`https://www.tiktok.com/@${post.handle}/video/${post.video_id}`}
                  target="_blank" rel="noreferrer"
                  style={{ fontSize: 12.5, color: "var(--purple-deep)", fontWeight: 600,
                           textDecoration: "none" }}>
                  Watch on TikTok →
                </a>
              )}
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
        style={{ border: "1px solid #e6e2f2", borderRadius: 10, padding: "9px 12px",
                 fontSize: 13.5, outline: "none", background: "var(--surface)",
                 fontFamily: "inherit", color: "var(--ink)" }} />
      {hint && <span style={{ fontSize: 11.5, color: "var(--text-muted)", lineHeight: 1.5 }}>{hint}</span>}
    </label>
  );
}
