import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fulfillCheckout } from "@/lib/server/fulfill";

/* The pay page calls this when Stripe Checkout sends the startup back, so the
   campaign goes out to cafés right away instead of waiting for the webhook.
   POST { session_id } → { status: "paid" | "already paid" | "unpaid" } */

export const runtime = "nodejs";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const { data: k } = await supabase.from("mp_campaigns").select("id").eq("id", id).maybeSingle();
  if (!k) return NextResponse.json({ error: "Campaign not found." }, { status: 404 });

  const { session_id } = (await req.json().catch(() => ({}))) as { session_id?: string };
  if (!session_id?.startsWith("cs_")) return NextResponse.json({ error: "Missing payment session." }, { status: 400 });
  try {
    const r = await fulfillCheckout(session_id);
    if (r.campaignId !== id) return NextResponse.json({ error: "That payment is for another campaign." }, { status: 400 });
    return NextResponse.json({ status: r.status });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
