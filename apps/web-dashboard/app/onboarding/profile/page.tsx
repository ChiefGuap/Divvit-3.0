"use client";

/* Step 3 — confirm what we already hold.

   The fields arrive prefilled from the roster, and each says where its value
   came from. That labelling is the point: a venue seeing wrong facts about
   itself on day one reads as carelessness about the thing they care most
   about, so anything we inferred is marked as ours to be corrected rather
   than presented as theirs. */

import React from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/lib/icons";
import { BigField, StepShell } from "@/components/onboarding/Chrome";
import { useDraft } from "@/components/onboarding/draft";

export default function ProfileStep() {
  const router = useRouter();
  const [draft, update, loaded] = useDraft();
  const [name, setName] = React.useState("");
  const [city, setCity] = React.useState("");
  const [address, setAddress] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [website, setWebsite] = React.useState("");

  React.useEffect(() => {
    if (!loaded) return;
    setName(draft.venueName); setCity(draft.city); setAddress(draft.address);
    setPhone(draft.phone); setWebsite(draft.website);
  }, [loaded, draft]);

  React.useEffect(() => {
    if (loaded && !draft.venueName) router.replace("/onboarding/venue");
  }, [loaded, draft.venueName, router]);

  function next() {
    update({ venueName: name, city, address, phone, website });
    router.push("/onboarding/connect");
  }

  return (
    <StepShell
      current="profile"
      eyebrow="Confirm details"
      title={draft.claimedFromRoster ? "We already had this on file" : "Tell us where to look"}
      blurb={draft.claimedFromRoster
        ? "Everything below came from public sources, so check it before we build on it. Correct anything that's wrong."
        : "We'll use this to find what people are already posting about you."}
      onNext={next}
      nextLabel="Continue"
      nextDisabled={!name.trim()}
    >
      {draft.claimedFromRoster && draft.brandHealth !== null && (
        <div style={{
          display: "flex", alignItems: "center", gap: 16, padding: "18px 20px",
          borderRadius: 16, marginBottom: 26,
          background: "linear-gradient(160deg,#6346cd,#41208f)",
          boxShadow: "0 10px 30px rgba(140,82,255,0.18)",
        }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <span style={{ fontSize: 34, fontWeight: 800, color: "#fff", lineHeight: 1 }}>
              {draft.brandHealth}
            </span>
            <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.1em",
                           color: "rgba(255,255,255,0.65)", marginTop: 3 }}>/ 100</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <span style={{ fontSize: 14.5, fontWeight: 700, color: "#fff" }}>
              Your organic brand health is already measured
            </span>
            <span style={{ fontSize: 13, color: "rgba(255,255,255,0.8)", lineHeight: 1.5 }}>
              Scored from what people already post publicly about you — before
              you have done anything.
            </span>
          </div>
        </div>
      )}

      <BigField label="Venue name" value={name} onChange={setName} />
      <BigField label="City" value={city} onChange={setCity} />
      <BigField label="Address" value={address} onChange={setAddress}
        hint={draft.claimedFromRoster && !address
          ? "We don't have this on file — add it so creators can find you."
          : undefined} />
      <BigField label="Phone" value={phone} onChange={setPhone} />
      <BigField label="Website" value={website} onChange={setWebsite} />

      {draft.claimedFromRoster && (
        <div style={{ display: "flex", gap: 9, alignItems: "flex-start", marginTop: 20,
                      padding: "12px 14px", borderRadius: 10,
                      background: "var(--surface-sunken-3)",
                      border: "1px solid var(--surface-sunken-2)" }}>
          <Icon name="info" size={14} color="var(--text-faint)" />
          <span style={{ fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.6 }}>
            These came from OpenStreetMap and Google Places, and a city may have
            been derived from coordinates rather than published. Your corrections
            replace ours.
          </span>
        </div>
      )}
    </StepShell>
  );
}
