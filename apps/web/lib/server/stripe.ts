import Stripe from "stripe";

/* Stripe, server side only. Startups pay for an approved campaign through
   Stripe Checkout (a page Stripe hosts); the webhook and the page Checkout
   returns to both call fulfillCheckout (lib/server/fulfill.ts).
     STRIPE_SECRET_KEY       sk_test_… while testing, sk_live_… in production
     STRIPE_WEBHOOK_SECRET   whsec_… from `stripe listen` locally, or the dashboard's webhook endpoint
     STRIPE_TAX              "on" to add sales tax with Stripe Tax (set up Tax in the dashboard first) */

let client: Stripe | null = null;

export const stripeConfigured = () => Boolean(process.env.STRIPE_SECRET_KEY);

export function stripe() {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error("STRIPE_SECRET_KEY is not set");
  client ??= new Stripe(process.env.STRIPE_SECRET_KEY);
  return client;
}
