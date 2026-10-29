"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import React from "react";
import { useMp } from "./session";
import { FlowBar, Question } from "./flow";

export function SignIn() {
  const { supabase, user, profile, loading, refresh } = useMp();
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(params.get("error") === "confirm" ? "That link expired — sign in instead." : null);

  // go to the right home exactly once, as soon as we know who's signed in
  const went = React.useRef(false);
  const go = React.useCallback((role: string | null | undefined) => {
    if (went.current) return;
    went.current = true;
    const nextPath = params.get("next");
    router.replace(nextPath?.startsWith("/") && !nextPath.startsWith("//") ? nextPath : role === "cafe" ? "/cafes/inbox" : role === "startup" ? "/home" : "/");
  }, [params, router]);
  React.useEffect(() => { if (!loading && user && !busy) go(profile?.role); }, [loading, user, profile, busy, go]);

  async function submit() {
    setBusy(true); setError(null);
    const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) {
      setError(/invalid login/i.test(error.message) ? "That email and password don't match." :
        /not confirmed/i.test(error.message) ? "Confirm your email first — the link is in your inbox." : error.message);
      setBusy(false);
      return;
    }
    const { data: p } = await supabase.from("mp_profiles").select("role").eq("id", data.user.id).maybeSingle();
    await refresh();
    go(p?.role);
  }

  return (
    <>
      <FlowBar right={<Link href="/" className="mp-link">Get started</Link>} />
      <Question title="Welcome back" cta="Sign in" onContinue={submit} busy={busy} canContinue={/\S+@\S+\.\S+/.test(email) && password.length > 0}>
        <input className="mp-input" type="email" autoFocus placeholder="Email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input className="mp-input" type="password" placeholder="Password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <div className="mp-error">{error}</div>}
        <p className="mp-note"><Link href="/reset" className="mp-link accent">Forgot your password?</Link></p>
        <p className="mp-note">New to Divvit? <Link href="/" className="mp-link accent">Get started</Link></p>
      </Question>
    </>
  );
}
