import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { sendPendingEmails } from "@/lib/server/notify";
import { createClient } from "@/lib/supabase/server";

/* Sends the campaign emails the database has queued (see lib/server/notify.ts).
   Called by pages right after a step that queues one (a launch, an admin review),
   and every 5 minutes by the database while anything is waiting (pg_cron + pg_net,
   with the shared secret in x-divvit-cron). Anything it couldn't send stays queued.
   POST /api/campaigns/notify  (signed in, or the database's cron call) */

export const runtime = "nodejs";

function fromCron(req: Request) {
  const got = Buffer.from(req.headers.get("x-divvit-cron") ?? "");
  const want = Buffer.from(process.env.DIVVIT_VERIFY_SECRET ?? "");
  return want.length > 0 && got.length === want.length && timingSafeEqual(got, want);
}

export async function POST(req: Request) {
  if (!fromCron(req)) {
    const { data: { user } } = await (await createClient()).auth.getUser();
    if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  }
  try {
    return NextResponse.json(await sendPendingEmails());
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
