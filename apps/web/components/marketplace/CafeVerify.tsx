"use client";

/* "Verify that you run this café" — shown in the inbox until the café is
   verified. Every option checks against the café's public listing (its map
   entry and the website / phone number on it), so nobody can sign up as a
   coffee shop they don't run. */

import React from "react";
import { useMp } from "./session";
import { Choices } from "./flow";
import { Art } from "./art";
import type { CafeDetails } from "@/app/api/cafes/details/route";

type Method = "website" | "phone" | "review";
type Verification = {
  status: "unverified" | "pending" | "verified" | "rejected"; osm_ref: string | null;
  method: Method | null; requested_at: string | null; note: string | null; website_code: string | null;
};

const domain = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };
/** "+1 929-262-1241" → "•••-•••-1241": enough to recognise, not enough to reuse */
const masked = (p: string) => { const d = p.replace(/\D/g, ""); return d.length >= 4 ? `•••-•••-${d.slice(-4)}` : "your public number"; };

/** bare: no heading or card frame, for when it sits inside the setup guide's "Verify your café" step */
export function CafeVerify({ name, onVerified, bare }: { name: string; onVerified: () => void; bare?: boolean }) {
  const { supabase } = useMp();
  const [v, setV] = React.useState<Verification | null>(null);
  const [contact, setContact] = React.useState<CafeDetails | null>(null);
  const [looked, setLooked] = React.useState(false);  // public listing fetched (or there isn't one)
  const [choosing, setChoosing] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ text: string; good?: boolean } | null>(null);
  const [code, setCode] = React.useState("");
  const [copied, setCopied] = React.useState(false);

  const load = React.useCallback(async () => {
    const { data } = await supabase.rpc("mp_my_verification");
    const ver = data as Verification | null;
    setV(ver);
    if (ver?.status === "verified") onVerified();
    if (ver?.osm_ref) {
      try {
        const r = await fetch(`/api/cafes/details?ref=${encodeURIComponent(ver.osm_ref)}`);
        if (r.ok) setContact(await r.json());
      } catch { /* the review option still works */ }
    }
    setLooked(true);
  }, [supabase, onVerified]);
  React.useEffect(() => { load(); }, [load]);

  async function choose(method: Method) {
    setBusy(true); setMsg(null);
    const { data, error } = await supabase.rpc("mp_request_verification", { p_method: method });
    setBusy(false);
    if (error) { setMsg({ text: error.message }); return; }
    setV(data as Verification);
    setChoosing(false);
    setCode("");
    if (method !== "website") fetch("/api/campaigns/notify", { method: "POST" }).catch(() => {});
  }

  async function checkWebsite() {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch("/api/cafes/verify/website", { method: "POST" });
      const out = await r.json();
      if (out.ok) { setMsg({ text: "Verified — startups can now see your café.", good: true }); await load(); return; }
      setMsg({ text: out.message ?? "We couldn't check your website. Try again." });
      if (out.review) setChoosing(true);
    } catch {
      setMsg({ text: "We couldn't check your website. Try again." });
    } finally {
      setBusy(false);
    }
  }

  async function confirmCode() {
    setBusy(true); setMsg(null);
    const { data, error } = await supabase.rpc("mp_confirm_phone_code", { p_code: code.replace(/\D/g, "") });
    setBusy(false);
    const out = data as { ok: boolean; message?: string } | null;
    if (error || !out?.ok) { setMsg({ text: error?.message ?? out?.message ?? "That code doesn't match." }); return; }
    setMsg({ text: "Verified — startups can now see your café.", good: true });
    await load();
  }

  if (!v || v.status === "verified") return null;

  const site = contact && !contact.newOnMap && contact.website ? contact.website : "";
  const phone = contact?.phone ?? "";
  const pick = !v.method || v.status === "unverified" || v.status === "rejected" || choosing;
  const options = [
    ...(site ? [{ value: "website" as Method, label: "Add a code to your website", hint: `${domain(site)} · takes a minute`, art: <Art name="code" /> }] : []),
    ...(phone ? [{ value: "phone" as Method, label: "Get a call at the café", hint: `We call ${masked(phone)} and read you a code`, art: <Art name="store" /> }] : []),
    { value: "review" as Method, label: "Have Divvit check it", hint: "We look your café up and may call it · usually within a day", art: <Art name="hands" /> },
  ];

  return (
    <section className={`mp-verify${bare ? " bare" : ""}`}>
      {!bare && (
        <div className="head">
          <b>Verify that you run {name}</b>
          <p>Startups only see verified cafés, so offers start once this is done. We check against your café&apos;s public listing — nobody else can sign up as you.</p>
        </div>
      )}

      {v.status === "rejected" && v.note && pick && <div className="mp-error">We couldn&apos;t verify this café: {v.note}</div>}

      {pick && !looked ? (
        <p className="mp-note">Looking up your café&apos;s public listing…</p>
      ) : pick ? (
        <>
          <Choices cols={1} value={null} onChange={(m) => !busy && choose(m)} options={options} />
          {!v.osm_ref && <p className="mp-note">Not finding your café on the map? No problem — we&apos;ll check it by hand.</p>}
          {choosing && <button type="button" className="mp-link" onClick={() => setChoosing(false)}>Back</button>}
        </>
      ) : v.method === "website" ? (
        <div className="step">
          <p>Add this code anywhere on <b>{site ? domain(site) : "your website"}</b> — the footer is fine — and publish:</p>
          <div className="mp-code">
            <code>{v.website_code}</code>
            <button type="button" className="mp-link accent" onClick={() => { navigator.clipboard?.writeText(v.website_code ?? ""); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="mp-note">You can take it down once you&apos;re verified.</p>
          <div className="row">
            <button type="button" className="mp-btn primary" disabled={busy} onClick={checkWebsite}>{busy ? "Checking…" : "Check my website"}</button>
            <button type="button" className="mp-link" onClick={() => { setMsg(null); setChoosing(true); }}>Choose another way</button>
          </div>
        </div>
      ) : v.method === "phone" ? (
        <div className="step">
          <p>We&apos;ll call the café at <b>{phone ? masked(phone) : "its public number"}</b> within one business day and read you a 6-digit code.</p>
          <div className="row">
            <input className="mp-input" inputMode="numeric" autoComplete="one-time-code" placeholder="6-digit code" maxLength={7} value={code}
              onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && code.replace(/\D/g, "").length === 6) confirmCode(); }} />
            <button type="button" className="mp-btn primary" disabled={busy || code.replace(/\D/g, "").length !== 6} onClick={confirmCode}>Confirm</button>
          </div>
          <button type="button" className="mp-link" onClick={() => { setMsg(null); setChoosing(true); }}>Choose another way</button>
        </div>
      ) : (
        <div className="step">
          <p>Thanks — we&apos;re checking {name}. It usually takes a day, and we may call the café to confirm.</p>
          <button type="button" className="mp-link" onClick={() => { setMsg(null); setChoosing(true); }}>Choose another way</button>
        </div>
      )}

      {msg && <div className={msg.good ? "mp-ok" : "mp-error"}>{msg.text}</div>}
    </section>
  );
}
