import { NextResponse } from "next/server";
import { overLimit, tooMany } from "@/lib/server/rate-limit";

/* "Is this your café?" — cafés and coffee shops by name, from OpenStreetMap
   (via Photon, keyless). Biased toward the visitor's location when the host
   provides it (Vercel geo headers), else toward the continental US.
   GET /api/cafes/search?q=<name, optionally with a city> */

export const runtime = "nodejs";

type PhotonFeature = {
  geometry: { coordinates: [number, number] };
  properties: {
    name?: string; street?: string; housenumber?: string; city?: string; district?: string; locality?: string;
    county?: string; state?: string; countrycode?: string; postcode?: string; osm_type?: string; osm_id?: number;
  };
};

export type CafeMatch = {
  ref: string; name: string; address: string | null; neighborhood: string | null; city: string; region: string | null;
  postcode: string | null; lat: number; lng: number; label: string;
};

const OSM_TYPE: Record<string, string> = { N: "node", W: "way", R: "relation" };

// words every café shares; a match has to share something more distinctive than these
const GENERIC = new Set(["cafe", "caffe", "coffee", "coffeehouse", "espresso", "the", "and", "co", "shop", "house", "bar", "roasters",
  "roastery", "roasting", "bakery", "kitchen", "tea", "de", "la", "el", "le", "du", "of"]);
const words = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1);

export async function GET(req: Request) {
  if (overLimit(req, "cafe-search", 60)) return tooMany();
  const q = (new URL(req.url).searchParams.get("q") || "").trim().slice(0, 120);
  if (q.length < 2) return NextResponse.json({ matches: [] });

  const lat = Number(req.headers.get("x-vercel-ip-latitude"));
  const lon = Number(req.headers.get("x-vercel-ip-longitude"));
  const url = new URL("https://photon.komoot.io/api/");
  url.searchParams.set("q", q);
  url.searchParams.set("limit", "6");
  url.searchParams.set("lang", "en");
  url.searchParams.set("lat", String(Number.isFinite(lat) && lat ? lat : 39.5));
  url.searchParams.set("lon", String(Number.isFinite(lon) && lon ? lon : -98.35));
  for (const t of ["amenity:cafe", "shop:coffee"]) url.searchParams.append("osm_tag", t);

  try {
    const r = await fetch(url, { headers: { "User-Agent": "divvit-marketplace/1.0 (+https://divvit.app)" }, next: { revalidate: 86400 } });
    if (!r.ok) throw new Error(String(r.status));
    const data = (await r.json()) as { features: PhotonFeature[] };
    const wanted = new Set(words(q).filter((w) => !GENERIC.has(w)));
    const matches: CafeMatch[] = data.features
      .filter((f) => f.properties.name && f.properties.osm_type && f.properties.osm_id)
      // the café's own name has to share a distinctive word with what they typed ("Devocion Williamsburg" → Devoción)
      .filter((f) => !wanted.size || words(f.properties.name!).some((w) => !GENERIC.has(w)
        && [...wanted].some((x) => x === w || (w.length > 3 && x.length > 3 && (w.startsWith(x) || x.startsWith(w))))))
      .map((f) => {
        const p = f.properties;
        const [lng, lat] = f.geometry.coordinates;
        const address = [p.housenumber, p.street].filter(Boolean).join(" ") || null;
        const city = p.city ?? p.district ?? p.county ?? "";
        const neighborhood = p.locality ?? (p.district && p.district !== city ? p.district : null);
        return {
          ref: `${OSM_TYPE[p.osm_type!]}/${p.osm_id}`, name: p.name!, address, neighborhood, city, region: p.state ?? null,
          postcode: p.postcode ?? null, lat, lng,
          label: [...new Set([address, neighborhood, city, p.state].filter(Boolean))].join(", "),
        };
      });
    return NextResponse.json({ matches }, { headers: { "Cache-Control": "private, max-age=300" } });
  } catch {
    return NextResponse.json({ matches: [], error: "Café search is unavailable right now." }, { status: 502 });
  }
}
