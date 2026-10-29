"use client";

/* Pay for a campaign the Divvit team approved. Shows what was approved and the
   final price, then hands off to Stripe Checkout. Checkout comes back here with
   ?session_id=…, which confirms the payment and sends the campaign to cafés. */

import { useRouter, useSearchParams } from "next/navigation";
import React from "react";
import { useMp } from "./session";
import { FlowBar, Question } from "./flow";
import { CheckIcon } from "./art";
import { money, num, plural } from "@/lib/marketplace/format";

type Campaign = {
  id: string; name: string; status: string; start_date: string | null; weeks: number; sleeves_per_cafe: number; branded_drink: boolean;
  total_cents: number; final_cents: number | null; review_note: string | null; paid_at: string | null;
  cafes: { cafe_name: string; neighborhood: string | null; city: string; status: string; sleeves: number }[];
};
const day = (d: string | null) => (d ? new Date(`${d.slice(0, 10)}T12:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "To be set");

export function CampaignPay({ id }: { id: string }) {
  const { supabase, user, loading } = useMp();
  const router = useRouter();
  const params = useSearchParams();
  const [c, setC] = React.useState<Campaign | null | undefined>(undefined);
  const [configured, setConfigured] = React.useState<boolean | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [confirming, setConfirming] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    const { data } = await supabase.rpc("mp_my_campaigns");
    setC(((data as Campaign[]) ?? []).find((x) => x.id === id) ?? null);
  }, [supabase, id]);

  React.useEffect(() => {
    if (loading) return;
    if (!user) { router.replace(`/signin?next=/campaigns/${id}/pay`); return; }
    fetch(`/api/campaigns/${id}/checkout`).then((r) => r.json()).then((j) => setConfigured(Boolean(j.configured))).catch(() => setConfigured(false));
    const session = params.get("session_id");
    if (!session) { load(); return; }
    // back from Stripe: confirm the payment, then show where the campaign stands
    setConfirming(true);
    fetch(`/api/campaigns/${id}/confirm`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ session_id: session }) })
      .then(async (r) => { if (!r.ok) setError((await r.json().catch(() => ({}))).error ?? "We couldn't confirm the payment yet."); })
      .finally(() => { setConfirming(false); history.replaceState(null, "", `/campaigns/${id}/pay`); load(); });
  }, [loading, user, router, id, params, load]);

  async function pay() {
    setBusy(true); setError(null);
    try {
      const r = await fetch(`/api/campaigns/${id}/checkout`, { method: "POST" });
      const j = await r.json();
      if (!r.ok || !j.url) throw new Error(j.error ?? "Couldn't start the payment.");
      window.location.href = j.url;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  if (c === undefined || confirming) {
    return (<><FlowBar /><Question title={confirming ? "Confirming your payment…" : "One moment…"} /></>);
  }
  if (c === null) {
    return (<><FlowBar /><Question title="Campaign not found" sub="It may belong to another account." cta="Go to home" onContinue={() => router.push("/home")} /></>);
  }

  const home = () => router.push("/home#campaigns");
  const sleeves = c.cafes.reduce((s, x) => s + x.sleeves, 0);
  const price = c.final_cents ?? c.total_cents;
  const summary = (
    <div className="mp-summary">
      <div className="row"><span>Campaign</span><b>{c.name}</b></div>
      <div className="row"><span>Cafés</span><b>{num(c.cafes.length)}</b></div>
      <div className="row"><span>Sleeves</span><b>{num(sleeves)}</b></div>
      <div className="row"><span>When</span><b>{day(c.start_date)} · {plural(c.weeks, "week")}</b></div>
      <div className="row"><span>Branded drink</span><b>{c.branded_drink ? "Yes" : "No"}</b></div>
      {c.final_cents != null && c.final_cents !== c.total_cents && <div className="row"><span>Projected price</span><b className="was">{money(c.total_cents, { cents: true })}</b></div>}
      <div className="row total"><span>{c.status === "submitted" ? "Projected price" : "Price"}</span><b>{money(price, { cents: true })}</b></div>
    </div>
  );

  if (["paid", "active", "completed"].includes(c.status)) {
    return (
      <>
        <FlowBar progress={1} />
        <Question title="You're paid up" sub={`“${c.name}” is on its way to ${plural(c.cafes.length, "café")}. You'll see each one accept on your dashboard.`}
          cta="Go to your campaigns" onContinue={home}>
          <div className="mp-done"><CheckIcon /></div>
          {error && <div className="mp-error">{error}</div>}
          <p className="mp-note" style={{ textAlign: "center" }}>Stripe emailed you a receipt and an invoice.</p>
        </Question>
      </>
    );
  }
  if (c.status === "submitted") {
    return (
      <>
        <FlowBar />
        <Question title="Still in review" sub="Someone from the Divvit team will reach out within 24 hours. Once your campaign is approved, you'll pay here."
          cta="Go to your campaigns" onContinue={home}>{summary}</Question>
      </>
    );
  }
  if (c.status !== "approved") {
    return (
      <>
        <FlowBar />
        <Question title="This campaign isn't waiting for payment" sub={c.review_note ?? "Reach out to the Divvit team if you have questions."}
          cta="Go to your campaigns" onContinue={home} />
      </>
    );
  }

  return (
    <>
      <FlowBar right={<button type="button" className="mp-link" onClick={home}>Not now</button>} />
      <Question title="Pay for your campaign" sub="The Divvit team approved it. Once you pay, we send it to your cafés and get your sleeves printed."
        cta={configured === false ? "Payments aren't switched on yet" : `Pay ${money(price, { cents: true })}`}
        onContinue={pay} canContinue={configured === true} busy={busy}>
        {summary}
        {c.review_note && <div className="mp-found"><span>A note from the Divvit team: {c.review_note}</span></div>}
        {params.get("canceled") && <p className="mp-note">Payment canceled — nothing was charged. You can try again any time.</p>}
        {error && <div className="mp-error">{error}</div>}
        <p className="mp-note">Secure payment by Stripe. You&apos;ll get a receipt and an invoice by email. If a café passes, we swap in another or refund its share.</p>
      </Question>
    </>
  );
}
