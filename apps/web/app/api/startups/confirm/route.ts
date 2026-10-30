import { NextResponse } from "next/server";
import { serverDb } from "@/lib/server/db";
import { companyConfirmEmail, emailConfigured, sendEmail } from "@/lib/server/notify";
import { overLimit, tooMany } from "@/lib/server/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { marketplace } from "@/lib/urls";

/* Confirming a startup with a work email (see the company_confirmation migration).
   POST { email }   signed-in startup: we email a one-time link to that address,
                    which must be at the company website's domain
   GET  ?token=…    the link: marks the company confirmed, then goes to the home page
   The token is made and checked in the database with the server's secret; it only
   ever travels by email, so getting it proves the mailbox. */

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (overLimit(req, "company-confirm", 5)) return tooMany();
  const { data: { user } } = await (await createClient()).auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  if (!emailConfigured()) {
    return NextResponse.json({ error: "We can't send emails just yet. We'll confirm your company on our call instead." }, { status: 503 });
  }
  const { email } = (await req.json().catch(() => ({}))) as { email?: string };

  const { db, secret } = serverDb();
  const { data, error } = await db.rpc("mp_start_company_confirm", { p_secret: secret, p_user: user.id, p_email: email ?? "" });
  if (error) {
    const msg = error.message;
    return NextResponse.json({ error: msg.charAt(0).toUpperCase() + msg.slice(1) + (/[.!]$/.test(msg) ? "" : ".") }, { status: 400 });
  }
  const start = data as { token: string; email: string; startup: string; domain: string };
  const link = marketplace(`/api/startups/confirm?token=${start.token}`);
  try {
    await sendEmail(companyConfirmEmail(start.startup, start.email, link));
  } catch (e) {
    console.error("[company-confirm] send failed:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "We couldn't send that email. Try again in a minute." }, { status: 502 });
  }
  return NextResponse.json({ ok: true, email: start.email });
}

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  let ok = false;
  if (/^[a-f0-9]{48}$/.test(token)) {
    const { db, secret } = serverDb();
    const { data } = await db.rpc("mp_finish_company_confirm", { p_secret: secret, p_token: token });
    ok = Boolean((data as { ok?: boolean } | null)?.ok);
  }
  return NextResponse.redirect(marketplace(`/home?company=${ok ? "confirmed" : "expired"}`), 302);
}
