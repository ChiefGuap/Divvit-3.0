"use client";

/* The end of the flow.

   Square's equivalent screen offers two doors — keep setting up, or buy
   hardware. Divvit has no hardware, so the two doors are the two things a
   venue can actually do next: look at what already exists about them, or
   start asking for more.

   The checklist below is honest about state. Steps the flow completed are
   ticked; steps that need something not yet built say so rather than sitting
   there as unfinished homework the venue cannot do. */

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon, type IconName } from "@/lib/icons";
import { EASE } from "@/lib/ui";
import { Rail } from "@/components/onboarding/Chrome";
import { clearDraft, useDraft } from "@/components/onboarding/draft";

export default function DoneStep() {
  const router = useRouter();
  const [draft, , loaded] = useDraft();

  React.useEffect(() => {
    if (loaded && !draft.venueName) router.replace("/onboarding");
  }, [loaded, draft.venueName, router]);

  const handles = [draft.instagram, draft.tiktok].filter((h) => h && h.trim());

  const checklist: { label: string; done: boolean; note: string }[] = [
    { label: "Account created", done: true, note: draft.email || "" },
    { label: "Venue claimed", done: Boolean(draft.venueName),
      note: draft.claimedFromRoster
        ? "Matched to our roster, so your history came with it"
        : "Added manually — measurement starts from today" },
    { label: "Brand health", done: draft.brandHealth !== null,
      note: draft.brandHealth !== null
        ? `Already scored ${draft.brandHealth}/100`
        : "Not measured yet — needs a few days of public signal" },
    { label: "Social accounts", done: handles.length > 0,
      note: handles.length
        ? handles.map((h) => `@${h!.replace(/^@/, "")}`).join(" · ")
        : "Not connected — posts about you cannot be attributed yet" },
  ];

  return (
    <div style={{ minHeight: "100vh", background: "var(--surface)" }}>
      <Rail current="connect" />
      <div style={{ maxWidth: 660, margin: "0 auto", padding: "72px 24px 80px" }}>
        <span style={{ fontSize: 14.5, color: "var(--text-muted)" }}>You&apos;re set up</span>
        <h1 style={{ margin: "6px 0 0", fontSize: 40, lineHeight: 1.12, fontWeight: 800,
                     letterSpacing: "-0.025em" }}>
          Welcome to Divvit{draft.venueName ? `, ${draft.venueName}` : ""}
        </h1>
        <p style={{ margin: "16px 0 0", fontSize: 16, lineHeight: 1.6,
                    color: "var(--text-secondary)" }}>
          Here&apos;s where things stand. Nothing below is a guess — it is what we
          actually hold for you right now.
        </p>

        <div style={{ marginTop: 32, border: "1px solid #e6e2f2", borderRadius: 16,
                      overflow: "hidden" }}>
          {checklist.map((c, i) => (
            <div key={c.label} style={{
              display: "flex", alignItems: "flex-start", gap: 13, padding: "16px 20px",
              borderTop: i ? "1px solid var(--surface-sunken-2)" : "none",
              background: "var(--surface)",
            }}>
              <span style={{
                marginTop: 1, display: "inline-flex", alignItems: "center",
                justifyContent: "center", width: 20, height: 20, borderRadius: 99,
                flex: "0 0 auto", fontSize: 11, fontWeight: 800,
                background: c.done ? "rgba(22,160,107,0.14)" : "var(--surface-sunken-2)",
                color: c.done ? "#0d7a4f" : "var(--text-faint)",
              }}>{c.done ? "✓" : "–"}</span>
              <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ fontSize: 14.5, fontWeight: 650 }}>{c.label}</span>
                {c.note && (
                  <span style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.5 }}>
                    {c.note}
                  </span>
                )}
              </span>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 26 }}>
          <Link href="/discover/brand-health" onClick={() => clearDraft()} style={{
            display: "flex", alignItems: "center", gap: 15, padding: "20px 22px",
            borderRadius: 16, textDecoration: "none", color: "inherit",
            border: "1px solid #e6e2f2", background: "var(--surface)",
            transition: `transform 0.18s ${EASE}`,
          }}
            onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-2px)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.transform = "none"; }}>
            <span style={{ display: "inline-flex", alignItems: "center",
                           justifyContent: "center", width: 40, height: 40, borderRadius: 12,
                           background: "var(--purple-tint)" }}>
              <Icon name="pulse" size={19} color="var(--purple-deep)" />
            </span>
            <span style={{ display: "flex", flexDirection: "column", gap: 3, flex: 1 }}>
              <span style={{ fontSize: 15.5, fontWeight: 700 }}>See your brand health</span>
              <span style={{ fontSize: 13.5, color: "var(--text-muted)", lineHeight: 1.5 }}>
                What the public web already says about you, scored and ranked
                against other Orange County independents.
              </span>
            </span>
            <Icon name="right" size={16} color="var(--text-faint)" />
          </Link>

          <Link href="/rewards" onClick={() => clearDraft()} style={{
            display: "flex", alignItems: "center", gap: 15, padding: "20px 22px",
            borderRadius: 16, textDecoration: "none", color: "inherit",
            border: "1px solid #e6e2f2", background: "var(--surface)",
            transition: `transform 0.18s ${EASE}`,
          }}
            onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-2px)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.transform = "none"; }}>
            <span style={{ display: "inline-flex", alignItems: "center",
                           justifyContent: "center", width: 40, height: 40, borderRadius: 12,
                           background: "var(--purple-tint)" }}>
              <Icon name="gift" size={19} color="var(--purple-deep)" />
            </span>
            <span style={{ display: "flex", flexDirection: "column", gap: 3, flex: 1 }}>
              <span style={{ fontSize: 15.5, fontWeight: 700 }}>Set up a reward</span>
              <span style={{ fontSize: 13.5, color: "var(--text-muted)", lineHeight: 1.5 }}>
                Decide what a guest gets for filming. This is what turns a
                measured venue into one people post about on purpose.
              </span>
            </span>
            <Icon name="right" size={16} color="var(--text-faint)" />
          </Link>
        </div>

        <p style={{ margin: "26px 0 0", fontSize: 13.5, color: "var(--text-muted)" }}>
          <Link href="/" onClick={() => clearDraft()}
            style={{ color: "var(--purple-deep)", fontWeight: 600, textDecoration: "none" }}>
            Skip to the dashboard
          </Link>{" "}— you can finish either of these any time.
        </p>
      </div>
    </div>
  );
}
