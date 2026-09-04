"use client";

/* Step 2 — find the venue in the roster.

   This is the step the whole flow exists for. 1,869 Orange County venues are
   already seeded, 149 with a measured brand health score, so most cafes find
   themselves here instead of typing their own address into an empty form.
   Finding yourself already scored is also the clearest possible statement of
   what the product does.

   Typing a venue by hand stays available, because a roster that covers most
   of the county still does not cover all of it, and being absent from it is
   not a reason to be unable to sign up. */

import React from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/lib/icons";
import { EASE } from "@/lib/ui";
import { prettyCuisine } from "@/lib/format";
import { BigField, StepShell } from "@/components/onboarding/Chrome";
import { useDraft } from "@/components/onboarding/draft";
import type { VenueSearchResult } from "@/lib/queries";

export default function VenueStep() {
  const router = useRouter();
  const [, update] = useDraft();
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<VenueSearchResult[]>([]);
  const [searching, setSearching] = React.useState(false);
  const [manual, setManual] = React.useState(false);
  const [manualName, setManualName] = React.useState("");
  const [manualCity, setManualCity] = React.useState("");

  React.useEffect(() => {
    if (query.trim().length < 2) { setResults([]); return; }
    // Debounced, and the previous request is aborted so a slow response for
    // an older query cannot overwrite results for a newer one.
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/venues?q=${encodeURIComponent(query)}`,
                                { signal: ctl.signal });
        const json = await res.json();
        setResults(json.venues ?? []);
      } catch {
        // Aborted or offline; the previous results stay on screen rather than
        // flashing an error for a keystroke.
      } finally {
        setSearching(false);
      }
    }, 220);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [query]);

  function choose(v: VenueSearchResult) {
    update({
      venueId: v.id, venueName: v.name, city: v.city ?? "",
      address: v.address ?? "", website: v.website ?? "",
      instagram: v.instagram ?? "", tiktok: v.tiktok ?? "",
      claimedFromRoster: true, brandHealth: v.organic_brand_health_score,
    });
    router.push("/onboarding/profile");
  }

  function useTyped() {
    if (!manualName.trim()) return;
    update({
      venueId: null, venueName: manualName.trim(), city: manualCity.trim(),
      address: "", website: "", instagram: "", tiktok: "",
      claimedFromRoster: false, brandHealth: null,
    });
    router.push("/onboarding/profile");
  }

  return (
    <StepShell
      current="venue"
      eyebrow="Find your venue"
      title={manual ? "Tell us about your venue" : "Is your venue one of these?"}
      blurb={manual
        ? "We'll build your profile from scratch. Brand health takes a few days to measure once we know where to look."
        : "We've already measured 1,869 Orange County venues. Search for yours — its profile is probably waiting."}
      onNext={manual ? useTyped : undefined}
      nextDisabled={manual && !manualName.trim()}
      nextLabel="Continue"
    >
      {!manual ? (
        <>
          <div style={{
            display: "flex", alignItems: "center", gap: 12, border: "1px solid #e6e2f2",
            borderRadius: 14, padding: "16px 18px", background: "var(--surface)",
          }}>
            <Icon name="search" size={18} color="var(--text-faint)" />
            <input
              autoFocus value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by venue name"
              style={{ flex: 1, border: "none", outline: "none", background: "none",
                       fontSize: 16, fontFamily: "inherit", color: "var(--ink)" }} />
            {searching && (
              <span style={{ fontSize: 12.5, color: "var(--text-faint)" }}>searching…</span>
            )}
          </div>

          {results.length > 0 && (
            <div style={{
              marginTop: 12, border: "1px solid #e6e2f2", borderRadius: 14,
              overflow: "hidden", background: "var(--surface)",
              boxShadow: "0 10px 30px rgba(140,82,255,0.08)",
            }}>
              {results.map((v, i) => (
                <button key={v.id} onClick={() => choose(v)} style={{
                  display: "flex", alignItems: "center", gap: 14, width: "100%",
                  padding: "15px 18px", border: "none", cursor: "pointer",
                  background: "transparent", textAlign: "left", fontFamily: "inherit",
                  borderTop: i ? "1px solid var(--surface-sunken-2)" : "none",
                  transition: `background 0.12s ${EASE}`,
                }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "var(--surface-sunken-3)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>
                  <span style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 15, fontWeight: 650 }}>{v.name}</span>
                    <span style={{ fontSize: 13, color: "var(--text-muted)" }}>
                      {[v.city, prettyCuisine(v.cuisine)].filter(Boolean).join(" · ") || "Orange County"}
                    </span>
                  </span>
                  {/* A measured score is the reason to click. Unmeasured says
                      so rather than showing a zero. */}
                  {v.organic_brand_health_score !== null ? (
                    <span style={{
                      display: "inline-flex", flexDirection: "column", alignItems: "center",
                      padding: "5px 12px", borderRadius: 10, background: "var(--purple-tint)",
                    }}>
                      <span style={{ fontSize: 16, fontWeight: 800,
                                     color: "var(--purple-deepest)" }}>
                        {v.organic_brand_health_score}
                      </span>
                      <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: "0.08em",
                                     color: "var(--purple-deep)" }}>HEALTH</span>
                    </span>
                  ) : (
                    <span style={{ fontSize: 12, color: "var(--text-faint)" }}>not scored yet</span>
                  )}
                </button>
              ))}
            </div>
          )}

          {query.trim().length >= 2 && !searching && results.length === 0 && (
            <p style={{ margin: "16px 2px 0", fontSize: 14, color: "var(--text-muted)" }}>
              Nothing matching “{query}”. It may not be in the roster yet.
            </p>
          )}

          <button onClick={() => setManual(true)} style={{
            marginTop: 26, background: "none", border: "none", padding: 0, cursor: "pointer",
            font: "inherit", fontSize: 14, fontWeight: 600, color: "var(--purple-deep)",
          }}>
            My venue isn&apos;t listed → add it manually
          </button>
        </>
      ) : (
        <>
          <BigField label="Venue name" value={manualName} onChange={setManualName} autoFocus />
          <BigField label="City" value={manualCity} onChange={setManualCity}
            hint="Orange County for now — that's where the creator network is." />
          <button onClick={() => setManual(false)} style={{
            marginTop: 12, background: "none", border: "none", padding: 0, cursor: "pointer",
            font: "inherit", fontSize: 14, fontWeight: 600, color: "var(--purple-deep)",
          }}>
            ← Search the roster instead
          </button>
        </>
      )}
    </StepShell>
  );
}
