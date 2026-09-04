"use client";

/* Step 4 — the social handles.

   This is the single most valuable thing a venue can give us, and the flow
   says so plainly rather than burying it as another form field. 2,100 of the
   2,102 profiles have no TikTok handle and 2,078 no Instagram, which is
   exactly why the TikTok and Instagram feeds are empty: without a handle
   there is nothing to attribute a post to.

   Both are skippable. Making them mandatory would only produce handles that
   are wrong. */

import React from "react";
import { useRouter } from "next/navigation";
import { Icon, type IconName } from "@/lib/icons";
import { EASE } from "@/lib/ui";
import { StepShell } from "@/components/onboarding/Chrome";
import { useDraft } from "@/components/onboarding/draft";

function HandleField({ platform, icon, value, onChange, why }: {
  platform: string; icon: IconName; value: string;
  onChange: (v: string) => void; why: string;
}) {
  return (
    <div style={{ border: "1px solid #e6e2f2", borderRadius: 16, padding: 20,
                  marginBottom: 14, background: "var(--surface)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 12 }}>
        <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center",
                       width: 34, height: 34, borderRadius: 10,
                       background: "var(--purple-tint)" }}>
          <Icon name={icon} size={17} color="var(--purple-deep)" />
        </span>
        <span style={{ fontSize: 15.5, fontWeight: 700 }}>{platform}</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8,
                    border: "1px solid #e6e2f2", borderRadius: 12,
                    padding: "13px 15px" }}>
        <span style={{ fontSize: 16, color: "var(--text-faint)" }}>@</span>
        <input value={value.replace(/^@/, "")}
          onChange={(e) => onChange(e.target.value.replace(/^@/, ""))}
          placeholder="yourvenue"
          style={{ flex: 1, border: "none", outline: "none", background: "none",
                   fontSize: 16, fontFamily: "inherit", color: "var(--ink)" }} />
      </div>
      <p style={{ margin: "10px 0 0", fontSize: 13, lineHeight: 1.55,
                  color: "var(--text-muted)" }}>{why}</p>
    </div>
  );
}

export default function ConnectStep() {
  const router = useRouter();
  const [draft, update, loaded] = useDraft();
  const [instagram, setInstagram] = React.useState("");
  const [tiktok, setTiktok] = React.useState("");

  React.useEffect(() => {
    if (!loaded) return;
    setInstagram(draft.instagram ?? ""); setTiktok(draft.tiktok ?? "");
  }, [loaded, draft.instagram, draft.tiktok]);

  function finish(skip = false) {
    if (!skip) update({ instagram, tiktok });
    router.push("/onboarding/done");
  }

  const any = instagram.trim() || tiktok.trim();

  return (
    <StepShell
      current="connect"
      eyebrow="Connect accounts"
      title="Where should we look for your videos?"
      blurb="Without a handle we cannot tell that a post is about you. This is the one thing that turns an unmeasured venue into a measured one."
      onNext={() => finish()}
      nextLabel={any ? "Finish setup" : "Continue"}
      onSkip={() => finish(true)}
    >
      <HandleField platform="Instagram" icon="instagram" value={instagram}
        onChange={setInstagram}
        why="Also how story mentions reach us — Instagram delivers a story that tags your account straight to your inbox." />
      <HandleField platform="TikTok" icon="tiktok" value={tiktok}
        onChange={setTiktok}
        why="Where this kind of content actually lives. Posts tagging you become attributable the moment we have this." />

      <div style={{ display: "flex", gap: 9, alignItems: "flex-start", marginTop: 8,
                    padding: "13px 15px", borderRadius: 10,
                    background: "var(--purple-tint)" }}>
        <Icon name="info" size={14} color="var(--purple-deep)" />
        <span style={{ fontSize: 12.5, color: "var(--purple-deepest)", lineHeight: 1.6 }}>
          Right now 2,100 of the 2,102 venues we hold have no TikTok handle on
          file. Adding yours puts you ahead of effectively the whole county.
        </span>
      </div>
    </StepShell>
  );
}
