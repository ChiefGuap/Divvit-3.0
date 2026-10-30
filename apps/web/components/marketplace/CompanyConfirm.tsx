"use client";

/* "Confirm it's your company", in the startup's setup guide. A sign-in email at the
   company's domain confirms it on its own (mp_company_status checks); otherwise the
   startup can have a link sent to a work address, or the Divvit team confirms it on
   the call. Campaigns aren't approved until it's done, so nobody advertises as a
   company they don't run. */

import Link from "next/link";
import React from "react";

export type CompanyStatus = {
  confirmed: boolean; via: "email" | "work_email" | "team" | null; email: string | null; domain: string | null;
  shared_domain: boolean; account_email: string; pending_email: string | null; pending_sent_at: string | null;
};

export function CompanyConfirm({ name, status }: { name: string; status: CompanyStatus }) {
  const [email, setEmail] = React.useState(status.pending_email ?? "");
  const [sentTo, setSentTo] = React.useState<string | null>(status.pending_email);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const domain = status.domain;

  if (status.confirmed) return null;
  if (!domain) {
    return (
      <p className="mp-note">
        Add {name}&apos;s website to your profile to confirm with a work email, or we&apos;ll confirm it on our call before your first
        campaign is approved. <Link href="/start/startup?edit=1" className="mp-link accent">Edit profile</Link>
      </p>
    );
  }
  if (status.shared_domain) {
    return <p className="mp-note">{name}&apos;s website is on a shared host ({domain}), so we&apos;ll confirm it on our call before your first campaign is approved.</p>;
  }

  async function send() {
    setBusy(true); setError(null);
    try {
      const r = await fetch("/api/startups/confirm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: email.trim() }) });
      const out = await r.json();
      if (!r.ok) setError(out.error ?? "That didn't work. Try again.");
      else setSentTo(out.email);
    } catch {
      setError("That didn't work. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="company-confirm">
      {sentTo ? (
        <p className="cc-sent">
          We sent a link to <b>{sentTo}</b>. Open it to confirm {name}; it works once, for 24 hours.{" "}
          <button type="button" className="mp-link accent" onClick={() => setSentTo(null)}>Use a different address</button>
        </p>
      ) : (
        <form className="cc-form" onSubmit={(e) => { e.preventDefault(); if (!busy && /\S+@\S+\.\S+/.test(email)) send(); }}>
          <input className="mp-input" type="email" placeholder={`you@${domain}`} autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)}
            aria-label={`Your work email at ${domain}`} />
          <button type="submit" className="mp-btn primary" disabled={busy || !/\S+@\S+\.\S+/.test(email)}>{busy ? "Sending…" : "Send link"}</button>
        </form>
      )}
      {error && <div className="mp-error">{error}</div>}
      <p className="mp-note">No email at {domain}? Skip this and we&apos;ll confirm {name} on our call.</p>
    </div>
  );
}
