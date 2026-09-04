/**
 * Pure display formatting. No database, no server imports.
 *
 * These live apart from `queries.ts` because client components need them and
 * `queries.ts` imports `next/headers`, which cannot be bundled for the
 * browser. Importing one formatter from there dragged the whole server module
 * into the client build.
 *
 * Both functions encode the same rule the query layer enforces: **absent is
 * not zero.** A missing measurement renders as an em dash, never as 0, so a
 * venue nobody has measured is never shown level with one measured at zero.
 */

export function orDash(n: number | null | undefined, digits = 0): string {
  return n === null || n === undefined ? "—" : n.toFixed(digits);
}

export function compactCount(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
