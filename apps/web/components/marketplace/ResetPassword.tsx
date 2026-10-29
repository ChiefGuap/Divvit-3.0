"use client";

/* Forgotten password. /reset asks for the email and has Supabase send a link; the
   link comes back through /auth/callback (which signs them in) to /reset/new, where
   they choose a new password and go on to their home. */

import Link from "next/link";
import { useRouter } from "next/navigation";
import React from "react";
import { useMp } from "./session";
import { FlowBar, Question } from "./flow";

export function ResetRequest() {
  const { supabase } = useMp();
  const [email, setEmail] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [sent, setSent] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit() {
    setBusy(true); setError(null);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/auth/callback?next=/reset/new`,
    });
    setBusy(false);
    if (error) { setError(/rate|seconds|too many/i.test(error.message) ? "Too many tries. Wait a minute and try again." : error.message); return; }
    setSent(true);
  }

  return (
    <>
      <FlowBar right={<Link href="/signin" className="mp-link">Sign in</Link>} />
      {sent ? (
        <Question title="Check your email" sub={`If ${email.trim()} has a Divvit account, a link to choose a new password is on its way.`}>
          <p className="mp-note">The link works once. Nothing there after a few minutes? Check spam, or <button type="button" className="mp-link accent" onClick={() => setSent(false)}>try again</button>.</p>
        </Question>
      ) : (
        <Question title="Reset your password" sub="We'll email you a link to choose a new one." cta="Send link" onContinue={submit} busy={busy}
          canContinue={/\S+@\S+\.\S+/.test(email)}>
          <input className="mp-input" type="email" autoFocus placeholder="Email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          {error && <div className="mp-error">{error}</div>}
          <p className="mp-note">Remembered it? <Link href="/signin" className="mp-link accent">Sign in</Link></p>
        </Question>
      )}
    </>
  );
}

export function ResetNew() {
  const { supabase, user, profile, loading } = useMp();
  const router = useRouter();
  const [password, setPassword] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit() {
    setBusy(true); setError(null);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) { setError(/same|different/i.test(error.message) ? "That's your current password. Choose a new one." : error.message); return; }
    router.replace(profile?.role === "cafe" ? "/cafes/inbox" : "/home");
  }

  if (loading) return <FlowBar />;
  return (
    <>
      <FlowBar />
      {!user ? (
        <Question title="That link has expired" sub="Reset links work once and only for a while.">
          <Link href="/reset" className="mp-btn primary" style={{ alignSelf: "flex-start", display: "inline-flex", alignItems: "center", textDecoration: "none" }}>Send a new link</Link>
        </Question>
      ) : (
        <Question title="Choose a new password" sub={`For ${user.email}.`} cta="Save password" onContinue={submit} busy={busy} canContinue={password.length >= 8}>
          <input className="mp-input" type="password" autoFocus placeholder="New password (8+ characters)" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          {error && <div className="mp-error">{error}</div>}
        </Question>
      )}
    </>
  );
}
