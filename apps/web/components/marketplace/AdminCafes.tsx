"use client";

/* Divvit's café verification queue (admins only). Each café shows who claimed
   it next to what its public listing says, so a reviewer can tell the real
   owner from someone posing as them — and, for phone checks, the code to read
   out when calling the café's public number. */

import { useRouter } from "next/navigation";
import React from "react";
import { useMp } from "./session";
import { AppBar } from "./flow";
import { num } from "@/lib/marketplace/format";
import type { CafeDetails } from "@/app/api/cafes/details/route";

type Row = {
  id: string; name: string; address: string | null; neighborhood: string | null; city: string; region: string | null;
  website: string | null; instagram: string | null; osm_ref: string | null; status: "unverified" | "pending" | "verified" | "rejected";
  verified_at: string | null; created_at: string; weekly_cups: number; sleeves_per_month: number;
  owner_email: string; owner_name: string | null; owner_since: string;
  method: "website" | "phone" | "review" | null; phone_code: string | null; requested_at: string | null; attempts: number | null; note: string | null;
  same_place: number; place_taken: boolean;
};

const TABS = [["check", "To check"], ["verified", "Verified"], ["rejected", "Rejected"], ["all", "All"]] as const;
const METHOD: Record<string, string> = { website: "Website code", phone: "Phone call", review: "Manual check" };
const day = (d: string | null) => (d ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—");
const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };
/** loose name match: "Devoción" ≈ "Devocion Coffee", "Blue Bottle" ≈ "Blue Bottle Coffee" */
const sameName = (a: string, b: string) => {
  const w = (s: string) => new Set(s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().split(/[^a-z0-9]+/)
    .filter((x) => x.length > 2 && !["cafe", "coffee", "the", "and", "shop", "bar", "roasters"].includes(x)));
  const x = w(a), y = w(b);
  return [...x].some((t) => y.has(t));
};

/** bare: just the queue, for the Divvit team page (components/marketplace/Admin.tsx) */
export function AdminCafes({ bare }: { bare?: boolean } = {}) {
  const { supabase, user, loading } = useMp();
  const router = useRouter();
  const [rows, setRows] = React.useState<Row[] | null>(null);
  const [denied, setDenied] = React.useState(false);
  const [tab, setTab] = React.useState<(typeof TABS)[number][0]>("check");
  const [open, setOpen] = React.useState<string | null>(null);
  const [listing, setListing] = React.useState<Record<string, CafeDetails | "none">>({});
  const [busy, setBusy] = React.useState<string | null>(null);
  const [reason, setReason] = React.useState<Record<string, string>>({});
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    const { data, error } = await supabase.rpc("mp_admin_cafes");
    if (error) { setDenied(true); return; }
    setRows(data as Row[]);
  }, [supabase]);

  React.useEffect(() => {
    if (loading) return;
    if (!user) { router.replace("/signin?next=/admin"); return; }
    load();
  }, [loading, user, router, load]);

  // what the café's public listing says, fetched when a reviewer opens it
  React.useEffect(() => {
    const r = rows?.find((x) => x.id === open);
    if (!r || listing[r.id]) return;
    if (!r.osm_ref) { setListing((l) => ({ ...l, [r.id]: "none" })); return; }
    fetch(`/api/cafes/details?ref=${encodeURIComponent(r.osm_ref)}`).then((x) => x.json())
      .then((d: CafeDetails) => setListing((l) => ({ ...l, [r.id]: d }))).catch(() => setListing((l) => ({ ...l, [r.id]: "none" })));
  }, [open, rows, listing]);

  async function decide(id: string, approve: boolean) {
    setBusy(id); setError(null);
    const { error } = await supabase.rpc("mp_admin_decide", { p_cafe: id, p_approve: approve, p_note: approve ? null : (reason[id] || "We couldn't confirm you run this café.") });
    if (error) setError(error.message);
    await load();
    setBusy(null);
  }

  if (denied) {
    return (<><AppBar /><main className="mp-page"><h1>Admins only</h1><p className="sub">This page is for the Divvit team.</p></main></>);
  }
  if (!rows) return bare ? <p className="mp-note">Loading…</p> : <AppBar />;

  const inTab = (r: Row) => (tab === "all" ? true : tab === "check" ? r.status === "pending" || r.status === "unverified" : r.status === tab);
  const count = (t: (typeof TABS)[number][0]) => rows.filter((r) => (t === "all" ? true : t === "check" ? r.status === "pending" || r.status === "unverified" : r.status === t)).length;
  const shown = rows.filter(inTab);

  const body = (
    <>
        <div className="mp-tabs">
          {TABS.map(([id, label]) => (
            <button key={id} type="button" className={`mp-chip${tab === id ? " on" : ""}`} onClick={() => setTab(id)}>{label} <small>{count(id)}</small></button>
          ))}
        </div>
        {error && <div className="mp-error">{error}</div>}

        {shown.length === 0 ? <div className="mp-empty"><b>Nothing here</b>New café claims show up in “To check”.</div> : shown.map((r) => {
          const l = listing[r.id];
          const pub = l && l !== "none" ? l : null;
          return (
            <div key={r.id} className="mp-item">
              <div className="mp-item-head" onClick={() => setOpen(open === r.id ? null : r.id)}>
                <div className="t">
                  <b>{r.name}</b>
                  <small>{[r.address, r.neighborhood, r.city].filter(Boolean).join(", ")} · {r.method ? METHOD[r.method] : "Hasn't started"}</small>
                </div>
                {r.place_taken && <span className="mp-pill rejected">Place already verified</span>}
                <span className={`mp-pill ${r.status}`}>{r.status === "unverified" ? "Not started" : r.status[0].toUpperCase() + r.status.slice(1)}</span>
              </div>
              {open === r.id && (
                <div className="mp-item-body mp-review">
                  <div className="cols">
                    <div>
                      <span className="k">Claimed by</span>
                      <b>{r.owner_name || "—"}</b>
                      <span>{r.owner_email}</span>
                      <small>Account since {day(r.owner_since)} · listed {day(r.created_at)}</small>
                      <small>{num(r.weekly_cups)} cups/week · {num(r.sleeves_per_month)} sleeves/month</small>
                      {(r.website || r.instagram) && <small>Typed in: {[r.website && host(r.website), r.instagram && "Instagram"].filter(Boolean).join(" · ")}</small>}
                    </div>
                    <div>
                      <span className="k">Public listing</span>
                      {!r.osm_ref ? <span>Not on OpenStreetMap — check Google Maps / Yelp for this address and call the number listed there.</span>
                        : !l ? <span className="mp-muted">Looking it up…</span>
                        : !pub ? <span>Couldn&apos;t load the map listing.</span> : (
                          <>
                            <b>{pub.name || "Unnamed place"}</b>
                            {pub.name && !sameName(pub.name, r.name) && <span className="warn">Listed as “{pub.name}”, claimed as “{r.name}”.</span>}
                            <a href={`https://www.openstreetmap.org/${r.osm_ref}`} target="_blank" rel="noreferrer noopener">OpenStreetMap entry ↗</a>
                            {pub.phone ? <a href={`tel:${pub.phone}`}>{pub.phone}</a> : <span className="mp-muted">No public phone</span>}
                            {pub.website ? <a href={pub.website} target="_blank" rel="noreferrer noopener">{host(pub.website)} ↗</a> : <span className="mp-muted">No public website</span>}
                            {pub.newOnMap && <span className="warn">Added to the map in the last 90 days — be extra careful.</span>}
                          </>
                        )}
                      {r.same_place > 0 && <span className="warn">{r.same_place} other account{r.same_place === 1 ? "" : "s"} claimed this same place.</span>}
                    </div>
                  </div>

                  {r.method === "phone" && r.status === "pending" && (
                    <div className="mp-code">
                      <span>Call {pub?.phone || "the café's public number"} and read out</span>
                      <code>{r.phone_code?.replace(/(\d{3})(\d{3})/, "$1 $2")}</code>
                      <small className="mp-muted">{r.attempts ?? 0}/5 tries used</small>
                    </div>
                  )}
                  {r.note && <p className="mp-note">Note: {r.note}</p>}

                  {r.status !== "verified" ? (
                    <div className="mp-row-actions">
                      <button className="mp-btn primary" disabled={busy === r.id || r.place_taken} onClick={() => decide(r.id, true)}>Verify café</button>
                      {r.status !== "rejected" && (
                        <>
                          <input className="mp-input" style={{ height: 40, flex: 1 }} placeholder="Reason (shown to the café)" value={reason[r.id] ?? ""}
                            onChange={(e) => setReason((x) => ({ ...x, [r.id]: e.target.value }))} />
                          <button className="mp-btn" disabled={busy === r.id} onClick={() => decide(r.id, false)}>Reject</button>
                        </>
                      )}
                    </div>
                  ) : (
                    <div className="mp-row-actions">
                      <span className="mp-note">Verified {day(r.verified_at)}</span>
                      <button className="mp-btn" disabled={busy === r.id} onClick={() => decide(r.id, false)}>Revoke</button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
    </>
  );
  if (bare) return body;
  return (
    <>
      <AppBar />
      <main className="mp-page">
        <h1>Café verification</h1>
        <p className="sub">Only verified cafés are visible to startups. Check each claim against the café&apos;s public listing.</p>
        {body}
      </main>
    </>
  );
}
