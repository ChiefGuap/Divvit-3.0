"use client";

/* Campaigns waiting on the Divvit team. Each shows who sent it, what they picked
   and the projected price. Approving sets the final price and asks the startup to
   pay (email + dashboard notice); declining sends them the note instead. Paying
   is what releases the offers to cafés. */

import React from "react";
import { useMp } from "./session";
import { money, num, plural } from "@/lib/marketplace/format";
import { categoryLabel } from "@/lib/marketplace/categories";

type Row = {
  id: string; name: string; status: string; start_date: string | null; weeks: number; sleeves_per_cafe: number; branded_drink: boolean;
  design_url: string | null; subtotal_cents: number; discount_cents: number; fee_cents: number; total_cents: number; final_cents: number | null;
  review_note: string | null; reviewed_at: string | null; paid_at: string | null; created_at: string;
  startup_name: string; website: string | null; category: string; hq: string | null; description: string | null; linkedin_url: string | null;
  owner_email: string; owner_name: string | null;
  cafes: { name: string; neighborhood: string | null; city: string; is_demo: boolean; status: string; sleeves: number; price_cents: number; payout_cents: number }[];
};

const TABS = [["review", "To review"], ["approved", "Waiting for payment"], ["paid", "Paid & live"], ["closed", "Declined"]] as const;
type Tab = (typeof TABS)[number][0];
const IN: Record<Tab, string[]> = { review: ["submitted"], approved: ["approved"], paid: ["paid", "active", "completed"], closed: ["declined", "cancelled"] };
const LABEL: Record<string, string> = { submitted: "To review", approved: "Waiting for payment", paid: "Paid", active: "Live", completed: "Finished", declined: "Declined", cancelled: "Cancelled" };
const day = (d: string | null) => (d ? new Date(d.length === 10 ? `${d}T12:00` : d).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—");
const exact = (c: number) => money(c, { cents: true });

export function AdminCampaigns() {
  const { supabase } = useMp();
  const [rows, setRows] = React.useState<Row[] | null>(null);
  const [tab, setTab] = React.useState<Tab>("review");
  const [open, setOpen] = React.useState<string | null>(null);
  const [price, setPrice] = React.useState<Record<string, string>>({});
  const [note, setNote] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    const { data, error } = await supabase.rpc("mp_admin_campaigns");
    if (error) setError(error.message);
    else setRows(data as Row[]);
  }, [supabase]);
  React.useEffect(() => { load(); }, [load]);

  async function review(r: Row, approve: boolean) {
    setBusy(r.id); setError(null);
    const typed = parseFloat((price[r.id] ?? "").replace(/[$,\s]/g, ""));
    const cents = approve ? (Number.isFinite(typed) ? Math.round(typed * 100) : r.final_cents ?? r.total_cents) : null;
    const { error } = await supabase.rpc("mp_admin_review_campaign", { p_campaign: r.id, p_approve: approve, p_final_cents: cents, p_note: note[r.id]?.trim() || null });
    if (error) setError(error.message);
    else fetch("/api/campaigns/notify", { method: "POST" }).catch(() => {}); // the startup's email
    await load();
    setBusy(null);
  }

  if (!rows) return error ? <div className="mp-error">{error}</div> : <p className="mp-note">Loading…</p>;
  const shown = rows.filter((r) => IN[tab].includes(r.status));

  return (
    <>
      <div className="mp-tabs">
        {TABS.map(([id, label]) => (
          <button key={id} type="button" className={`mp-chip${tab === id ? " on" : ""}`} onClick={() => setTab(id)}>
            {label} <small>{rows.filter((r) => IN[id].includes(r.status)).length}</small>
          </button>
        ))}
      </div>
      {error && <div className="mp-error">{error}</div>}

      {shown.length === 0 ? <div className="mp-empty"><b>Nothing here</b>New campaigns show up in “To review”.</div> : shown.map((r) => {
        const real = r.cafes.filter((c) => !c.is_demo).length;
        const samples = r.cafes.length - real;
        // sample cafés come off when it's approved: suggest the real cafés' share of the projected price
        const priced = r.cafes.reduce((s, c) => s + c.price_cents, 0);
        const realShare = priced ? r.cafes.filter((c) => !c.is_demo).reduce((s, c) => s + c.price_cents, 0) / priced : 1;
        const final = r.final_cents ?? (samples && real ? Math.round(r.total_cents * realShare) : r.total_cents);
        return (
          <div key={r.id} className="mp-item">
            <div className="mp-item-head" onClick={() => setOpen(open === r.id ? null : r.id)}>
              <div className="t">
                <b>{r.startup_name} · {r.name.replace(`${r.startup_name} · `, "")}</b>
                <small>{plural(r.cafes.length, "café")} · {plural(r.weeks, "week")} · sent {day(r.created_at)}{real === 0 ? " · sample cafés only" : ""}</small>
              </div>
              <span className={`mp-pill ${r.status}`}>{LABEL[r.status] ?? r.status}</span>
              <span className="amt">{money(final)}{r.status === "submitted" && <small> projected</small>}</span>
            </div>
            {open === r.id && (
              <div className="mp-item-body mp-review">
                <div className="cols">
                  <div>
                    <span className="k">Startup</span>
                    <b>{r.startup_name}</b>
                    <span>{r.owner_name || "—"} · <a href={`mailto:${r.owner_email}`}>{r.owner_email}</a></span>
                    <small>{[categoryLabel(r.category), r.hq].filter(Boolean).join(" · ")}</small>
                    {r.description && <small>{r.description}</small>}
                    {(r.website || r.linkedin_url) && (
                      <small>
                        {r.website && <a href={r.website} target="_blank" rel="noreferrer noopener">Website ↗</a>}
                        {r.website && r.linkedin_url && " · "}
                        {r.linkedin_url && <a href={r.linkedin_url} target="_blank" rel="noreferrer noopener">LinkedIn ↗</a>}
                      </small>
                    )}
                  </div>
                  <div>
                    <span className="k">Campaign</span>
                    <b>Starts {day(r.start_date)} · {plural(r.weeks, "week")}</b>
                    <span>{num(r.sleeves_per_cafe)} sleeves per café{r.branded_drink ? " · branded drink" : ""}</span>
                    {r.design_url && <a href={r.design_url} target="_blank" rel="noreferrer noopener">Sleeve design ↗</a>}
                  </div>
                </div>

                <div className="mp-lines">
                  {r.cafes.map((c, k) => (
                    <div key={k}>
                      <span>{c.name}{c.is_demo && " (sample)"}<small>{[c.neighborhood, c.city].filter(Boolean).join(", ")} · {num(c.sleeves)} sleeves · pays the café {exact(c.payout_cents)}</small></span>
                      {IN.paid.includes(r.status) ? <span className={`mp-pill ${c.status}`}>{c.status === "declined" ? "Passed" : c.status === "accepted" ? "Accepted" : "Pending"}</span> : <b>{exact(c.price_cents)}</b>}
                    </div>
                  ))}
                  {r.discount_cents > 0 && <div><span>Volume discount</span><b>−{exact(r.discount_cents)}</b></div>}
                  <div><span>Service fee</span><b>{exact(r.fee_cents)}</b></div>
                  <div className="total"><span>Projected price</span><b>{exact(r.total_cents)}</b></div>
                </div>

                {["submitted", "approved"].includes(r.status) ? (
                  <div className="adm-decide">
                    {samples > 0 && (
                      <div className="mp-found"><span>{real === 0
                        ? "Every café here is a sample café, so this campaign can't run. Decline it with a note (for example, which real cafés nearby could run it), or wait until some join."
                        : `${plural(samples, "sample café")} will come off when you approve, since sample cafés can't run campaigns. The price below is the real cafés' share.`}</span></div>
                    )}
                    {r.status === "approved" && <p className="mp-note">Approved {day(r.reviewed_at)} — waiting for {r.owner_email} to pay {exact(final)}. Change the price and approve again to send a new request.</p>}
                    <label className="adm-field"><span>Final price</span>
                      <input className="mp-input" inputMode="decimal" value={price[r.id] ?? (final / 100).toFixed(2)}
                        onChange={(e) => setPrice((x) => ({ ...x, [r.id]: e.target.value }))} />
                    </label>
                    <label className="adm-field"><span>Note to the startup (optional)</span>
                      <textarea className="mp-input" rows={2} value={note[r.id] ?? ""} placeholder="e.g. We swapped one café for a busier one nearby."
                        onChange={(e) => setNote((x) => ({ ...x, [r.id]: e.target.value }))} />
                    </label>
                    <div className="mp-row-actions">
                      <button className="mp-btn primary" disabled={busy === r.id || real === 0} onClick={() => review(r, true)}>
                        {r.status === "approved" ? "Update and ask again" : "Approve and ask for payment"}
                      </button>
                      <button className="mp-btn" disabled={busy === r.id} onClick={() => review(r, false)}>Decline</button>
                    </div>
                  </div>
                ) : IN.paid.includes(r.status) ? (
                  <p className="mp-note">Paid {exact(final)} on {day(r.paid_at)}. If a café passes, swap in another nearby or refund its share from the Stripe dashboard.</p>
                ) : (
                  r.review_note && <p className="mp-note">Note sent: {r.review_note}</p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
