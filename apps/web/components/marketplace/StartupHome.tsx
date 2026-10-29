"use client";

/* Startup home — two tabs. Find cafés: a setup guide for first-timers, how
   campaigns are doing (once there are any), suggested neighborhoods beside the
   map, and a café marketplace to browse and select from, then start a campaign
   with exactly those. Your campaigns: each campaign with a timeline bar, its numbers
   (projected, then measured), where its cafés stand and a link to its report. */

import Link from "next/link";
import { useRouter } from "next/navigation";
import React from "react";
import { useMp } from "./session";
import { useNetwork } from "./useNetwork";
import { AppBar, AreaPicker } from "./flow";
import { Icon, type IconName } from "./dashboard/icons";
import { AreaSuggestions } from "./dashboard/AreaSuggestions";
import { CafeMarket } from "./dashboard/CafeMarket";
import { SetupGuide, type GuideStep } from "./SetupGuide";
import { Notices } from "./Notices";
import { CampaignMetrics, CampaignTimeline } from "./CampaignProgress";
import { CompanyConfirm, type CompanyStatus } from "./CompanyConfirm";
import { cafeAccepts, categoryLabel } from "@/lib/marketplace/categories";
import { eligibleCafes, type Area } from "@/lib/marketplace/network";
import { proxied } from "@/lib/marketplace/images";
import { money, num, plural } from "@/lib/marketplace/format";
import { ROI_ASSUMPTIONS } from "@/lib/marketplace/roi";
import { campaignDraftKey } from "@/lib/marketplace/drafts";
import { campaignPill, timeline } from "@/lib/marketplace/campaign-stats";
import { site } from "@/lib/urls";

type Startup = { id: string; name: string; category: string; hq: string | null; logo_url: string | null; description: string | null; areas: Area[] | null };
type Campaign = {
  id: string; name: string; status: string; start_date: string | null; weeks: number; sleeves_per_cafe: number; branded_drink: boolean;
  total_cents: number; final_cents: number | null; review_note: string | null; paid_at: string | null; design_url: string | null; created_at: string;
  has_qr: boolean; scans: number; scanners: number; roi: { impressions?: number } | null;
  cafes: { cafe_name: string; neighborhood: string | null; city: string; status: string; sleeves: number }[];
};
type View = "find" | "campaigns";

const NAV: { view: View; icon: IconName; label: string }[] = [
  { view: "find", icon: "search", label: "Find cafés" },
  { view: "campaigns", icon: "campaigns", label: "Your campaigns" },
];
const date = (d: string) => new Date(`${d.slice(0, 10)}T12:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const PAID = ["paid", "active", "completed"];
const greeting = () => { const h = new Date().getHours(); return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening"; };
const jump = (el: HTMLElement | null) => el?.scrollIntoView({ behavior: "smooth", block: "start" });

export function StartupHome() {
  const { supabase, user, profile, loading, signOut } = useMp();
  const router = useRouter();
  const cafes = useNetwork();
  const [startup, setStartup] = React.useState<Startup | null>(null);
  const [list, setList] = React.useState<Campaign[] | null>(null);
  const [company, setCompany] = React.useState<CompanyStatus | null>(null);
  // back from the work-email link: /home?company=confirmed | expired
  const [linkResult, setLinkResult] = React.useState<"confirmed" | "expired" | null>(null);
  const [view, setView] = React.useState<View>("find");
  const [areas, setAreas] = React.useState<Area[]>([]);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [open, setOpen] = React.useState<string | null>(null);
  const [admin, setAdmin] = React.useState(false);
  const [acct, setAcct] = React.useState(false);
  const market = React.useRef<HTMLDivElement>(null);
  const finder = React.useRef<HTMLElement>(null);

  React.useEffect(() => {
    if (loading) return;
    if (!user) { router.replace("/signin?next=/home"); return; }
    if (profile?.role === "cafe") { router.replace("/cafes/inbox"); return; }
    supabase.from("mp_startups").select("id,name,category,hq,logo_url,description,areas").eq("owner_id", user.id).order("created_at").limit(1).maybeSingle()
      .then(({ data }) => {
        if (!data) { router.replace("/start/startup"); return; }
        setStartup(data as Startup);
        setAreas((data.areas as Area[]) ?? []);
      });
    supabase.rpc("mp_my_campaigns").then(({ data }) => setList((data as Campaign[]) ?? []));
    supabase.rpc("mp_is_admin").then(({ data }) => setAdmin(data === true));
    supabase.rpc("mp_company_status").then(({ data }) => setCompany(data as CompanyStatus | null));
  }, [loading, user, profile, supabase, router]);

  React.useEffect(() => {
    const r = new URLSearchParams(window.location.search).get("company");
    if (r === "confirmed" || r === "expired") {
      setLinkResult(r);
      window.history.replaceState(null, "", window.location.pathname + window.location.hash);
    }
  }, []);

  // views are linkable: /home#campaigns
  React.useEffect(() => {
    const fromHash = () => { const h = window.location.hash.slice(1); if (h === "find" || h === "campaigns") setView(h); };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, []);
  const go = (v: View) => { setView(v); history.replaceState(null, "", `#${v}`); window.scrollTo({ top: 0 }); };

  const category = startup?.category ?? "tech";
  const openToUs = React.useMemo(() => cafes.filter((c) => c.sleeves_per_month > 0 && cafeAccepts(c, category)), [cafes, category]);
  const inAreas = React.useMemo(() => (areas.length ? eligibleCafes(cafes, areas, category) : openToUs), [cafes, areas, category, openToUs]);
  // cafés added (or moved) since the last lookup get their nearby places filled in, a few per visit
  React.useEffect(() => {
    if (cafes.some((c) => c.nearby == null)) fetch("/api/cafes/nearby", { method: "POST" }).catch(() => {});
  }, [cafes]);
  const toggleSelect = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  // a campaign with exactly the selected cafés: pre-fill the campaign draft and skip to sleeves
  function startWithSelected() {
    if (!user) return;
    const picked = cafes.filter((c) => selected.has(c.id));
    if (!picked.length) return;
    // one tight area per neighborhood, so picks in two cities don't become one box across the country
    const pad = 0.004, groups = new Map<string, typeof picked>();
    picked.forEach((c) => { const k = `${c.neighborhood || c.city}, ${c.city}`; groups.set(k, [...(groups.get(k) ?? []), c]); });
    const picks: Area[] = [...groups].map(([label, cs]) => {
      const lng = cs.map((c) => c.lng), lat = cs.map((c) => c.lat);
      return { id: `picked:${label}`, label, bbox: [Math.min(...lng) - pad, Math.min(...lat) - pad, Math.max(...lng) + pad, Math.max(...lat) + pad] };
    });
    try {
      localStorage.setItem(campaignDraftKey(user.id), JSON.stringify({ i: 2, areas: picks, cafeIds: picked.map((c) => c.id),
        count: null, sleeves: null, weeks: null, start: "", branded: null, stock: "kraft" }));
    } catch { /* the flow still starts, just without the picks */ }
    router.push("/campaigns/new");
  }

  if (!startup) return <AppBar />;
  const first = (profile?.full_name || "").split(" ")[0];
  const campaigns = list ?? [];
  const onboard = campaigns.flatMap((c) => c.cafes.filter((x) => x.status === "accepted"));
  const sleevesOut = onboard.reduce((s, x) => s + x.sleeves, 0);
  const waiting = campaigns.filter((c) => c.status === "paid").length;
  const price = (c: Campaign) => c.final_cents ?? c.total_cents;
  const committed = campaigns.filter((c) => PAID.includes(c.status)).reduce((s, c) => s + price(c), 0);
  const names = onboard.map((x) => x.cafe_name);
  const accepted = (c: Campaign) => c.cafes.filter((x) => x.status === "accepted").length;
  // first-timer checklist; each step ticks itself off from the startup's own data
  const steps: GuideStep[] = [
    { id: "profile", title: "Tell cafés who you are", art: "rocket", done: Boolean(startup.description && startup.logo_url),
      body: "Cafés see your logo and one-liner before they say yes. Add both so they know whose brand goes on their cups.",
      actions: <Link href="/start/startup?edit=1" className="mp-btn primary">Edit profile</Link> },
    { id: "company", title: "Confirm it's your company", art: "building", done: Boolean(company?.confirmed),
      body: `So nobody else can advertise as ${startup.name}. An email at your company's domain confirms it on its own; otherwise send a link to your work email, or we'll confirm it on our call before your first campaign is approved.`,
      extra: company && !company.confirmed ? <CompanyConfirm name={startup.name} status={company} /> : undefined },
    { id: "areas", title: "Pick where to be seen", art: "pin", done: areas.length > 0,
      body: "Choose the neighborhoods where your customers buy coffee. Start from the suggestions, or search any city.",
      actions: <button type="button" className="mp-btn primary" onClick={() => jump(finder.current)}>Pick areas</button> },
    { id: "cafes", title: "Choose your cafés", art: "coffee", done: selected.size > 0 || campaigns.length > 0,
      body: "Browse the cafés in your areas — how busy each one is, how many sleeves it can take and what's around it — and select the ones you want.",
      actions: <button type="button" className="mp-btn primary" onClick={() => jump(market.current)}>Browse cafés</button> },
    { id: "launch", title: "Send your first campaign", art: "calendar", done: campaigns.length > 0,
      body: "Pick how many sleeves and for how long, then send it to us with its projected price. Someone from the Divvit team reaches out within 24 hours.",
      actions: <Link href="/campaigns/new" className="mp-btn primary">New campaign</Link> },
    { id: "pay", title: "Pay once it's approved", art: "card", done: campaigns.some((c) => PAID.includes(c.status)),
      body: "When the Divvit team approves your campaign, you'll get an email and a notice here. Pay the final price and we send it to your cafés.",
      actions: campaigns.find((c) => c.status === "approved")
        ? <Link href={`/campaigns/${campaigns.find((c) => c.status === "approved")!.id}/pay`} className="mp-btn primary">Pay now</Link> : undefined },
    { id: "live", title: "Watch it go live", art: "gauge", done: campaigns.some((c) => c.status === "active"),
      body: "Cafés accept, we print and pack your sleeves, and they go out on cups. You get a metrics report when the campaign ends.",
      actions: campaigns.length ? <button type="button" className="mp-btn primary" onClick={() => go("campaigns")}>Your campaigns</button> : undefined },
  ];
  const stats = [
    { k: "Live campaigns", v: num(campaigns.filter((c) => c.status === "active").length), sub: waiting ? `${num(waiting)} waiting on cafés` : "None waiting on cafés" },
    { k: "Cafés on board", v: num(onboard.length), sub: names.length ? names.slice(0, 2).join(", ") + (names.length > 2 ? ` +${names.length - 2}` : "") : "None yet" },
    { k: "Sleeves out", v: num(sleevesOut), sub: `${money(committed)} committed` },
    { k: "People reached", v: num(sleevesOut * ROI_ASSUMPTIONS.impressionsPerSleeve), est: true, sub: `≈ ${ROI_ASSUMPTIONS.impressionsPerSleeve} people per sleeve` },
  ];

  const navItem = (it: (typeof NAV)[number]) => (
    <button key={it.view} type="button" className={`dn-item${view === it.view ? " on" : ""}`} onClick={() => go(it.view)}>
      <Icon name={it.icon} /> {it.label}
      {it.view === "campaigns" && campaigns.length > 0 && <small className="dn-count">{campaigns.length}</small>}
    </button>
  );

  return (
    <div className="mp-dash">
      <aside className="dash-side">
        <a className="brand" href={site("/")}><img src="/assets/divvit-wordmark-purple.png" alt="Divvit" /></a>
        <nav className="dn-group" aria-label="Home">{NAV.map(navItem)}</nav>
        <div className="dash-acct" onMouseLeave={() => setAcct(false)}>
          {acct && (
            <div className="mp-menu up">
              <div className="who">{user?.email}</div>
              <Link href="/start/startup?edit=1">Edit profile</Link>
              {admin && <Link href="/admin">Review cafés</Link>}
              <button type="button" onClick={() => signOut()}>Sign out</button>
            </div>
          )}
          <button type="button" className="acct" onClick={() => setAcct((a) => !a)} aria-expanded={acct}>
            {startup.logo_url ? <img src={proxied(startup.logo_url)!} alt="" /> : <span className="mp-logo-ph">{startup.name[0]}</span>}
            <span className="who"><b>{startup.name}</b><small>{categoryLabel(startup.category)}</small></span>
            <Icon name="updown" size={16} />
          </button>
        </div>
      </aside>

      <div className="dash-mobile">
        <AppBar nav={false} />
        <div className="dash-tabs">{NAV.map(navItem)}</div>
      </div>

      <main className="dash-main">
        {/* stays mounted while hidden, so the map, suggestions and filters survive a trip to Your campaigns */}
        <Notices refresh={list} />
        {linkResult && (
          <div className={linkResult === "confirmed" ? "mp-found" : "mp-error"} role="status">
            <span>{linkResult === "confirmed"
              ? `${startup.name} is confirmed. Your campaigns can be approved as soon as we've reviewed them.`
              : "That confirmation link has expired or was already used. Send a new one from “Confirm it's your company”."}</span>
          </div>
        )}
        <div className="dash-view" hidden={view !== "find"}>
          <header className="dash-head">
            <div>
              <span className="eyebrow">{startup.name}</span>
              <h1>{first ? `${greeting()}, ${first}` : greeting()}</h1>
            </div>
            <Link href="/campaigns/new" className="mp-btn primary big"><Icon name="plus" size={16} /> New campaign</Link>
          </header>

          <SetupGuide storageKey={`divvit.mp.guide.startup.${user!.id}`} title="Get ready to launch" steps={steps}
            sub="New here? A few steps from sign-up to your brand on coffee cups. Each one takes you to the right place." />

          {campaigns.length > 0 && (
            <section className="dash-tiles" aria-label="Overview">
              {stats.map((s) => (
                <div key={s.k} className="tile">
                  <div className="box"><b>{s.v}</b><small>{s.sub}</small></div>
                  <span>{s.k}{s.est && <em> · est.</em>}</span>
                </div>
              ))}
            </section>
          )}

          <section ref={finder} className="dash-block">
            <div className="col-head">
              <h2>Find cafés to partner with</h2>
              <small>Put {startup.name} on coffee cups where your customers already are. Search any city or neighborhood.</small>
            </div>
            <div className="dash-find">
              <AreaSuggestions name={startup.name} description={startup.description ?? ""} cafes={cafes} areas={areas}
                onAdd={(a) => setAreas((x) => (x.some((y) => y.id === a.id) ? x : [...x, a]))} />
              <div className="dash-map"><AreaPicker areas={areas} onChange={setAreas} cafes={cafes} category={category} /></div>
            </div>
          </section>
          <div ref={market} className="dash-anchor" />
          <CafeMarket title={areas.length ? "Cafés in your areas" : "All cafés"} cafes={inAreas} selected={selected} onSelect={toggleSelect}
            empty={<><b>No cafés match</b>Try another area or loosen the filters.</>} />
        </div>

        {view === "campaigns" && (
          <>
            <header className="dash-head">
              <div>
                <span className="eyebrow">{startup.name}</span>
                <h1>Your campaigns</h1>
                <p>{campaigns.length ? `${plural(campaigns.length, "campaign")} · ${money(committed)} committed` : "Every campaign you start shows up here."}</p>
              </div>
            </header>
            <section className="mp-section">
              {list === null ? <p className="mp-note">Loading…</p> : campaigns.length === 0 ? (
                <div className="mp-empty"><b>No campaigns yet</b>Pick some cafés under <button type="button" className="mp-link accent" onClick={() => go("find")}>Find cafés</button> to start one.</div>
              ) : campaigns.map((c) => {
                const t = timeline(c);
                const live = c.status === "completed" || (c.status === "active" && t?.phase !== "planned");
                const pill = campaignPill(c);
                return (
                  <div key={c.id} className="mp-item">
                    <div className="mp-item-head" onClick={() => setOpen(open === c.id ? null : c.id)}>
                      <div className="t"><b>{c.name}</b><small>{PAID.includes(c.status) ? `${accepted(c)} of ${plural(c.cafes.length, "café")} accepted` : plural(c.cafes.length, "café")} · {plural(c.weeks, "week")}</small></div>
                      <span className={`mp-pill ${pill.cls}`}>{pill.label}</span>
                      <span className="amt">{money(price(c))}{c.status === "submitted" && <small> projected</small>}</span>
                    </div>
                    {c.status !== "declined" && c.status !== "cancelled" && (
                      <div className="camp-meta">
                        {t && <CampaignTimeline t={t} />}
                        <CampaignMetrics c={c} />
                        {live && (
                          <Link href={`/campaigns/${c.id}/report`} className="mp-btn camp-report">
                            {t?.phase === "done" ? "View campaign report" : "Open live report"} →
                          </Link>
                        )}
                      </div>
                    )}
                    {open === c.id && (
                      <div className="mp-item-body">
                        {c.status === "submitted" && <p className="mp-note">Someone from the Divvit team will reach out to you within 24 hours. You haven&apos;t been charged; you&apos;ll pay once it&apos;s approved.</p>}
                        {c.status === "submitted" && company && !company.confirmed && (
                          <p className="mp-note">We&apos;ll confirm {startup.name} is your company before approving it, on our call or now with a work email (see &ldquo;Confirm it&apos;s your company&rdquo; under Find cafés).</p>
                        )}
                        {c.review_note && c.status !== "submitted" && <div className="mp-found"><span>A note from the Divvit team: {c.review_note}</span></div>}
                        {c.status === "approved" && (
                          <div className="mp-row-actions">
                            <Link href={`/campaigns/${c.id}/pay`} className="mp-btn primary">Pay {money(price(c), { cents: true })}</Link>
                            <span className="mp-note">Approved. Pay to send it to your cafés.</span>
                          </div>
                        )}
                        {c.design_url && <img className="art" src={c.design_url} alt="Sleeve design" />}
                        <div className="mp-facts">
                          {c.start_date && <span className="mp-fact">Starts {date(c.start_date)}</span>}
                          <span className="mp-fact">{num(c.sleeves_per_cafe)} sleeves per café</span>
                          {c.branded_drink && <span className="mp-fact">Branded drink</span>}
                        </div>
                        <div className="mp-lines">
                          {c.cafes.map((x, k) => (
                            <div key={k}><span>{x.cafe_name}<small>{[x.neighborhood, x.city].filter(Boolean).join(", ")}</small></span>
                              <span className={`mp-pill ${x.status}`}>{x.status === "declined" ? "Passed" : x.status === "accepted" ? "Accepted" : "Pending"}</span></div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </section>
          </>
        )}
      </main>

      {view === "find" && selected.size > 0 && (
        <div className="dash-selbar" role="region" aria-label="Selected cafés">
          <span><b>{plural(selected.size, "café")}</b> selected</span>
          <button type="button" className="mp-link" onClick={() => setSelected(new Set())}>Clear</button>
          <button type="button" className="mp-btn primary" onClick={startWithSelected}>Start a campaign with {plural(selected.size, "café")} →</button>
        </div>
      )}
    </div>
  );
}
