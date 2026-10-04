"use client";

/* Sign up / sign in, inline wherever an action needs an account. */

import React from "react";
import { useMp } from "./session";

export function AuthPanel({ role, title, intro, onDone, next, defaultMode = "signup" }: {
  role: "startup" | "cafe"; title?: string; intro?: string; onDone?: () => void; next?: string; defaultMode?: "signup" | "signin";
}) {
  const { supabase, ensureProfile } = useMp();
  const [mode, setMode] = React.useState(defaultMode);
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null); setNotice(null);
    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email, password,
          options: {
            data: { mp_role: role, full_name: name },
            emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next ?? window.location.pathname)}`,
          },
        });
        if (error) throw error;
        if (!data.session) {
          setNotice(`We sent a confirmation link to ${email}. Confirm it, then come back and sign in — everything you've set up here is saved on this device.`);
          setMode("signin");
          return;
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
      await ensureProfile(role);
      onDone?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(/invalid login/i.test(msg) ? "That email and password don't match an account." :
        /not confirmed/i.test(msg) ? "Confirm your email first — check your inbox for the link." : msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mp-card pad mp-auth">
      {title && <h3>{title}</h3>}
      {intro && <p className="mp-lede" style={{ marginTop: 0, fontSize: 14.5 }}>{intro}</p>}
      <div className="mp-seg">
        <button className={mode === "signup" ? "on" : ""} onClick={() => setMode("signup")} type="button">Create account</button>
        <button className={mode === "signin" ? "on" : ""} onClick={() => setMode("signin")} type="button">Sign in</button>
      </div>
      <form onSubmit={submit}>
        {mode === "signup" && (
          <label className="mp-field"><span>Your name</span><input className="mp-input" value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" /></label>
        )}
        <label className="mp-field"><span>Work email</span><input className="mp-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" /></label>
        <label className="mp-field"><span>Password</span><input className="mp-input" type="password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete={mode === "signup" ? "new-password" : "current-password"} /></label>
        {error && <div className="mp-error">{error}</div>}
        {notice && <div className="mp-ok">{notice}</div>}
        <button className="divvit-plainsm lg" disabled={busy} type="submit">
          <span>{busy ? "One moment…" : mode === "signup" ? (role === "cafe" ? "Create café account" : "Create account") : "Sign in"}</span>
        </button>
      </form>
    </div>
  );
}
