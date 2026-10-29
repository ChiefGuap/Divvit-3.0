import { NextResponse } from "next/server";
import { loadYc, money, pdlCompany, pdlEnabled, stageFromPdl } from "@/lib/server/companies";
import { domainOf, readSite, socialLink, type Links } from "@/lib/server/site-profile";
import { overLimit, tooMany } from "@/lib/server/rate-limit";

/* Everything we can learn about one startup, merged from every source:
     the YC directory  → one-liner, HQ, logo, industry, team size
     their website     → description, logo, LinkedIn + other profiles (from
                         the page's links and schema.org data), founding year
     People Data Labs  → headcount, founding year, funding, HQ, LinkedIn page
                         (only when PDL_API_KEY is set)
   GET /api/lookup/profile?yc=<slug>&domain=<domain>&linkedin=<company url> */

export const runtime = "nodejs";

export type StartupProfile = {
  name: string; website: string; domain: string; oneLiner: string; description: string; hq: string; logo: string;
  industry: string; tags: string[]; linkedin: string; links: Omit<Links, "linkedin"> & { yc?: string };
  teamSize: number | null; foundedYear: number | null; fundingStage: string; fundingTotal: string; batch: string;
  sources: string[]; pdl: boolean;
};

const firstSentence = (s: string) => (s.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s/)[0] ?? "").slice(0, 160);

export async function GET(req: Request) {
  if (overLimit(req, "lookup-profile", 12)) return tooMany();
  const sp = new URL(req.url).searchParams;
  const slug = (sp.get("yc") || "").slice(0, 120);
  const linkedinIn = socialLink(sp.get("linkedin") || "")?.[0] === "linkedin" ? socialLink(sp.get("linkedin")!)![1] : "";
  const yc = slug ? (await loadYc()).find((c) => c.slug === slug) ?? null : null;
  const domain = domainOf(sp.get("domain") || yc?.website || "");
  if (!yc && !domain && !linkedinIn) return NextResponse.json({ error: "Nothing to look up" }, { status: 400 });

  const site = domain ? await readSite(yc?.website || domain) : null;
  const linkedinSeen = linkedinIn || site?.links.linkedin || "";
  const pdl = await pdlCompany(domain ? { website: domain } : { linkedin: linkedinSeen });

  const sources: string[] = [];
  if (yc) sources.push("Y Combinator");
  if (site) sources.push(site.domain);
  if (pdl) sources.push("People Data Labs");

  const pdlLinkedin = pdl?.linkedin ? socialLink(pdl.linkedin)?.[1] ?? "" : "";
  const links: StartupProfile["links"] = {};
  for (const k of ["x", "instagram", "github", "crunchbase", "facebook"] as const) {
    const v = site?.links[k] || (k === "x" ? pdl?.x : k === "facebook" ? pdl?.facebook : "");
    if (v) links[k] = v;
  }
  if (yc) links.yc = yc.url;

  const out: StartupProfile = {
    name: yc?.name || pdl?.name || site?.name || domain,
    website: yc?.website || site?.website || (domain ? `https://${domain}` : pdl?.website || ""),
    domain: domain || domainOf(pdl?.website || ""),
    oneLiner: yc?.oneLiner || firstSentence(site?.description || "") || firstSentence(pdl?.description || ""),
    description: yc?.description || site?.description || pdl?.description || "",
    hq: (yc?.hq.split(";")[0].trim() || pdl?.hq || (site?.address ? [site.address.city, site.address.region].filter(Boolean).join(", ") : ""))
      .replace(/,\s*(USA|United States( of America)?|US)$/i, ""),
    logo: yc?.logo || site?.logo || "",
    industry: yc?.industry || pdl?.industry || "",
    tags: [...(yc?.tags ?? []), ...(pdl?.tags ?? [])].slice(0, 12),
    linkedin: linkedinIn || site?.links.linkedin || pdlLinkedin,
    links,
    teamSize: pdl?.teamSize ?? yc?.teamSize ?? site?.teamSize ?? null,
    foundedYear: pdl?.foundedYear ?? site?.foundedYear ?? null,
    fundingStage: stageFromPdl(pdl?.fundingStage || ""),
    fundingTotal: pdl?.fundingTotal ? money(pdl.fundingTotal) : "",
    batch: yc?.batch || "",
    sources,
    pdl: pdlEnabled(),
  };
  return NextResponse.json(out, { headers: { "Cache-Control": "private, max-age=600" } });
}
