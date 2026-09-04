"use client";

/* Editor — cuts assembled from library clips.

   `editor_cuts` carries a render pipeline's worth of state: render_job_id,
   render_started_at, render_error, posted_at. None of it runs yet, and the
   table is empty. The dependency chain matters and the copy names it: a cut
   needs library clips, which need accepted submissions, which need something
   to submit. */

import React from "react";
import { Icon } from "@/lib/icons";
import { EASE, PurpleButton, fadeUp } from "@/lib/ui";
import { compactCount } from "@/lib/format";
import { NotBuiltYet } from "@/components/EmptyState";
import type { EditorCutRow } from "@/lib/queries";

const STATE: Record<string, { label: string; fg: string; bg: string }> = {
  draft:     { label: "Draft",     fg: "var(--text-muted)", bg: "var(--surface-sunken-2)" },
  rendering: { label: "Rendering", fg: "#b9700a", bg: "rgba(245,149,18,0.15)" },
  ready:     { label: "Ready",     fg: "#0d7a4f", bg: "rgba(22,160,107,0.12)" },
  posted:    { label: "Posted",    fg: "#8c52ff", bg: "rgba(140,82,255,0.12)" },
  failed:    { label: "Failed",    fg: "#b91c1c", bg: "rgba(220,38,38,0.12)" },
};

function mmss(seconds: number | null): string {
  if (!seconds) return "—";
  const m = Math.floor(seconds / 60), s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function EditorView({ cuts, libraryCount }: {
  cuts: EditorCutRow[];
  libraryCount: number;
}) {
  return (
    <>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between",
                    gap: 16, flexWrap: "wrap", ...fadeUp("0.05s", "0.5s") }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, letterSpacing: "-0.01em" }}>
            Editor
          </h1>
          <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 13.5 }}>
            Cuts assembled from clips in the library.
          </p>
        </div>
        <PurpleButton disabled={libraryCount === 0}
          style={{ opacity: libraryCount === 0 ? 0.5 : 1,
                   cursor: libraryCount === 0 ? "not-allowed" : "pointer" }}>
          <Icon name="wand" size={15} />New cut
        </PurpleButton>
      </div>

      {cuts.length === 0 ? (
        <NotBuiltYet
          icon="wand"
          title="No cuts yet"
          reason={libraryCount === 0
            ? `A cut is assembled from clips in the content library, and the library is empty — which is itself waiting on accepted submissions. Nothing here is broken; the chain has no input yet, so New cut is disabled rather than opening an editor with nothing to edit.`
            : `No cut has been assembled yet. The library has clips, so the input exists — the render pipeline itself is not wired up.`}
          table="editor_cuts"
        />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px,1fr))",
                      gap: 14, ...fadeUp("0.1s") }}>
          {cuts.map((c) => {
            const st = STATE[c.state ?? ""] ?? STATE.draft;
            return (
              <div key={c.id} style={{
                background: "var(--surface)", borderRadius: 14, overflow: "hidden",
                boxShadow: "0 0 0 1px rgba(17,24,39,0.07), 0 2px 6px rgba(58,32,137,0.05)",
                transition: `transform 0.18s ${EASE}`,
              }}>
                <div style={{ aspectRatio: "9 / 16", background: "var(--surface-sunken)",
                              position: "relative" }}>
                  {c.poster_url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.poster_url} alt="" style={{ width: "100%", height: "100%",
                                                            objectFit: "cover", display: "block" }} />
                  )}
                  <span style={{ position: "absolute", top: 8, left: 8, fontSize: 11,
                                 fontWeight: 700, color: st.fg, background: st.bg,
                                 borderRadius: 99, padding: "3px 9px" }}>{st.label}</span>
                </div>
                <div style={{ padding: "11px 13px 13px", display: "flex",
                              flexDirection: "column", gap: 5 }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{c.title ?? "Untitled"}</span>
                  <div style={{ display: "flex", gap: 10, fontSize: 11.5,
                                color: "var(--text-faint)" }}>
                    <span>{c.clip_count ?? 0} clips</span>
                    <span>{mmss(c.duration_seconds)}</span>
                    <span style={{ marginLeft: "auto" }}>{compactCount(c.view_count)} views</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
