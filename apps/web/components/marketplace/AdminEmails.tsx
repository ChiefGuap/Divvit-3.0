"use client";

/* Admin → Emails: is email set up, does it actually arrive (send yourself a test),
   what's waiting in the queue or failing (with Resend's own error), and a preview of
   every email Divvit sends. */

import React from "react";
import { useMp } from "./session";
import { num, plural } from "@/lib/marketplace/format";

type Setup = { resend: boolean; from: string; team: string[]; me: string;
  previews: { kind: string; label: string; to: string[]; subject: string; html: string }[] };
type Queue = { waiting: number; sent_today: number; gave_up: number; failing: { kind: string; attempts: number; error: string | null; created_at: string }[] };

export function AdminEmails() {
  const { supabase } = useMp();
  const [setup, setSetup] = React.useState<Setup | null>(null);
  const [queue, setQueue] = React.useState<Queue | null>(null);
  const [pick, setPick] = React.useState(0);
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    const [r, q] = await Promise.all([fetch("/api/admin/emails").then((x) => x.json()), supabase.rpc("mp_admin_email_queue")]);
    if (r.error) setError(r.error); else setSetup(r as Setup);
    if (!q.error) setQueue(q.data as Queue);
  }, [supabase]);
  React.useEffect(() => { load(); }, [load]);

  async function test() {
    setBusy(true); setResult(null);
    const r = await fetch("/api/admin/emails", { method: "POST" });
    const out = await r.json();
    setResult(r.ok ? { ok: true, text: `Sent to ${out.to}. If it isn't in that inbox (or spam) within a minute, check Resend → Logs.` } : { ok: false, text: out.error });
    setBusy(false);
  }

  if (error) return <div className="mp-error">{error}</div>;
  if (!setup) return <p className="mp-note">Loading…</p>;
  const p = setup.previews[pick];
  return (
    <div className="adm-emails">
      <section className="ae-card">
        <h2>Setup</h2>
        <div className="mp-lines">
          <div><span>Resend API key<small>RESEND_API_KEY on this server</small></span><span className={`mp-pill ${setup.resend ? "verified" : "rejected"}`}>{setup.resend ? "Set" : "Missing"}</span></div>
          <div><span>Sends from<small>DIVVIT_FROM_EMAIL · the domain must be verified in Resend</small></span><b>{setup.from}</b></div>
          <div><span>Team alerts go to<small>DIVVIT_TEAM_EMAIL</small></span><b>{setup.team.join(", ") || "Not set"}</b></div>
          {queue && (
            <div><span>Queue<small>Sent every 5 minutes, and right after each step</small></span>
              <b>{num(queue.waiting)} waiting · {num(queue.sent_today)} sent today{queue.gave_up ? ` · ${num(queue.gave_up)} gave up` : ""}</b></div>
          )}
        </div>
        <div className="ae-test">
          <button type="button" className="mp-btn primary" disabled={busy || !setup.resend} onClick={test}>{busy ? "Sending…" : `Send a test email to ${setup.me}`}</button>
          {!setup.resend && <span className="mp-note">Add RESEND_API_KEY first.</span>}
        </div>
        {result && <div className={result.ok ? "mp-found" : "mp-error"}><span>{result.text}</span></div>}
        {queue && queue.failing.length > 0 && (
          <div className="ae-fail">
            <b>{plural(queue.failing.length, "email")} failing to send</b>
            {queue.failing.map((f, i) => <small key={i}>{f.kind} · tried {f.attempts}× · {f.error ?? "unknown error"}</small>)}
          </div>
        )}
      </section>

      <section className="ae-card">
        <h2>What each email looks like</h2>
        <p className="mp-note">Filled in with made-up details. Nothing here is sent.</p>
        <div className="mp-chips ae-kinds">
          {setup.previews.map((x, i) => (
            <button key={x.kind} type="button" className={`mp-chip${i === pick ? " on" : ""}`} onClick={() => setPick(i)}>{x.label}</button>
          ))}
        </div>
        {p && (
          <>
            <div className="ae-meta"><span>To <b>{p.to.join(", ")}</b></span><span>Subject <b>{p.subject}</b></span></div>
            <iframe className="ae-frame" title={p.subject} sandbox="" srcDoc={`<!doctype html><meta charset="utf-8"><body style="margin:0;padding:24px;background:#fff">${p.html}</body>`} />
          </>
        )}
      </section>
    </div>
  );
}
