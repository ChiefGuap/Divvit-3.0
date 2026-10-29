import { NextResponse } from "next/server";
import { domainOf, readSite, socialLink } from "@/lib/server/site-profile";
import { hoursPerWeek } from "@/lib/marketplace/hours";
import { isNewOnMap, OSM_REF, osmPlace } from "@/lib/server/osm";
import { overLimit, tooMany } from "@/lib/server/rate-limit";

/* Everything public about one café, once it's picked from the search:
     OpenStreetMap tags                → website, Instagram, opening hours, phone
     the café's own website           → Instagram, hours, photo, description
   GET /api/cafes/details?ref=node/123 */

export const runtime = "nodejs";

export type CafeDetails = {
  /** the name on the public listing */
  name: string;
  website: string; instagram: string; openingHours: string; hoursPerWeek: number | null; phone: string;
  brand: string; image: string; description: string; sources: string[];
  /** first added to OpenStreetMap in the last 90 days — verification is done by hand */
  newOnMap: boolean;
};

const instagramUrl = (v: string | undefined) => {
  if (!v) return "";
  if (/^https?:\/\//.test(v)) return socialLink(v)?.[0] === "instagram" ? socialLink(v)![1] : "";
  const handle = v.replace(/^@/, "").replace(/[^A-Za-z0-9_.]/g, "");
  return handle ? `https://www.instagram.com/${handle}/` : "";
};

export async function GET(req: Request) {
  if (overLimit(req, "cafe-details", 30)) return tooMany();
  const ref = new URL(req.url).searchParams.get("ref") || "";
  if (!OSM_REF.test(ref)) return NextResponse.json({ error: "Bad ref" }, { status: 400 });

  const place = await osmPlace(ref);
  const tags = place?.tags ?? {};
  const site0 = tags.website || tags["contact:website"] || tags.url || "";
  const site = site0 ? await readSite(site0) : null;

  const openingHours = (tags.opening_hours || site?.openingHours || "").slice(0, 300);
  const sources = [Object.keys(tags).length ? "OpenStreetMap" : "", site ? site.domain : ""].filter(Boolean);
  const out: CafeDetails = {
    name: tags.name || "",
    website: site?.website || (site0 ? `https://${domainOf(site0)}` : ""),
    instagram: instagramUrl(tags["contact:instagram"] || tags.instagram) || site?.links.instagram || "",
    openingHours,
    hoursPerWeek: hoursPerWeek(openingHours),
    phone: (tags.phone || tags["contact:phone"] || site?.phone || "").slice(0, 40),
    brand: tags.brand || "",
    image: site?.image || "",
    description: site?.description || "",
    sources,
    newOnMap: place ? isNewOnMap(place) : false,
  };
  return NextResponse.json(out, { headers: { "Cache-Control": "private, max-age=600" } });
}
