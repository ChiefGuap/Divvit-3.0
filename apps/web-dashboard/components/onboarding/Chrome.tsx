"use client";

/* Onboarding chrome: the stepper, the back arrow, and the Skip/Next pair.

   Modelled on the shape of a good signup flow — one question per screen, a
   progress rail that names the phases, and forward motion always in the top
   right — but drawn in Divvit's own system: purple rather than blue, Inter,
   the same card and radius language as the dashboard.

   The rail is not a progress bar. It names the four phases so someone landing
   mid-flow knows what is left, and marks the current one rather than
   implying a percentage that would be invented. */

import React from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/lib/icons";
import { EASE } from "@/lib/ui";

export type StepKey = "account" | "venue" | "profile" | "connect";

export const STEPS: { key: StepKey; label: string; href: string }[] = [
  { key: "account", label: "Your account", href: "/onboarding" },
  { key: "venue", label: "Find your venue", href: "/onboarding/venue" },
  { key: "profile", label: "Confirm details", href: "/onboarding/profile" },
  { key: "connect", label: "Connect accounts", href: "/onboarding/connect" },
];

export function Rail({ current }: { current: StepKey }) {
  const idx = STEPS.findIndex((s) => s.key === current);
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "center", gap: 0,
      padding: "0 24px", height: 64, borderBottom: "1px solid var(--surface-sunken-2)",
      background: "var(--surface)", flexWrap: "wrap",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginRight: "auto" }}>
        <span style={{
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          width: 26, height: 26, borderRadius: 8,
          background: "linear-gradient(160deg,#8c52ff,#6346cd)", color: "#fff",
          fontWeight: 800, fontSize: 14, fontFamily: "Alatsi, Inter, sans-serif",
        }}>D</span>
        <span style={{ fontFamily: "Alatsi, Inter, sans-serif", fontSize: 19,
                       color: "var(--purple-deepest)" }}>Divvit</span>
      </div>

      {STEPS.map((s, i) => {
        const done = i < idx;
        const now = i === idx;
        return (
          <React.Fragment key={s.key}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
              <span style={{
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                width: 17, height: 17, borderRadius: 99, fontSize: 10, fontWeight: 800,
                background: done ? "var(--purple-deep)" : now ? "transparent" : "transparent",
                border: done ? "none" : `1.5px solid ${now ? "var(--purple-deep)" : "#ddd8ee"}`,
                color: "#fff",
              }}>{done ? "✓" : ""}</span>
              <span style={{
                fontSize: 13, fontWeight: now ? 700 : 500,
                color: done || now ? "var(--ink)" : "var(--text-faint)",
              }}>{s.label}</span>
            </span>
            {i < STEPS.length - 1 && (
              <span style={{ width: 44, height: 1, margin: "0 12px",
                             background: done ? "var(--purple-deep)" : "#e6e2f2" }} />
            )}
          </React.Fragment>
        );
      })}
      <span style={{ marginLeft: "auto", fontSize: 13, color: "var(--text-faint)" }}>
        Step {idx + 1} of {STEPS.length}
      </span>
    </div>
  );
}

export function StepShell({ current, eyebrow, title, blurb, onNext, nextLabel = "Next",
                           nextDisabled, onSkip, back = true, children }: {
  current: StepKey;
  eyebrow: string;
  title: string;
  blurb?: React.ReactNode;
  onNext?: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
  onSkip?: () => void;
  back?: boolean;
  children?: React.ReactNode;
}) {
  const router = useRouter();
  return (
    <div style={{ minHeight: "100vh", background: "var(--surface)" }}>
      <Rail current={current} />

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "26px 24px 80px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 34 }}>
          {back ? (
            <button onClick={() => router.back()} aria-label="Back" style={{
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              width: 40, height: 40, borderRadius: 12, border: "none", cursor: "pointer",
              background: "var(--surface-sunken-2)", transition: `background 0.15s ${EASE}`,
            }}>
              <Icon name="left" size={17} color="var(--ink)" />
            </button>
          ) : <span style={{ width: 40 }} />}

          <span style={{ flex: 1 }} />

          {onSkip && (
            <button onClick={onSkip} style={{
              padding: "11px 20px", borderRadius: 12, border: "none", cursor: "pointer",
              background: "var(--surface-sunken-2)", color: "var(--purple-deep)",
              fontWeight: 700, fontSize: 14.5, fontFamily: "inherit",
            }}>Skip</button>
          )}
          {onNext && (
            <button onClick={onNext} disabled={nextDisabled} style={{
              padding: "11px 24px", borderRadius: 12, border: "none",
              cursor: nextDisabled ? "not-allowed" : "pointer",
              background: nextDisabled
                ? "var(--surface-sunken-2)"
                : "linear-gradient(160deg,#8c52ff,#6346cd)",
              color: nextDisabled ? "var(--text-faint)" : "#fff",
              fontWeight: 700, fontSize: 14.5, fontFamily: "inherit",
              boxShadow: nextDisabled ? "none" : "0 1px 3px rgba(140,82,255,0.35)",
              transition: `opacity 0.15s ${EASE}`,
            }}>{nextLabel}</button>
          )}
        </div>

        <div style={{ maxWidth: 620, margin: "0 auto" }}>
          <span style={{ fontSize: 14.5, color: "var(--text-muted)" }}>{eyebrow}</span>
          <h1 style={{ margin: "6px 0 0", fontSize: 38, lineHeight: 1.15, fontWeight: 800,
                       letterSpacing: "-0.025em" }}>{title}</h1>
          {blurb && (
            <p style={{ margin: "16px 0 0", fontSize: 16, lineHeight: 1.6,
                        color: "var(--text-secondary)" }}>{blurb}</p>
          )}
          <div style={{ marginTop: 34 }}>{children}</div>
        </div>
      </div>
    </div>
  );
}

/* Shared field, matching the flow's larger type scale rather than the
   dashboard's denser one. */
export function BigField({ label, value, onChange, placeholder, type = "text",
                          hint, autoFocus }: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; type?: string; hint?: string; autoFocus?: boolean;
}) {
  const filled = value.length > 0;
  return (
    <label style={{ display: "block", marginBottom: 14 }}>
      <span style={{
        display: "block", border: "1px solid #e6e2f2", borderRadius: 14,
        padding: filled ? "10px 16px 12px" : "20px 16px",
        background: "var(--surface)", transition: `padding 0.15s ${EASE}`,
      }}>
        {filled && (
          <span style={{ display: "block", fontSize: 12.5, fontWeight: 650,
                         color: "var(--ink)", marginBottom: 2 }}>{label}</span>
        )}
        <input
          type={type} value={value} autoFocus={autoFocus}
          placeholder={filled ? placeholder : label}
          onChange={(e) => onChange(e.target.value)}
          style={{ width: "100%", border: "none", outline: "none", background: "none",
                   fontSize: 16, fontFamily: "inherit", color: "var(--ink)", padding: 0 }} />
      </span>
      {hint && (
        <span style={{ display: "block", marginTop: 7, fontSize: 13,
                       color: "var(--text-muted)", lineHeight: 1.55 }}>{hint}</span>
      )}
    </label>
  );
}
