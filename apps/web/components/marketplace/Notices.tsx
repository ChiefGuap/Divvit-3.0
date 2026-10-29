"use client";

/* Dashboard notifications (mp_notifications): one banner per unread one, at the
   top of the startup and café homes — "Your campaign is approved → Pay now",
   "New campaign from X → Review offer". Opening or dismissing one marks it read. */

import { useRouter } from "next/navigation";
import React from "react";
import { useMp } from "./session";
import { Icon } from "./dashboard/icons";

type Notice = { id: number; kind: "campaign_approved" | "campaign_declined" | "campaign_paid" | "offer_new" | "campaign_finished"; title: string; body: string | null; link: string | null };
const CTA: Record<Notice["kind"], string> = { campaign_approved: "Pay now", campaign_declined: "See details", campaign_paid: "View campaign", offer_new: "Review offer", campaign_finished: "See report" };

/** `refresh` changes whenever the page reloads its data, so new notices show up */
export function Notices({ refresh }: { refresh?: unknown }) {
  const { supabase, user } = useMp();
  const router = useRouter();
  const [list, setList] = React.useState<Notice[]>([]);

  React.useEffect(() => {
    if (!user) return;
    supabase.from("mp_notifications").select("id, kind, title, body, link").is("read_at", null)
      .order("created_at", { ascending: false }).limit(4)
      .then(({ data }) => setList((data as Notice[]) ?? []));
  }, [supabase, user, refresh]);

  const read = (id: number) => {
    setList((l) => l.filter((n) => n.id !== id));
    supabase.rpc("mp_read_notification", { p_id: id }).then(() => {});
  };
  const open = (n: Notice) => {
    read(n.id);
    if (!n.link) return;
    const to = new URL(n.link, window.location.origin);
    // a link to this same page only changes the hash, which the page listens for
    if (to.pathname === window.location.pathname) window.location.hash = to.hash;
    else router.push(n.link);
  };

  if (!list.length) return null;
  return (
    <div className="notices" role="region" aria-label="Notifications">
      {list.map((n) => (
        <div key={n.id} className={`notice ${n.kind}`}>
          <span className="dot" aria-hidden="true" />
          <div className="t"><b>{n.title}</b>{n.body && <span>{n.body}</span>}</div>
          {n.link && <button type="button" className="cta" onClick={() => open(n)}>{CTA[n.kind]}</button>}
          <button type="button" className="x" aria-label="Dismiss" onClick={() => read(n.id)}><Icon name="x" size={16} /></button>
        </div>
      ))}
    </div>
  );
}
