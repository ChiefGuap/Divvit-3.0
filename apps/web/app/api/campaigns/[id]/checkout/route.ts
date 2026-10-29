import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { stripe, stripeConfigured } from "@/lib/server/stripe";
import { MARKETPLACE_URL } from "@/lib/urls";

/* Pay for an approved campaign: creates a Stripe Checkout Session for the price
   the Divvit team confirmed and returns its URL. Checkout comes back to the pay
   page, which confirms the payment (/confirm); the webhook does the same.
   GET  → { configured }   whether payments are switched on
   POST → { url }          the signed-in startup's own approved campaign only */

export const runtime = "nodejs";

export function GET() {
  return NextResponse.json({ configured: stripeConfigured() });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!stripeConfigured()) return NextResponse.json({ error: "Payments aren't switched on yet." }, { status: 503 });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  // RLS: a startup can only read its own campaigns
  const { data: k } = await supabase.from("mp_campaigns").select("id, name, status, final_cents, weeks, sleeves_per_cafe").eq("id", id).maybeSingle();
  if (!k) return NextResponse.json({ error: "Campaign not found." }, { status: 404 });
  if (k.status !== "approved" || !k.final_cents) return NextResponse.json({ error: "This campaign isn't waiting for payment." }, { status: 409 });
  const { count } = await supabase.from("mp_campaign_cafes").select("id", { count: "exact", head: true }).eq("campaign_id", id);

  // come back to the marketplace host they paid from (each host keeps its own sign-in)
  const origin = req.headers.get("origin");
  const base = origin && /^https?:\/\/marketplace\.[a-z0-9.-]+(:\d+)?$/i.test(origin) ? origin : MARKETPLACE_URL;
  const what = `${count ?? 0} cafés · ${k.sleeves_per_cafe} sleeves each · ${k.weeks} weeks`;

  const session = await stripe().checkout.sessions.create({
    mode: "payment",
    line_items: [{ quantity: 1, price_data: { currency: "usd", unit_amount: k.final_cents, product_data: { name: `Divvit campaign: ${k.name}`, description: what } } }],
    customer_email: user.email,
    client_reference_id: k.id,
    metadata: { campaign_id: k.id },
    payment_intent_data: { metadata: { campaign_id: k.id }, description: `Divvit campaign: ${k.name}` },
    // an invoice and receipt for the startup's books
    invoice_creation: { enabled: true, invoice_data: { description: `${k.name} — ${what}`, metadata: { campaign_id: k.id } } },
    ...(process.env.STRIPE_TAX === "on" ? { automatic_tax: { enabled: true } } : {}),
    success_url: `${base}/campaigns/${k.id}/pay?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base}/campaigns/${k.id}/pay?canceled=1`,
  });
  return NextResponse.json({ url: session.url });
}
