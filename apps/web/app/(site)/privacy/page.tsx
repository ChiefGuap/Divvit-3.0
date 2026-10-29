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
      <p className="updated">Last updated October 29, 2026</p>
      <p className="intro">
        Divvit runs a marketplace where startups put their brand on the coffee sleeves of local cafés. This policy explains what
        we collect when you use divvit.app and marketplace.divvit.app, why we collect it, who else handles it, and what you can
        do about it.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li><b>Your account.</b> Your name, email address, password and whether you joined as a startup or a café. Passwords are stored by our sign-in provider in hashed form; we can&apos;t see them.</li>
        <li><b>Startup profiles.</b> Company name, website, LinkedIn and other public profile links, description, logo, category, location, stage, funding, team size and founding year, and the areas and campaigns you set up, including the sleeve designs you create or upload.</li>
        <li><b>Café listings.</b> Café name, address and map location, website, Instagram, opening hours, roughly how many cups you serve, which brands you&apos;ll carry, photos you upload, and how your café was verified (the method, any code we sent, and the outcome).</li>
        <li><b>Payments.</b> Payments are handled by Stripe on its own checkout page. We never see or store card numbers; we keep the amount, the date, the status and Stripe&apos;s reference numbers.</li>
        <li><b>QR code scans.</b> When someone scans the QR code on a campaign sleeve, we record the time and a one-way, keyed fingerprint made from their IP address and browser, so we can count how many different people scanned. We don&apos;t keep the IP address itself, the fingerprint is different for every campaign, and a scan isn&apos;t linked to an account. The person is then sent to the startup&apos;s website with a tag showing the visit came from Divvit.</li>
        <li><b>Logs.</b> Like most websites, our hosting and sign-in providers keep short-lived technical logs (such as IP address, browser and the page requested) to run the service securely.</li>
        <li><b>On your device.</b> We use cookies only to keep you signed in. Your browser also stores things like an unfinished sign-up or campaign so you can pick up where you left off. We don&apos;t use advertising or analytics trackers.</li>
      </ul>

      <h2>Where some of it comes from</h2>
      <p>
        To save typing, we fill in what we can from public sources: the Y Combinator company directory, Clearbit&apos;s company
        search, your own website, People Data Labs (company size, founding year and funding), Google&apos;s website icons for logos,
        and OpenStreetMap for café addresses, hours and contact details. You can change anything we fill in.
      </p>

      <h2>How we use it</h2>
      <ul>
        <li>To run the marketplace: show cafés to startups, send campaigns to cafés, print and deliver sleeves, and handle payments and payouts.</li>
        <li>To review campaigns and to verify that each café is run by the person who listed it, which may include calling the café&apos;s public phone number.</li>
        <li>To send you emails about your account and your campaigns, such as approvals, payments, offers and reports. We don&apos;t send marketing emails.</li>
        <li>To report how a campaign did, using scan counts and estimates.</li>
        <li>To keep Divvit secure, prevent abuse and improve the service.</li>
      </ul>

      <h2>Who can see it</h2>
      <ul>
        <li><b>Anyone browsing the marketplace</b> can see verified café listings: name, address, neighborhood, website, Instagram, hours, estimates and photo. A café owner&apos;s name and email are never shown.</li>
        <li><b>A café offered a campaign</b> sees the startup&apos;s name, description, category, location, website, LinkedIn page, team size, founding year, logo and sleeve design.</li>
        <li><b>A startup</b> sees how many people scanned its sleeves, day by day, but never who.</li>
        <li><b>The Divvit team</b> can see account details to review campaigns, verify cafés and help you.</li>
      </ul>
      <p>
        Uploaded café photos and sleeve designs are stored at public web addresses that aren&apos;t listed anywhere, so they can be
        shown on cards and printed.
      </p>
      <p>We don&apos;t sell personal information or share it for advertising. These providers handle data only to run Divvit for us:</p>
      <ul>
        <li>Supabase (database, sign-in and file storage, in the United States) and Vercel (hosting)</li>
        <li>Stripe (payments and invoices) and Resend (email delivery)</li>
        <li>People Data Labs and Clearbit (company details), OpenStreetMap services including Photon and Overpass (maps, addresses and nearby places), and Anthropic (suggesting neighborhoods from a startup&apos;s name and description)</li>
      </ul>
      <p>
        Our pages also load fonts from Google Fonts and map images from OpenFreeMap, and Stripe&apos;s checkout page uses its own
        cookies to prevent fraud. Like any site you visit, those services see your IP address when your browser loads from them.
      </p>
      <p>We may also share information if the law requires it, or with a buyer if Divvit is ever sold, under the same protections.</p>

      <h2>How long we keep it</h2>
      <p>
        We keep your information while your account is open and delete it when you ask us to. Payment records are kept as long as
        tax and accounting rules require. Scan counts stay with the campaign&apos;s report.
      </p>

      <h2>Your choices and rights</h2>
      <p>
        You can see and edit your profile or listing in the marketplace at any time. To get a copy of your data, correct it, or
        delete your account, email <a href={`mailto:${CONTACT}`}>{CONTACT}</a> from the address on your account and we&apos;ll
        take care of it within 30 days. Depending on where you live (for example California, the EU or the UK), you may have
        further rights, such as objecting to how we use your data; email us and we&apos;ll help. We won&apos;t treat you differently
        for asking.
      </p>

      <h2>Security</h2>
      <p>
        Data is encrypted in transit and at rest, and each account can reach only its own data. No service is perfectly secure, so
        please use a strong password you don&apos;t use anywhere else, and tell us if you think your account has been misused.
      </p>

      <h2>Children</h2>
      <p>Divvit is for businesses and isn&apos;t meant for anyone under 18. We don&apos;t knowingly collect information from children.</p>

      <h2>Changes</h2>
      <p>If we change this policy in a way that matters, we&apos;ll update the date above and let account holders know by email.</p>

      <h2>Contact</h2>
      <p>Questions about privacy: <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.</p>

      <a className="back" href={site("/")}>← Back to Divvit</a>
    </main>
  );
}
