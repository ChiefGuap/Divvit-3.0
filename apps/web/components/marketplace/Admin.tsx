"use client";

/* The Divvit team's page (admins only, mp_admins): review campaigns before they go
   to cafés, verify that each café is run by whoever claimed it, and check email.
   /admin#campaigns (default) · /admin#cafes · /admin#emails */

import { useRouter } from "next/navigation";
import React from "react";
import { useMp } from "./session";
import { AppBar } from "./flow";
import { AdminCampaigns } from "./AdminCampaigns";
import { AdminCafes } from "./AdminCafes";
import { AdminEmails } from "./AdminEmails";

type Tab = "campaigns" | "cafes" | "emails";

export function Admin() {
  const { supabase, user, loading } = useMp();
  const router = useRouter();
  const [ok, setOk] = React.useState<boolean | null>(null);
  const [tab, setTab] = React.useState<Tab>("campaigns");

  React.useEffect(() => {
    if (loading) return;
    if (!user) { router.replace("/signin?next=/admin"); return; }
    supabase.rpc("mp_is_admin").then(({ data }) => setOk(data === true));
  }, [loading, user, router, supabase]);
  React.useEffect(() => {
    const fromHash = () => setTab(window.location.hash === "#cafes" ? "cafes" : window.location.hash === "#emails" ? "emails" : "campaigns");
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, []);
  const go = (t: Tab) => { setTab(t); history.replaceState(null, "", `#${t}`); };

  if (ok === false) {
    return (<><AppBar /><main className="mp-page"><h1>Admins only</h1><p className="sub">This page is for the Divvit team.</p></main></>);
  }
  if (ok === null) return <AppBar />;
  return (
    <>
      <AppBar />
      <main className="mp-page wide">
        <h1>Divvit team</h1>
        <p className="sub">Approve campaigns before they go to cafés, and verify that each café is run by whoever claimed it.</p>
        <div className="scopes" role="tablist" aria-label="Admin">
          <button type="button" role="tab" aria-selected={tab === "campaigns"} className={tab === "campaigns" ? "on" : ""} onClick={() => go("campaigns")}>Campaigns</button>
          <button type="button" role="tab" aria-selected={tab === "cafes"} className={tab === "cafes" ? "on" : ""} onClick={() => go("cafes")}>Café verification</button>
          <button type="button" role="tab" aria-selected={tab === "emails"} className={tab === "emails" ? "on" : ""} onClick={() => go("emails")}>Emails</button>
        </div>
        {tab === "campaigns" ? <AdminCampaigns /> : tab === "cafes" ? <AdminCafes bare /> : <AdminEmails />}
      </main>
    </>
  );
}
