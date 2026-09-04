"use client";

/* The Collection — triage inbound clips.

   `submissions` is the queue a creator's screened video lands in. It is empty,
   and the reason is worth stating precisely: the creator app that would submit
   is not built, and the screening flow that fed it was shelved. So this is not
   "no new submissions today" — nothing can submit at all yet. */

import React from "react";
import { Icon } from "@/lib/icons";
import { PurpleButton, fadeUp } from "@/lib/ui";
import { NotBuiltYet } from "@/components/EmptyState";
import type { SubmissionRow } from "@/lib/queries";

const STATUS: Record<string, { label: string; fg: string; bg: string }> = {
  pending:  { label: "Pending",  fg: "#b9700a", bg: "rgba(245,149,18,0.15)" },
  accepted: { label: "Accepted", fg: "#0d7a4f", bg: "rgba(22,160,107,0.12)" },
  rejected: { label: "Passed",   fg: "var(--text-faint)", bg: "var(--surface-sunken-2)" },
};

export default function CollectionView({ submissions }: { submissions: SubmissionRow[] }) {
  const pending = submissions.filter((s) => s.status === "pending");

  return (
    <>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between",
                    gap: 16, flexWrap: "wrap", ...fadeUp("0.05s", "0.5s") }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, letterSpacing: "-0.01em" }}>
            The Collection
          </h1>
          <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 13.5 }}>
            Clips guests have submitted, waiting on accept or pass.
          </p>
        </div>
        {submissions.length > 0 && (
          <PurpleButton><Icon name="check" size={15} />Review queue ({pending.length})</PurpleButton>
        )}
      </div>

      {submissions.length === 0 ? (
        <NotBuiltYet
          icon="clapper"
          title="Nothing has been submitted"
          reason="This is the queue a guest's screened video lands in. It is empty
                  because nothing can submit yet — the creator app has no upload
                  surface, and the screening flow that fed this was shelved. The
                  read path is live, so the first real submission appears here
                  without any change to this page."
          table="submissions"
        />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, ...fadeUp("0.1s") }}>
          {submissions.map((s) => {
            const st = STATUS[s.status ?? ""] ?? STATUS.pending;
            return (
              <div key={s.id} style={{
                display: "flex", alignItems: "center", gap: 12, padding: 14,
                background: "var(--surface)", borderRadius: 12,
                boxShadow: "0 0 0 1px rgba(17,24,39,0.07), 0 2px 6px rgba(58,32,137,0.05)",
              }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: st.fg, background: st.bg,
                               borderRadius: 99, padding: "3px 9px" }}>{st.label}</span>
                <span style={{ fontSize: 13, fontWeight: 600 }}>
                  {s.category ?? "Uncategorised"}
                </span>
                {s.video_url && (
                  <a href={s.video_url} target="_blank" rel="noreferrer"
                     style={{ marginLeft: "auto", fontSize: 12.5, fontWeight: 600,
                              color: "var(--purple-deep)", textDecoration: "none" }}>
                    Watch →
                  </a>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
