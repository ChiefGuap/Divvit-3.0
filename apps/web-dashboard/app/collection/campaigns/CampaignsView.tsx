"use client";

/* Campaigns — client half: the tab pair and the list.

   Nothing writes a campaign yet, so this renders the real (empty) table rather
   than fixtures. The read path is live: the moment a row is inserted it
   appears here without a code change. */

import React from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/lib/icons";
import { EASE, PurpleButton, TabPair, fadeUp } from "@/lib/ui";
import { NotBuiltYet } from "@/components/EmptyState";
import type { CampaignRow } from "@/lib/queries";

export default function CampaignsView({ campaigns }: { campaigns: CampaignRow[] }) {
  const router = useRouter();

  return (
    <>
      <TabPair
        value="campaigns"
        onChange={(v) => v === "rewards" && router.push("/rewards")}
        style={{ alignSelf: "flex-start", animation: "dvFadeIn 0.4s ease backwards" }}
        options={[
          { value: "rewards", label: <><Icon name="gift" size={15} />Rewards</> },
          { value: "campaigns", label: <><Icon name="megaphone" size={15} />Campaigns</> },
        ]}
      />

      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between",
                    gap: 16, flexWrap: "wrap", ...fadeUp("0.05s", "0.5s") }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, letterSpacing: "-0.01em" }}>
            Campaigns
          </h1>
          <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 13.5 }}>
            Ask guests for a specific video, and reward them for delivering it.
          </p>
        </div>
        <PurpleButton><Icon name="plus" size={15} />New campaign</PurpleButton>
      </div>

      {campaigns.length === 0 ? (
        <NotBuiltYet
          icon="megaphone"
          title="No campaigns yet"
          reason="Campaigns are read live from the database and none has been created.
                  Nothing writes to this table yet — there is no create flow, and
                  the creator app has no surface that would answer a campaign.
                  This is not a loading failure."
          table="campaigns"
        />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px,1fr))",
                      gap: 14, ...fadeUp("0.1s") }}>
          {campaigns.map((c) => (
            <div key={c.id} style={{
              background: "var(--surface)", borderRadius: 14, padding: 18,
              display: "flex", flexDirection: "column", gap: 8,
              boxShadow: "0 0 0 1px rgba(17,24,39,0.07), 0 2px 6px rgba(58,32,137,0.05)",
              transition: `transform 0.18s ${EASE}`,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 14.5, fontWeight: 650 }}>{c.title ?? "Untitled"}</span>
                <span style={{
                  marginLeft: "auto", fontSize: 11, fontWeight: 700, borderRadius: 99,
                  padding: "3px 9px",
                  color: c.is_active ? "#0d7a4f" : "var(--text-faint)",
                  background: c.is_active ? "rgba(22,160,107,0.12)" : "var(--surface-sunken-2)",
                }}>
                  {c.is_active ? "Active" : "Paused"}
                </span>
              </div>
              {c.instructions && (
                <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.55,
                            color: "var(--text-muted)" }}>{c.instructions}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
