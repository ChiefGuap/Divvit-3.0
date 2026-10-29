import { NextResponse } from "next/server";
import { overLimit, tooMany } from "@/lib/server/rate-limit";

/* Place search for the marketplace map, proxied to Photon (OpenStreetMap,
   keyless). Returns each place's bounding box so the map can zoom to it.
   ?q=austin            → cities / neighborhoods (US-biased)
   ?q=...&mode=address  → street addresses, for cafés listing themselves */

export const runtime = "nodejs";

type PhotonFeature = {
  geometry: { coordinates: [number, number] };
  properties: {
    name?: string; street?: string; housenumber?: string; city?: string; district?: string; locality?: string;
    county?: string; state?: string; country?: string; countrycode?: string; postcode?: string;
    osm_value?: string; type?: string; extent?: [number, number, number, number];
  };
};

export async function GET(req: Request) {
  if (overLimit(req, "geocode", 60)) return tooMany();
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") || "").trim().slice(0, 120);
  const mode = searchParams.get("mode") === "address" ? "address" : "place";
  if (q.length < 2) return NextResponse.json({ results: [] });

  const url = new URL("https://photon.komoot.io/api/");
  url.searchParams.set("q", q);
  url.searchParams.set("limit", "7");
  url.searchParams.set("lang", "en");
  // bias toward the continental US, where the network is
  url.searchParams.set("lat", "39.5");
  url.searchParams.set("lon", "-98.35");
  if (mode === "place") for (const l of ["city", "district", "locality", "county", "state"]) url.searchParams.append("layer", l);

  try {
    const r = await fetch(url, { headers: { "User-Agent": "divvit-marketplace/1.0 (+https://divvit.app)" }, next: { revalidate: 86400 } });
    if (!r.ok) throw new Error(String(r.status));
    const data = (await r.json()) as { features: PhotonFeature[] };
    const results = data.features.map((f) => {
      const p = f.properties;
      const [lng, lat] = f.geometry.coordinates;
      const street = [p.housenumber, p.street].filter(Boolean).join(" ");
      const parts = mode === "address"
        ? [p.name && p.name !== street ? p.name : null, street, p.city ?? p.locality, p.state]
        : [p.name, p.city && p.city !== p.name ? p.city : null, p.state, p.countrycode !== "US" ? p.country : null];
      const label = [...new Set(parts.filter(Boolean))].join(", ");  // "New York, New York" → once
      // Photon extent is [minLon, maxLat, maxLon, minLat]; return [west, south, east, north]
      const e = p.extent;
      // US neighborhoods come back as points with no extent: draw a neighborhood-sized box (≈2.7 × 2 km),
      // widened east–west so it isn't squashed at higher latitudes
      const hood = p.type === "locality" || p.type === "district";
      const dy = mode === "address" ? 0.004 : hood ? 0.012 : 0.03;
      const dx = dy / Math.max(0.3, Math.cos((lat * Math.PI) / 180));
      const bbox: [number, number, number, number] = e ? [e[0], e[3], e[2], e[1]] : [lng - dx, lat - dy, lng + dx, lat + dy];
      return {
        id: `${lng.toFixed(5)},${lat.toFixed(5)}`, label, name: p.name ?? street, lat, lng, bbox,
        city: p.city ?? (p.type === "city" ? p.name : p.locality) ?? p.county ?? null, region: p.state ?? null,
        neighborhood: p.locality ?? p.district ?? null, address: street || null, type: p.type ?? p.osm_value ?? null,
      };
    });
    return NextResponse.json({ results });
  } catch {
    return NextResponse.json({ results: [], error: "Place search is unavailable right now." }, { status: 502 });
  }
}
