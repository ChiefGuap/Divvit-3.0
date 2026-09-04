"use client";

/* Rewards — client half: the tab pair and the catalogue.

   Two tables sit behind this page and both are empty: `rewards` (what a venue
   offers) and `reward_redemptions` (what has been claimed). They fail for
   different reasons and the copy says which, because "no rewards configured"
   is a venue's job to fix and "nothing has been redeemed" is not. */

import React from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/lib/icons";
import { PurpleButton, TabPair, fadeUp } from "@/lib/ui";
import { NotBuiltYet } from "@/components/EmptyState";
import type { RewardRow } from "@/lib/queries";

export default function RewardsView({ rewards, redemptionCount }: {
  rewards: RewardRow[];
  redemptionCount: number;
}) {
  const router = useRouter();

  return (
    <>
      <TabPair
        value="rewards"
        onChange={(v) => v === "campaigns" && router.push("/collection/campaigns")}
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
            Rewards
          </h1>
          <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 13.5 }}>
            What a guest gets for filming, and what has been claimed.
          </p>
        </div>
        <PurpleButton><Icon name="plus" size={15} />New reward</PurpleButton>
      </div>

      {rewards.length === 0 ? (
        <NotBuiltYet
          icon="gift"
          title="No rewards configured"
          reason="Rewards are read live from the database and none has been created.
                  There is no create flow yet, so this table cannot be populated
                  from the dashboard. The read path works — a row inserted
                  directly would show up here immediately."
          table="rewards"
        />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px,1fr))",
                      gap: 14, ...fadeUp("0.1s") }}>
          {rewards.map((r) => (
            <div key={r.id} style={{
              background: "var(--surface)", borderRadius: 14, padding: 18,
              display: "flex", flexDirection: "column", gap: 6,
              boxShadow: "0 0 0 1px rgba(17,24,39,0.07), 0 2px 6px rgba(58,32,137,0.05)",
            }}>
              <span style={{ fontSize: 14.5, fontWeight: 650 }}>{r.title ?? "Untitled"}</span>
              {r.reward_type && (
                <span style={{ fontSize: 11.5, fontWeight: 600, color: "var(--purple-deep)" }}>
                  {r.reward_type}
                </span>
              )}
              {r.description && (
                <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.55,
                            color: "var(--text-muted)" }}>{r.description}</p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Redemptions are a separate absence with a separate cause. */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10, ...fadeUp("0.16s") }}>
        <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.11em",
                       color: "var(--text-faint)" }}>REDEMPTIONS</span>
        {redemptionCount === 0 ? (
          <NotBuiltYet
            icon="card"
            title="Nothing has been redeemed"
            reason="A redemption is written when a creator's claim is approved and
                    paid out. No claim has been approved, so there is nothing to
                    show — this stays empty until the claim flow runs end to end,
                    and it is the correct state, not a gap in the page."
            table="reward_redemptions"
          />
        ) : (
          <span style={{ fontSize: 13 }}>{redemptionCount} redemptions</span>
        )}
      </div>
    </>
  );
}
