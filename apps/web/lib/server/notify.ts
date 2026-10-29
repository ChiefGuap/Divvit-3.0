import { serverDb } from "./db";
import { marketplace } from "@/lib/urls";

/* Sends whatever the database has queued in mp_outbox through Resend, one email
   per step of a campaign, and marks each row done. Anything that can't be sent
   stays queued for the next call.
     campaign_submitted → Divvit team: review this campaign (within 24 hours)
     campaign_approved  → startup: approved, pay to send it to cafés
     campaign_declined  → startup: the team's note
     campaign_paid      → Divvit team: payment received
     offer_new          → café owner: a paid campaign wants your cups
     campaign_finished  → startup: the campaign is over, its report is ready
     cafe_verification  → Divvit team: a café asked to be verified by phone or by hand
   RESEND_API_KEY, DIVVIT_TEAM_EMAIL (comma-separated), DIVVIT_FROM_EMAIL (verified sender) */

type Pending = {
  id: number; kind: "campaign_submitted" | "campaign_approved" | "campaign_declined" | "campaign_paid" | "offer_new" | "campaign_finished" | "cafe_verification";
  // campaign rows carry these three; café rows (cafe_verification) carry `cafe` instead
  campaign: { id: string; name: string; start_date: string | null; weeks: number; sleeves_per_cafe: number; branded_drink: boolean;
    total_cents: number; final_cents: number | null; review_note: string | null; design_url: string | null; created_at: string } | null;
  startup: { name: string; website: string | null; category: string; hq: string | null; description: string | null; linkedin_url: string | null } | null;
  owner: { email: string; name: string | null } | null;
  cafes: { name: string; neighborhood: string | null; city: string; sleeves: number; demo: boolean }[];
  offer: { id: string; cafe_name: string; sleeves: number; payout_cents: number; branded_drink: boolean; email: string; name: string | null } | null;
  cafe: { id: string; name: string; address: string | null; neighborhood: string | null; city: string; website: string | null; osm_ref: string | null;
    email: string; name_of_owner: string | null; method: "phone" | "review" | "website" | null } | null;
};
export type Mail = { to: string[]; subject: string; text: string; html: string; replyTo?: string };

const money = (c: number) => (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);
const when = (k: NonNullable<Pending["campaign"]>) => (k.start_date
  ? new Date(`${k.start_date}T12:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
  : "unscheduled");
const first = (name: string | null) => (name || "").split(" ")[0] || "there";

/** a plain email: a heading, a few lines, an optional facts table and a button */
export function compose({ heading, lines, facts = [], list, button, footer }: {
  heading: string; lines: string[]; facts?: [string, string][]; list?: { title: string; items: string[] };
  button?: { label: string; href: string }; footer?: string;
}) {
  const text = [heading, "", ...lines, ...(facts.length ? ["", ...facts.map(([a, b]) => `${a}: ${b}`)] : []),
    ...(list ? ["", `${list.title}:`, ...list.items.map((x) => `- ${x}`)] : []),
    ...(button ? ["", `${button.label}: ${button.href}`] : []), ...(footer ? ["", footer] : [])].join("\n");
  const html = `<div style="font-family:Inter,Arial,sans-serif;color:#111;max-width:620px">
<h2 style="margin:0 0 10px">${esc(heading)}</h2>
${lines.map((l) => `<p style="margin:0 0 10px;color:#333;line-height:1.5">${esc(l)}</p>`).join("")}
${facts.length ? `<table style="border-collapse:collapse;font-size:14px;margin-top:6px">${facts.map(([a, b]) => `<tr><td style="padding:4px 14px 4px 0;color:#777;vertical-align:top">${esc(a)}</td><td style="padding:4px 0">${esc(b)}</td></tr>`).join("")}</table>` : ""}
${list ? `<h3 style="margin:18px 0 6px;font-size:15px">${esc(list.title)}</h3><ul style="margin:0;padding-left:18px;font-size:14px">${list.items.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
${button ? `<p style="margin:22px 0 0"><a href="${esc(button.href)}" style="display:inline-block;background:#8c52ff;color:#fff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:10px">${esc(button.label)}</a></p>` : ""}
${footer ? `<p style="margin:22px 0 0;color:#777;font-size:13px">${esc(footer)}</p>` : ""}</div>`;
  return { text, html };
}

function message(p: Pending, team: string[]): Mail | null {
  if (p.kind === "cafe_verification") {
    const c = p.cafe;
    if (!c) return null;
    const how = c.method === "phone" ? "Call the café on its public number and read them the 6-digit code shown in admin." : "Look the café up and confirm they run it, then approve it in admin.";
    const { text, html } = compose({
      heading: `Verify ${c.name}`,
      lines: [`${c.name} asked to be verified ${c.method === "phone" ? "by phone" : "by the Divvit team"}. Startups can't see it until it's verified.`, how],
      facts: [["Café", c.name], ["Where", [c.address, c.neighborhood, c.city].filter(Boolean).join(", ")], ["Owner", `${c.name_of_owner ?? ""} <${c.email}>`.trim()],
        ["Website", c.website ?? "—"], ["Map listing", c.osm_ref ? `https://www.openstreetmap.org/${c.osm_ref}` : "—"]],
      button: { label: "Open admin", href: marketplace("/admin#cafes") },
    });
    return { to: team, subject: `Verify a café: ${c.name}, ${c.city}`, text, html, replyTo: c.email };
  }
  const k = p.campaign, s = p.startup, owner = p.owner;
  if (!k || !s || !owner) return null;
  const cafeLine = (c: Pending["cafes"][number]) => `${c.name} — ${[c.neighborhood, c.city].filter(Boolean).join(", ")} · ${c.sleeves.toLocaleString("en-US")} sleeves${c.demo ? " (sample café)" : ""}`;
  const campaignFacts: [string, string][] = [["Starts", `${when(k)} · ${k.weeks} weeks`], ["Sleeves per café", k.sleeves_per_cafe.toLocaleString("en-US")],
    ["Branded drink", k.branded_drink ? "Yes" : "No"], ["Cafés", String(p.cafes.length)]];

  switch (p.kind) {
    case "campaign_submitted": {
      const { text, html } = compose({
        heading: `New campaign: ${k.name}`,
        lines: ["Reach out within 24 hours — the startup was told to expect it. Approve it (and confirm the price) in admin."],
        facts: [["Startup", s.name], ["Contact", `${owner.name ?? ""} <${owner.email}>`.trim()], ["Website", s.website ?? "—"],
          ["LinkedIn", s.linkedin_url ?? "—"], ["Based in", s.hq ?? "—"], ["What they do", s.description ?? "—"], ...campaignFacts,
          ["Projected price", money(k.total_cents)]],
        list: { title: "Cafés", items: p.cafes.map(cafeLine) },
        button: { label: "Review in admin", href: marketplace("/admin#campaigns") },
        footer: k.design_url ? `Sleeve design: ${k.design_url}` : undefined,
      });
      return { to: team, subject: `New campaign: ${s.name} · ${p.cafes.length} cafés · ${money(k.total_cents)} projected`, text, html, replyTo: owner.email };
    }
    case "campaign_approved": {
      const price = money(k.final_cents ?? k.total_cents);
      const { text, html } = compose({
        heading: "Your campaign is approved",
        lines: [`Hi ${first(owner.name)},`, `“${k.name}” is ready to go. Pay ${price} and we'll send it to the cafés you picked.`,
          ...(k.review_note ? [`A note from the Divvit team: ${k.review_note}`] : [])],
        facts: [...campaignFacts, ["Price", price]],
        button: { label: `Pay ${price}`, href: marketplace(`/campaigns/${k.id}/pay`) },
        footer: "You'll also find this on your Divvit dashboard.",
      });
      return { to: [owner.email], subject: `Your Divvit campaign is approved — pay ${price} to launch`, text, html, replyTo: team[0] };
    }
    case "campaign_declined": {
      const { text, html } = compose({
        heading: "About your campaign",
        lines: [`Hi ${first(owner.name)},`, `We can't run “${k.name}” as it is. ${k.review_note ?? ""}`.trim(), "You haven't been charged. Reply to this email and we'll help you set up another one."],
        button: { label: "Open Divvit", href: marketplace("/home#campaigns") },
      });
      return { to: [owner.email], subject: "About your Divvit campaign", text, html, replyTo: team[0] };
    }
    case "campaign_paid": {
      const { text, html } = compose({
        heading: `Paid: ${k.name}`,
        lines: [`${s.name} paid ${money(k.final_cents ?? k.total_cents)}. The offers went out to the cafés below.`],
        facts: [["Startup", s.name], ["Contact", owner.email], ...campaignFacts],
        list: { title: "Cafés", items: p.cafes.map(cafeLine) },
        button: { label: "Open admin", href: marketplace("/admin#campaigns") },
      });
      return { to: team, subject: `Paid: ${s.name} · ${money(k.final_cents ?? k.total_cents)}`, text, html };
    }
    case "offer_new": {
      const o = p.offer;
      if (!o) return null;
      const { text, html } = compose({
        heading: `New campaign from ${s.name}`,
        lines: [`Hi ${first(o.name)},`, `${s.name} wants to put its brand on ${o.cafe_name}'s cups. You'd earn ${money(o.payout_cents)}.`,
          ...(s.description ? [`What they do: ${s.description}`] : []), "Accept or pass from your inbox — you approve every campaign, and passing costs nothing."],
        facts: [["You'd earn", money(o.payout_cents)], ["Sleeves", o.sleeves.toLocaleString("en-US")], ["Starts", `${when(k)} · ${k.weeks} weeks`],
          ["Branded drink", o.branded_drink ? "Yes" : "No"]],
        button: { label: "Review the offer", href: marketplace(`/cafes/inbox#offer-${o.id}`) },
        footer: "Sleeves arrive printed and packed before the start date.",
      });
      return { to: [o.email], subject: `New campaign from ${s.name}: earn ${money(o.payout_cents)}`, text, html, replyTo: team[0] };
    }
    case "campaign_finished": {
      const { text, html } = compose({
        heading: "Your campaign report is ready",
        lines: [`Hi ${first(owner.name)},`, `“${k.name}” has finished. Your report shows how many people scanned your sleeve, day by day, what it cost per scan and how many people it reached.`],
        facts: campaignFacts,
        button: { label: "See your report", href: marketplace(`/campaigns/${k.id}/report`) },
        footer: "Thinking about the next one? Reply to this email and we'll help you plan it.",
      });
      return { to: [owner.email], subject: `Your Divvit campaign report: ${k.name}`, text, html, replyTo: team[0] };
    }
  }
}

export type SendResult = { sent: number; pending: number; configured: boolean };

export const emailConfigured = () => Boolean(process.env.RESEND_API_KEY);

/** Send one email now through Resend (for links that can't wait for the outbox). */
export async function sendEmail(m: Mail) {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("Email isn't set up (RESEND_API_KEY)");
  const team = (process.env.DIVVIT_TEAM_EMAIL ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: process.env.DIVVIT_FROM_EMAIL || "Divvit <onboarding@resend.dev>", to: m.to, subject: m.subject,
      text: m.text, html: m.html, reply_to: m.replyTo ?? team[0] }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok) throw new Error(`Resend ${r.status}: ${(await r.text()).slice(0, 200)}`);
}

export async function sendPendingEmails(): Promise<SendResult> {
  const { db, secret } = serverDb();
  const { data, error } = await db.rpc("mp_outbox_pending", { p_secret: secret });
  if (error) throw new Error(error.message);
  const pending = (data as Pending[]) ?? [];

  const key = process.env.RESEND_API_KEY, team = (process.env.DIVVIT_TEAM_EMAIL ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  if (!key || !team.length) return { sent: 0, pending: pending.length, configured: false };

  let sent = 0;
  for (const p of pending) {
    const m = message(p, team);
    try {
      if (!m) throw new Error("nothing to send for this row");
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: process.env.DIVVIT_FROM_EMAIL || "Divvit <onboarding@resend.dev>", to: m.to, subject: m.subject,
          text: m.text, html: m.html, ...(m.replyTo ? { reply_to: m.replyTo } : {}) }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!r.ok) throw new Error(`Resend ${r.status}: ${(await r.text()).slice(0, 200)}`);
      await db.rpc("mp_outbox_done", { p_secret: secret, p_id: p.id, p_error: null });
      sent++;
    } catch (e) {
      await db.rpc("mp_outbox_done", { p_secret: secret, p_id: p.id, p_error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { sent, pending: pending.length - sent, configured: true };
}

/** The work-email link that confirms a startup is the company it names (app/api/startups/confirm). */
export function companyConfirmEmail(startup: string, to: string, link: string): Mail {
  const { text, html } = compose({
    heading: `Confirm ${startup} on Divvit`,
    lines: [`Someone signed up to run coffee-sleeve campaigns for ${startup} and asked us to confirm it's really your company.`,
      "If that was you, click below. The link works once, for 24 hours."],
    button: { label: `Confirm ${startup}`, href: link },
    footer: "If you didn't ask for this, ignore this email and nothing will change. Questions: reply to this email.",
  });
  return { to: [to], subject: `Confirm ${startup} on Divvit`, text, html };
}

/** Every email Divvit sends, filled in with made-up details, for the team to read before launch (admin → Emails). */
export function sampleEmails(team: string[]): { kind: string; label: string; mail: Mail }[] {
  const base: Omit<Pending, "id" | "kind"> = {
    campaign: { id: "sample", name: "Lumen · Williamsburg, Lower East Side", start_date: "2026-11-17", weeks: 4, sleeves_per_cafe: 1000,
      branded_drink: true, total_cents: 482_000, final_cents: 460_000, review_note: null, design_url: null, created_at: new Date().toISOString() },
    startup: { name: "Lumen", website: "https://lumen.example", category: "tech", hq: "New York, NY",
      description: "AI meeting notes that write themselves.", linkedin_url: "https://www.linkedin.com/company/lumen-example" },
    owner: { email: "jane@lumen.example", name: "Jane Park" },
    cafes: [
      { name: "Juniper Coffee", neighborhood: "Williamsburg", city: "New York", sleeves: 1000, demo: false },
      { name: "Second Shot", neighborhood: "Lower East Side", city: "New York", sleeves: 1000, demo: false },
    ],
    offer: { id: "sample", cafe_name: "Juniper Coffee", sleeves: 1000, payout_cents: 12_600, branded_drink: true, email: "owner@juniper.example", name: "Sam Rivera" },
    cafe: { id: "sample", name: "Juniper Coffee", address: "120 Grand St", neighborhood: "Williamsburg", city: "New York",
      website: "https://juniper.example", osm_ref: "node/123", email: "owner@juniper.example", name_of_owner: "Sam Rivera", method: "phone" },
  };
  const kinds: [Pending["kind"], string, Partial<Pending>?][] = [
    ["campaign_submitted", "New campaign → Divvit team"],
    ["campaign_approved", "Approved, pay to launch → startup"],
    ["campaign_declined", "Not approved → startup", { campaign: { ...base.campaign!, review_note: "None of these cafés can take a fintech campaign right now. Try the cafés in DUMBO." } }],
    ["campaign_paid", "Payment received → Divvit team"],
    ["offer_new", "New offer → café"],
    ["campaign_finished", "Report ready → startup"],
    ["cafe_verification", "Verify a café → Divvit team"],
  ];
  const out = kinds.map(([kind, label, extra]) => ({ kind: kind as string, label, mail: message({ id: 0, kind, ...base, ...extra } as Pending, team) }))
    .filter((x): x is { kind: string; label: string; mail: Mail } => x.mail !== null);
  out.push({ kind: "company_confirm", label: "Confirm your company → startup's work email",
    mail: companyConfirmEmail("Lumen", "jane@lumen.example", "https://marketplace.divvit.app/api/startups/confirm?token=…") });
  return out;
}
