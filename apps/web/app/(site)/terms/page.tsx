import type { Metadata } from "next";
import { site } from "@/lib/urls";
import "@/components/site/legal.css";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "The terms for startups and cafés using the Divvit marketplace.",
};

const CONTACT = "elliott@divvit.app";

export default function Page() {
  return (
    <main className="legal">
      <h1>Terms of Service</h1>
      <p className="updated">Last updated October 28, 2026</p>
      <p className="intro">
        These terms apply when you use divvit.app or the Divvit marketplace at marketplace.divvit.app. By creating an account you
        agree to them. If you&apos;re signing up for a company or a café, you confirm you can agree on its behalf.
      </p>

      <h2>Accounts</h2>
      <p>
        You must be at least 18 and give accurate information. Keep your password to yourself; you&apos;re responsible for what
        happens under your account. Tell us at <a href={`mailto:${CONTACT}`}>{CONTACT}</a> if you think someone else has used it.
      </p>

      <h2>How the marketplace works</h2>
      <p>
        Startups pick cafés and send a campaign for review. The Divvit team reviews every campaign and confirms the final price.
        The startup pays, the campaign is offered to its cafés, and each café chooses whether to run it. Divvit prints and delivers
        the sleeves, and cafés use them on their cups for the campaign&apos;s dates.
      </p>
      <p>
        Some cafés in the marketplace are marked as samples. They show what&apos;s possible in an area and can&apos;t run
        campaigns; you&apos;re never charged for them.
      </p>

      <h2>For startups</h2>
      <ul>
        <li><b>Prices.</b> The price shown before review is a projection. The price to pay is the one Divvit confirms when it approves the campaign, and it&apos;s charged in full, up front, through Stripe.</li>
        <li><b>Cafés that pass.</b> A café can decline a campaign. If one does, we&apos;ll offer you a comparable café nearby or refund that café&apos;s share.</li>
        <li><b>Your content.</b> You&apos;re responsible for your sleeve design and anything on it. You confirm you have the rights to the names, logos and images you use, and that the content is lawful and accurate. You let Divvit and your cafés use it to print the sleeves and run, show and report on the campaign.</li>
        <li><b>Results.</b> People reached, sleeves handed out and expected scans are estimates. QR scans are counted as described in our Privacy Policy. We don&apos;t promise any particular result.</li>
        <li><b>What we won&apos;t run.</b> We may decline any campaign, for example one that is misleading, offensive, illegal, or for a category a café doesn&apos;t accept.</li>
      </ul>

      <h2>For cafés</h2>
      <ul>
        <li><b>Your listing.</b> Keep it accurate, including how many cups you serve. We verify that you run the café before startups can see it.</li>
        <li><b>Offers.</b> You approve every campaign. Passing costs nothing. Once you accept, use the sleeves on your cups for the campaign&apos;s dates and, if you agreed to a branded drink, offer it.</li>
        <li><b>Payouts.</b> You&apos;re paid the amount shown in the offer after the campaign ends. We may hold back a payout if a campaign wasn&apos;t run as agreed.</li>
      </ul>

      <h2>Things you can&apos;t do</h2>
      <p>
        Don&apos;t misuse Divvit: no listing a café you don&apos;t run, no fake scans or accounts, no scraping or overloading the
        service, no getting around its security, and nothing that breaks the law or someone else&apos;s rights.
      </p>

      <h2>Our part</h2>
      <p>
        Divvit, its design and its software belong to us. We work to keep the service running and your data safe, but it&apos;s
        provided as it is, without guarantees beyond those the law requires. We may change or stop parts of it, and we&apos;ll give
        notice of changes that matter.
      </p>

      <h2>Liability</h2>
      <p>
        To the extent the law allows, Divvit isn&apos;t liable for indirect or consequential losses, such as lost profits, and our total
        liability for any claim is limited to the amount you paid us, or that we paid you, in the 12 months before it.
      </p>

      <h2>Ending your account</h2>
      <p>
        You can close your account at any time by emailing us. We may suspend or close accounts that break these terms. Campaigns
        already paid for and accepted will be completed or refunded fairly.
      </p>

      <h2>Changes to these terms</h2>
      <p>If we change these terms in a way that matters, we&apos;ll update the date above and email account holders before the change takes effect.</p>

      <h2>Contact</h2>
      <p>Questions about these terms: <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.</p>

      <a className="back" href={site("/")}>← Back to Divvit</a>
    </main>
  );
}
