import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/* Email-confirmation and password-reset landing. Handles both PKCE (?code=) and token-hash
   (?token_hash=&type=) links, then sends the user on to `next`.
   Add <marketplace URL>/auth/callback to Supabase → Auth → URL configuration. */

export async function GET(request: Request) {
  const url = new URL(request.url);
  const next = url.searchParams.get("next") || "/";
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next.replace(/^\/marketplace/, "") || "/" : "/";
  const supabase = await createClient();

  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as "signup" | "email" | "recovery" | "invite" | "magiclink" | "email_change" | null;

  let ok = false;
  if (code) ok = !(await supabase.auth.exchangeCodeForSession(code)).error;
  else if (tokenHash && type) ok = !(await supabase.auth.verifyOtp({ token_hash: tokenHash, type })).error;

  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? url.host;
  const base = `${url.protocol}//${host}`;
  // a dead password-reset link can't send them to sign in (they don't know the password): offer a new link
  const failed = safeNext.startsWith("/reset") ? "/reset/new" : "/signin?error=confirm";
  return NextResponse.redirect(new URL(ok ? safeNext : failed, base));
}
