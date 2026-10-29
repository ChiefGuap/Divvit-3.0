import { NextResponse } from "next/server";
import { compose, emailConfigured, sampleEmails, sendEmail } from "@/lib/server/notify";
import { createClient } from "@/lib/supabase/server";

/* Admin → Emails. The Divvit team checks email before launch, and whenever it seems off:
   GET   is email set up (Resend key, sender, team inbox), plus every email Divvit
         sends, filled with made-up details, to read
   POST  send a test email to the signed-in admin, through Resend, right now */

export const runtime = "nodejs";

async function admin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.rpc("mp_is_admin");
  return data === true ? user : null;
}

const team = () => (process.env.DIVVIT_TEAM_EMAIL ?? "").split(",").map((x) => x.trim()).filter(Boolean);
const from = () => process.env.DIVVIT_FROM_EMAIL || "Divvit <onboarding@resend.dev> (Resend's test sender)";

export async function GET() {
  const user = await admin();
  if (!user) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  return NextResponse.json({
    resend: emailConfigured(), from: from(), team: team(), me: user.email,
    previews: sampleEmails(team().length ? team() : ["elliott@divvit.app"]).map(({ kind, label, mail }) => ({ kind, label, to: mail.to, subject: mail.subject, html: mail.html })),
  });
}

export async function POST() {
  const user = await admin();
  if (!user?.email) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  if (!emailConfigured()) return NextResponse.json({ error: "RESEND_API_KEY isn't set on this server yet." }, { status: 503 });
  const at = new Date().toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Los_Angeles" });
  const { text, html } = compose({
    heading: "Divvit email works",
    lines: ["If you're reading this, Resend is set up and Divvit can send email: campaign approvals, café offers, reports and confirmation links."],
    facts: [["Sent from", from()], ["Team alerts go to", team().join(", ") || "not set (DIVVIT_TEAM_EMAIL)"], ["Sent", `${at} (Pacific)`]],
  });
  try {
    await sendEmail({ to: [user.email], subject: "Divvit email test", text, html });
    return NextResponse.json({ ok: true, to: user.email });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
