"use client";

/* Content Manager — the venue's library of accepted clips.

   `content_items` is written when a submission is accepted into the
   collection. Nothing accepts anything yet, so the library is empty and says
   why. Metrics columns (views, likes, times_used) exist on the table and are
   rendered when present — they are collected after publishing, so a row can
   legitimately exist with all of them null. */

import React from "react";
import { Icon } from "@/lib/icons";
import { EASE, QuietButton, Segmented, fadeUp } from "@/lib/ui";
import { compactCount } from "@/lib/format";
import { NoMatches, NotBuiltYet } from "@/components/EmptyState";
import type { ContentItemRow } from "@/lib/queries";

const STATE: Record<string, { label: string; fg: string; bg: string }> = {
  accepted:  { label: "Accepted",  fg: "#0d7a4f", bg: "rgba(22,160,107,0.12)" },
  published: { label: "Published", fg: "#8c52ff", bg: "rgba(140,82,255,0.12)" },
  archived:  { label: "Archived",  fg: "var(--text-faint)", bg: "var(--surface-sunken-2)" },
};

export default function ContentView({ items }: { items: ContentItemRow[] }) {
  const [state, setState] = React.useState("all");

  const shown = React.useMemo(
    () => (state === "all" ? items : items.filter((i) => i.state === state)),
    [items, state],
  );

  return (
    <>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between",
                    gap: 16, flexWrap: "wrap", ...fadeUp("0.05s", "0.5s") }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, letterSpacing: "-0.01em" }}>
            Content Manager
          </h1>
          <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 13.5 }}>
            Clips accepted into this venue&apos;s library, and how they have been used.
          </p>
        </div>
        <QuietButton><Icon name="download" size={16} />Export</QuietButton>
      </div>

      {items.length === 0 ? (
        <NotBuiltYet
          icon="folder"
          title="The library is empty"
          reason="A clip lands here when a submission is accepted into the
                  collection. No submission has been accepted, because nothing
                  submits yet — so there is nothing to accept. The read path is
                  live and this fills itself the moment that changes."
          table="content_items"
        />
      ) : (
        <>
          <Segmented value={state} onChange={setState} options={[
            { value: "all", label: "All", count: items.length },
            ...Object.keys(STATE).map((k) => ({
              value: k, label: STATE[k].label,
              count: items.filter((i) => i.state === k).length,
            })),
          ]} />

          {shown.length === 0 ? <NoMatches onClear={() => setState("all")} /> : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px,1fr))",
                          gap: 14, ...fadeUp("0.1s") }}>
              {shown.map((i) => {
                const st = STATE[i.state ?? ""] ?? STATE.archived;
                return (
                  <div key={i.id} style={{
                    background: "var(--surface)", borderRadius: 14, overflow: "hidden",
                    boxShadow: "0 0 0 1px rgba(17,24,39,0.07), 0 2px 6px rgba(58,32,137,0.05)",
                    transition: `transform 0.18s ${EASE}`,
                  }}>
                    <div style={{ aspectRatio: "9 / 16", background: "var(--surface-sunken)",
                                  position: "relative" }}>
                      {i.poster_url && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={i.poster_url} alt="" style={{ width: "100%", height: "100%",
                                                                objectFit: "cover", display: "block" }} />
                      )}
                      <span style={{ position: "absolute", top: 8, left: 8, fontSize: 11,
                                     fontWeight: 700, color: st.fg, background: st.bg,
                                     borderRadius: 99, padding: "3px 9px" }}>{st.label}</span>
                    </div>
                    <div style={{ padding: "11px 13px 13px", display: "flex",
                                  flexDirection: "column", gap: 5 }}>
                      <span style={{ fontSize: 13, fontWeight: 600 }}>{i.title ?? "Untitled"}</span>
                      <span style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
                        {i.creator_label ?? "Unknown creator"}
                      </span>
                      <div style={{ display: "flex", gap: 10, fontSize: 11.5,
                                    color: "var(--text-faint)" }}>
                        <span>{compactCount(i.view_count)} views</span>
                        <span>used {i.times_used ?? 0}×</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </>
  );
}
