"use client";

/* Honest empty states.

   There are two different kinds of nothing, and conflating them is how a
   dashboard lies quietly:

   **Nothing is produced yet.** The table exists, the query works, and no row
   has ever been written because the thing that would write one is not built.
   This must say so, and name what would fill it — otherwise it reads as a
   loading failure and someone spends an afternoon debugging a working query.

   **Nothing matched.** There is data, the filter excluded it. That is the
   user's own doing and needs no explanation, just a way back.

   The distinction is the whole point of this component. `reason` is required
   for the first kind precisely so it cannot be skipped. */

import React from "react";
import { Icon, type IconName } from "@/lib/icons";
import { fadeUp } from "@/lib/ui";

export function NotBuiltYet({ icon = "info", title, reason, table, action }: {
  icon?: IconName;
  /** What is not here, in the reader's words. */
  title: string;
  /** Why it is empty and what would fill it. Not optional on purpose. */
  reason: string;
  /** The table that has no rows, so an engineer can check it directly. */
  table?: string;
  action?: React.ReactNode;
}) {
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center", gap: 10,
      padding: "44px 28px", textAlign: "center",
      background: "var(--surface-sunken-3)", borderRadius: 14,
      border: "1px dashed #ddd8ee", ...fadeUp("0.06s"),
    }}>
      <span style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        width: 38, height: 38, borderRadius: 12, background: "var(--purple-tint)",
      }}>
        <Icon name={icon} size={18} color="var(--purple-deep)" />
      </span>
      <span style={{ fontSize: 15, fontWeight: 650 }}>{title}</span>
      <p style={{ margin: 0, maxWidth: 420, fontSize: 13, lineHeight: 1.65,
                  color: "var(--text-muted)" }}>
        {reason}
      </p>
      {table && (
        <code style={{ fontSize: 11, color: "var(--text-faint)",
                       background: "var(--surface-sunken-2)", borderRadius: 6,
                       padding: "3px 8px" }}>
          {table} · 0 rows
        </code>
      )}
      {action}
    </div>
  );
}

export function NoMatches({ onClear }: { onClear?: () => void }) {
  return (
    <div style={{ padding: "34px 10px", textAlign: "center", fontSize: 13,
                  color: "var(--text-muted)" }}>
      Nothing matches these filters.{" "}
      {onClear && (
        <button onClick={onClear} style={{
          background: "none", border: "none", padding: 0, font: "inherit",
          color: "var(--purple-deep)", fontWeight: 600, cursor: "pointer",
        }}>Clear them</button>
      )}
    </div>
  );
}
