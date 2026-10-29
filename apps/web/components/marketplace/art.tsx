/* Background art for choice cards: a large line drawing tucked into the card's
   corner, nearly transparent. Replaces emoji — reads as designed, not generated. */

import { ART_PATHS, type ArtName } from "@/lib/marketplace/art-paths";

export type { ArtName };

export function Art({ name }: { name: ArtName }) {
  return (
    <svg className="mp-art" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="0.85"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
      // static, trusted path data from lib/marketplace/art-paths.ts
      dangerouslySetInnerHTML={{ __html: ART_PATHS[name] }} />
  );
}

/** Abstract "more" art: concentric rings, one per level (how busy, how many sleeves). */
export function Rings({ level }: { level: 1 | 2 | 3 | 4 }) {
  return (
    <svg className="mp-art" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="0.85" aria-hidden="true">
      {Array.from({ length: level }, (_, k) => <circle key={k} cx="12" cy="12" r={3 + k * 2.6} />)}
      <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Small inline pin for place results. */
export function PinIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" dangerouslySetInnerHTML={{ __html: ART_PATHS.pin }} />
  );
}

export function CheckIcon({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path className="mp-check-path" d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}
