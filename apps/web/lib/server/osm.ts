/* One OpenStreetMap object (a café), read on the server: its tags plus when it
   was last edited. The main OSM API answers single-object reads fastest;
   Overpass is the fallback. */

const UA = "divvit-marketplace/1.0 (+https://divvit.app)";

export type OsmPlace = { tags: Record<string, string>; version: number | null; timestamp: string | null };

export const OSM_REF = /^(node|way|relation)\/\d{1,15}$/;

export async function osmPlace(ref: string): Promise<OsmPlace | null> {
  if (!OSM_REF.test(ref)) return null;
  const get = async (url: string, ms: number) => {
    try {
      const r = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(ms), cache: "no-store" });
      if (!r.ok) return null;
      const data = (await r.json()) as { elements?: { tags?: Record<string, string>; version?: number; timestamp?: string }[] };
      const e = data.elements?.[0];
      return e ? { tags: e.tags ?? {}, version: e.version ?? null, timestamp: e.timestamp ?? null } : null;
    } catch {
      return null;
    }
  };
  const [type, id] = ref.split("/");
  return (await get(`https://api.openstreetmap.org/api/0.6/${type}/${id}.json`, 4000))
    ?? (await get(`https://overpass-api.de/api/interpreter?data=${encodeURIComponent(`[out:json][timeout:5];${type}(${id});out meta;`)}`, 6000));
}

/** The café's public contact points, as the map lists them (never what someone typed at sign-up). */
export function publicContact(p: OsmPlace) {
  const t = p.tags;
  return {
    name: t.name || "",
    website: t.website || t["contact:website"] || t.url || "",
    phone: (t.phone || t["contact:phone"] || "").split(";")[0].trim(),
  };
}

/** Brand-new map entries (first version, under 90 days old) could have been added by anyone — check those by hand. */
export function isNewOnMap(p: OsmPlace) {
  if (p.version !== 1 || !p.timestamp) return false;
  return Date.now() - new Date(p.timestamp).getTime() < 90 * 24 * 3600 * 1000;
}
