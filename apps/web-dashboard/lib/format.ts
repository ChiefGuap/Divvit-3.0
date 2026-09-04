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

/**
 * OSM `cuisine` tags into something a venue would recognise.
 *
 * The raw value is a semicolon-separated tag list — "coffee_shop;latte;tea" —
 * which is fine as data and wrong on a screen a cafe owner reads while
 * deciding whether we know what we are talking about.
 *
 * Capped at two terms: the list can run to half a dozen, and a search result
 * needs a hint, not an inventory.
 */
export function prettyCuisine(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const parts = raw
    .split(/[;,]/)
    .map((p) => p.trim().replace(/_/g, " "))
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1));
  if (!parts.length) return null;
  return parts.slice(0, 2).join(", ");
}
