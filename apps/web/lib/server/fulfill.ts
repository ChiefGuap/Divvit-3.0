import { stripe } from "./stripe";
import { serverDb } from "./db";
import { sendPendingEmails } from "./notify";

/* A finished Checkout Session → the campaign is paid and its offers go out to
   cafés. Called by the Stripe webhook and by the page Checkout returns to, so it
   must be safe to run more than once (mp_mark_campaign_paid is). Stripe is the
   source of truth: the session is fetched, never trusted from the caller. */

export type Fulfilled = { status: "paid" | "already paid" | "unpaid"; campaignId: string | null };

export async function fulfillCheckout(sessionId: string): Promise<Fulfilled> {
  const session = await stripe().checkout.sessions.retrieve(sessionId);
  const campaignId = session.metadata?.campaign_id ?? null;
  if (!campaignId) throw new Error("not a Divvit campaign payment");
  if (session.payment_status === "unpaid") return { status: "unpaid", campaignId };

  const { db, secret } = serverDb();
  const { data, error } = await db.rpc("mp_mark_campaign_paid", {
    p_secret: secret, p_campaign: campaignId, p_session: session.id,
    p_payment_intent: typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id ?? null,
    // the campaign's price, before any tax Stripe Tax added on top
    p_amount: session.amount_subtotal,
  });
  if (error) throw new Error(error.message);
  if (data === "paid") await sendPendingEmails().catch(() => { /* stays queued for the next send */ });
  return { status: data === "paid" ? "paid" : "already paid", campaignId };
}
