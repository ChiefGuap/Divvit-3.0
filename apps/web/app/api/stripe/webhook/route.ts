import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { stripe, stripeConfigured } from "@/lib/server/stripe";
import { fulfillCheckout } from "@/lib/server/fulfill";

/* Stripe → Divvit. A paid Checkout Session marks its campaign paid and sends the
   offers to cafés, even if the startup never comes back to the pay page.
   Register this URL (…/api/stripe/webhook) for checkout.session.completed and
   checkout.session.async_payment_succeeded; locally:
     stripe listen --forward-to localhost:3200/api/stripe/webhook */

export const runtime = "nodejs";

export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !stripeConfigured()) return NextResponse.json({ error: "webhook not configured" }, { status: 503 });

  // the signature covers the raw body, so read it as text before anything parses it
  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(body, req.headers.get("stripe-signature") ?? "", secret);
  } catch (e) {
    return NextResponse.json({ error: `bad signature: ${e instanceof Error ? e.message : e}` }, { status: 400 });
  }

  if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
    const session = event.data.object;
    if (session.metadata?.campaign_id) {
      try {
        await fulfillCheckout(session.id);
      } catch (e) {
        // a 500 makes Stripe retry later
        return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
      }
    }
  }
  return NextResponse.json({ received: true });
}
