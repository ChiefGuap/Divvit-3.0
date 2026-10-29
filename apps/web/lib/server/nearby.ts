/* Concrete places near a café — offices and HQs, colleges and schools, coworking
   spaces (where startups sit) and landmarks — from OpenStreetMap via Overpass.
   Startups see the closest few on each café card ("Near Salesforce Tower ·
   Moscone Center") and can filter by them. Stored on mp_cafes.nearby; filled by
   /api/cafes/nearby. Only type imports, so a one-off script can use it too. */

import type { NearbyKind, NearbyPlace } from "@/lib/marketplace/types";

type El = { lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> };

export const NEARBY_RADIUS_M = 650;
const ENDPOINTS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter", "https://overpass.private.coffee/api/interpreter"];

/** area: an Overpass bbox "(s,w,n,e)" or "(around:650,lat,lng)" */
export const placesQuery = (area: string) => `[out:json][timeout:90];(
  nwr["amenity"~"^(university|college|school)$"]["name"]${area};
  nwr["office"~"^(company|it|research|coworking|government|financial|newspaper|telecommunication)$"]["name"]${area};
  nwr["amenity"="coworking_space"]["name"]${area};
  nwr["tourism"~"^(attraction|museum|gallery)$"]["name"]${area};
  nwr["historic"~"^(monument|memorial|castle|fort)$"]["name"]${area};
  nwr["leisure"="stadium"]["name"]${area};
);out center tags;`;

export async function fetchPlaces(area: string): Promise<El[]> {
  let last: unknown;
  for (const url of ENDPOINTS) {
    try {
      // Overpass refuses requests without a User-Agent
      const r = await fetch(url, {
        method: "POST", cache: "no-store", signal: AbortSignal.timeout(60_000),
        headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "Divvit/1.0 (marketplace.divvit.app)" },
        body: `data=${encodeURIComponent(placesQuery(area))}`,
      });
      if (!r.ok) throw new Error(`${url} ${r.status}`);
      return ((await r.json()) as { elements: El[] }).elements;
    } catch (e) { last = e; }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

function kindOf(t: Record<string, string>): NearbyKind {
  if (/^(university|college|school)$/.test(t.amenity ?? "")) return "school";
  if (t.office === "coworking" || t.amenity === "coworking_space") return "startup";
  if (t.office) return "office";
  return "landmark";
}

const meters = (a: number, b: number, c: number, d: number) => {
  const r = Math.PI / 180, x = (d - b) * r * Math.cos(((a + c) / 2) * r), y = (c - a) * r;
  return Math.sqrt(x * x + y * y) * 6_371_000;
};

/** The closest few: the closest of each kind first, then the next closest. Well-known
    places (on Wikipedia) count as closer, and K-12 schools as farther than colleges.
    Cards show the first three, so they mix kinds; the rest let the filters match. */
export function pickNearby(els: El[], lat: number, lng: number, cafeName = "", max = 6): NearbyPlace[] {
  const seen = new Set([cafeName.trim().toLowerCase()]);
  const all = els.flatMap((e) => {
    const t = e.tags ?? {}, p = e.center ?? (e.lat != null && e.lon != null ? { lat: e.lat, lon: e.lon } : null);
    const name = (t.name ?? "").trim();
    if (!p || name.length < 3 || /^\d+$/.test(name)) return [];
    const known = Boolean(t.wikidata || t.wikipedia);
    // statues and plaques are everywhere; only notable monuments say something about a block
    if (t.historic && !known) return [];
    const m = meters(lat, lng, p.lat, p.lon);
    if (m > NEARBY_RADIUS_M) return [];
    const score = m * (known ? 0.35 : 1) * (t.amenity === "school" ? 2 : 1);
    return [{ name, kind: kindOf(t), m: Math.round(m), score }];
  }).sort((a, b) => a.score - b.score)
    .filter((x) => { const k = x.name.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });

  const out: typeof all = [];
  for (const kind of ["office", "school", "startup", "landmark"] as NearbyKind[]) {
    const best = all.find((x) => x.kind === kind);
    if (best) out.push(best);
  }
  out.sort((a, b) => a.score - b.score);
  for (const x of all) if (out.length < max && !out.includes(x)) out.push(x);
  return out.slice(0, max).map(({ name, kind, m }) => ({ name, kind, m }));
}
