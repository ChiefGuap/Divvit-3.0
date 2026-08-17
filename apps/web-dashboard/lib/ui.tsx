"use client";

/* Small shared primitives. Values come from the handoff's Design Tokens table. */

import React from "react";

export const CARD_SHADOW = "0 0 0 1px rgba(17,24,39,0.07), 0 2px 6px rgba(58,32,137,0.05)";
export const GLASS_SHADOW = "inset 0 0 0 1px rgba(255,255,255,0.7), 0 10px 30px rgba(140,82,255,0.08)";
export const EASE = "cubic-bezier(0.16,1,0.3,1)";

/** Entrance used by every card/section, staggered down the page. */
export const fadeUp = (delay: string, dur = "0.55s"): React.CSSProperties => ({
  animation: `dvFadeUp ${dur} ${delay} ${EASE} backwards`,
});

/** White card. */
export function Card({ children, style, className, ...rest }: React.ComponentProps<"div">) {
  return (
    <div
      className={className}
      style={{
        background: "#ffffff",
        borderRadius: 18,
        boxShadow: CARD_SHADOW,
        padding: "18px 20px",
        display: "flex",
        flexDirection: "column",
        flex: "0 0 auto",
        ...style,
      }}
      {...rest}
    >
      {children}
    </div>
  );
}

/** Frosted panel used on the home screen rows. */
export function GlassCard({ children, style, ...rest }: React.ComponentProps<"div">) {
  return (
    <div
      style={{
        borderRadius: 20,
        padding: "18px 20px 16px",
        display: "flex",
        flexDirection: "column",
        background: "rgba(255,255,255,0.72)",
        backdropFilter: "blur(20px) saturate(150%)",
        WebkitBackdropFilter: "blur(20px) saturate(150%)",
        boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.7), 0 14px 36px rgba(140,82,255,0.08)",
        ...style,
      }}
      {...rest}
    >
      {children}
    </div>
  );
}

/** Page title + subtitle on the left, primary action on the right. */
export function PageHead({ title, subtitle, action }: {
  title: string;
  subtitle: string;
  action?: React.ReactNode;
}) {
  return (
    <div style={{
      display: "flex", alignItems: "flex-end", justifyContent: "space-between",
      gap: 16, flexWrap: "wrap", ...fadeUp("0.05s", "0.5s"),
    }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, letterSpacing: "-0.01em" }}>{title}</h1>
        <p style={{ margin: 0, color: "#6b7280", fontSize: 13.5, maxWidth: "80ch" }}>{subtitle}</p>
      </div>
      {action}
    </div>
  );
}

export const PURPLE_GRADIENT =
  "linear-gradient(180deg,#9a63ff 0%,#8c52ff 30%,#6f3bea 66%,#4b29b4 100%)";

/** Primary purple button — gradient slides on hover. */
export function PurpleButton({ children, style, ...rest }: React.ComponentProps<"button">) {
  return (
    <button
      className="btnPurple"
      style={{
        display: "inline-flex", alignItems: "center", gap: 8,
        padding: "10px 18px", borderRadius: 10, fontSize: 13.5,
        boxShadow: "0 6px 16px rgba(140,82,255,0.22)", whiteSpace: "nowrap",
        ...style,
      }}
      {...rest}
    >
      {children}
    </button>
  );
}

/** Quiet secondary button. */
export function QuietButton({ children, style, className = "", ...rest }: React.ComponentProps<"button">) {
  return (
    <button
      className={`btnQuiet ${className}`}
      style={{
        display: "inline-flex", alignItems: "center", gap: 8,
        padding: "10px 18px", borderRadius: 10, fontSize: 13.5, ...style,
      }}
      {...rest}
    >
      {children}
    </button>
  );
}

/** Segmented control on a grey inset track (Creators filter, tab pairs). */
export function Segmented({ options, value, onChange, style }: {
  options: { value: string; label: React.ReactNode; count?: React.ReactNode }[];
  value: string;
  onChange: (v: string) => void;
  style?: React.CSSProperties;
}) {
  return (
    <div style={{
      display: "inline-flex", alignItems: "center", gap: 4, padding: 4,
      borderRadius: 12, background: "#f2f0f8",
      boxShadow: "inset 0 0 0 1px rgba(17,24,39,0.06)", ...style,
    }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            className={on ? "" : "hoverInk"}
            style={{
              display: "inline-flex", alignItems: "center", gap: 7,
              padding: "7px 14px", borderRadius: 9, fontSize: 13, fontWeight: 600,
              color: on ? "#fff" : "#6b7280",
              background: on ? "#8c52ff" : "transparent",
              boxShadow: on ? "0 1px 3px rgba(140,82,255,0.35)" : "none",
              transition: "background 0.18s ease, color 0.18s ease",
            }}
          >
            {o.label}
            {o.count !== undefined && (
              <span style={{ fontSize: 11.5, fontWeight: 700, color: on ? "rgba(255,255,255,0.75)" : "#9ca3af" }}>
                {o.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Tab pair rendered as white-on-track pills (Library/Archive, Rewards/Campaigns). */
export function TabPair({ options, value, onChange, style }: {
  options: { value: string; label: React.ReactNode }[];
  value: string;
  onChange: (v: string) => void;
  style?: React.CSSProperties;
}) {
  return (
    <div style={{
      display: "flex", padding: 4, background: "#f1f1f6", borderRadius: 12,
      boxShadow: "0 0 0 1px rgba(17,24,39,0.07)", gap: 2, ...style,
    }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "7px 15px", borderRadius: 8, fontSize: 13, fontWeight: 600,
              color: on ? "#fff" : "#6b7280",
              background: on ? "#8c52ff" : "transparent",
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** A 9:16 or 16:10 media area. Replaces the prototype's <image-slot>. */
export function Thumb({ background, ratio = "16/10", radius = 12, children, style }: {
  background: string;
  ratio?: string;
  radius?: number;
  children?: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div style={{
      position: "relative", aspectRatio: ratio, background,
      borderRadius: radius, overflow: "hidden",
      display: "flex", alignItems: "center", justifyContent: "center",
      ...style,
    }}>
      {children}
    </div>
  );
}

/** Circular white play affordance over a thumbnail. */
export function PlayBadge({ size = 42 }: { size?: number }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%",
      background: "rgba(255,255,255,0.9)", display: "flex",
      alignItems: "center", justifyContent: "center", color: "#111827",
      boxShadow: "0 2px 8px rgba(17,24,39,0.12)",
    }}>
      <svg width={size * 0.38} height={size * 0.38} viewBox="0 0 24 24" fill="currentColor"
           style={{ marginLeft: 2 }} aria-hidden>
        <path d="M6 4l14 8-14 8z" />
      </svg>
    </div>
  );
}

/** Counter that eases to its target with rAF (README: Counters / score). */
export function useCountUp(target: number, duration = 900, run = true) {
  const [value, setValue] = React.useState(0);
  React.useEffect(() => {
    if (!run) return;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      setValue(Math.round(target * (1 - Math.pow(1 - t, 4))));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration, run]);
  return value;
}

export function relativeTime(from: number, now: number) {
  const s = Math.max(0, Math.floor((now - from) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}
