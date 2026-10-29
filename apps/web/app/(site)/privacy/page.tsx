import type { Metadata } from "next";
import { site } from "@/lib/urls";
import "@/components/site/legal.css";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "What Divvit collects, why, who helps us run the service, and the choices you have.",
};

const CONTACT = "elliott@divvit.app";

export default function Page() {
  return (
    <main className="legal">
      <h1>Privacy Policy</h1>
      <p className="updated">Last updated October 28, 2026</p>
      <p className="intro">
        Divvit runs a marketplace where startups put their brand on the coffee sleeves of local cafés. This policy explains what
        we collect when you use divvit.app and marketplace.divvit.app, why we collect it, and what you can do about it.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li><b>Your account.</b> Your name, email address and password. Passwords are stored by our sign-in provider in hashed form; we never see them.</li>
        <li><b>Startup profiles.</b> Company name, website, LinkedIn page, description, logo, category, location, stage, and the areas and campaigns you set up, including sleeve designs you create or upload.</li>
        <li><b>Café listings.</b> Café name, address and location, website, Instagram, opening hours, roughly how many cups you serve, which brands you&apos;ll carry, photos you upload, and the details of how you verified the café.</li>
        <li><b>Payments.</b> Payments are handled by Stripe. We never see or store card numbers; we keep the amount, the status and Stripe&apos;s reference numbers.</li>
        <li><b>QR code scans.</b> When someone scans the QR code on a campaign sleeve, we record the time and a one-way, keyed fingerprint of their connection (made from their IP address and browser) so we can count how many different people scanned. We don&apos;t store the IP address itself, and the scan isn&apos;t tied to an account. The person is then sent to the startup&apos;s website.</li>
        <li><b>On your device.</b> We use cookies only to keep you signed in. Your browser also keeps things like an unfinished sign-up or campaign so you can pick up where you left off. We don&apos;t use advertising trackers.</li>
      </ul>

      <h2>Where some of it comes from</h2>
      <p>
        To save typing, we fill in what we can from public sources: the Y Combinator company directory, your own website,
        OpenStreetMap, and People Data Labs (company size, founding year and funding). You can change anything we fill in.
      </p>

      <h2>How we use it</h2>
      <ul>
        <li>To run the marketplace: show cafés to startups, send campaigns to cafés, print and deliver sleeves, and handle payments and payouts.</li>
        <li>To review campaigns and verify that each café is run by the person who listed it.</li>
        <li>To send you emails about your account and campaigns (approvals, payments, offers, reports).</li>
        <li>To report how a campaign did, using scan counts and estimates.</li>
        <li>To keep the service secure and working, and to improve it.</li>
      </ul>

      <h2>Who sees it</h2>
      <p>
        Startups see café listings (name, neighborhood, estimates and photo). A café sees the details of a campaign offered to it:
        the startup&apos;s name, description, website, logo and sleeve. We don&apos;t sell personal information.
      </p>
      <p>We use these providers to run Divvit, and they handle data only on our behalf:</p>
      <ul>
        <li>Supabase (database, sign-in and file storage) and Vercel (hosting)</li>
        <li>Stripe (payments and invoices) and Resend (email)</li>
        <li>People Data Labs (company details), OpenStreetMap services (maps and place details) and Anthropic (suggesting neighborhoods from a startup&apos;s description)</li>
      </ul>
      <p>We may also share information if the law requires it, or with a buyer if Divvit is ever sold, under the same protections.</p>

      <h2>How long we keep it</h2>
      <p>
        We keep your information while your account is open. Payment records are kept as long as tax and accounting rules require.
        Scan counts stay with the campaign&apos;s report.
      </p>

      <h2>Your choices</h2>
      <p>
        You can see and edit your profile or listing in the marketplace at any time. To get a copy of your data, correct it, or
        delete your account, email <a href={`mailto:${CONTACT}`}>{CONTACT}</a> and we&apos;ll take care of it within 30 days.
      </p>

      <h2>Security</h2>
      <p>
        Data is encrypted in transit, and access to it is restricted by account. No service is perfectly secure, so please use a
        strong password that you don&apos;t use anywhere else.
      </p>

      <h2>Children</h2>
      <p>Divvit is for businesses and isn&apos;t meant for anyone under 18.</p>

      <h2>Changes</h2>
      <p>If we change this policy in a way that matters, we&apos;ll update the date above and let account holders know by email.</p>

      <h2>Contact</h2>
      <p>Questions about privacy: <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.</p>

      <a className="back" href={site("/")}>← Back to Divvit</a>
    </main>
  );
}
