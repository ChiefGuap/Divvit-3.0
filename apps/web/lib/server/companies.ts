/* Company sources for startup autofill.
     • Y Combinator directory (yc-oss, public, keyless, ~6k companies)
     • Clearbit company autocomplete (keyless): name → domain for anyone else
     • People Data Labs company enrichment, only when PDL_API_KEY is set: the
       licensed way to get LinkedIn-grade data (headcount, founding year,
       funding, HQ, LinkedIn page) by website, LinkedIn URL or name.
   LinkedIn itself is never fetched — its terms forbid scraping. */

import { domainOf } from "./site-profile";

type YcRaw = {
  name: string; slug: string; website: string; all_locations: string; one_liner: string; long_description: string;
  small_logo_thumb_url: string; batch: string; industry: string; subindustry: string; tags: string[]; team_size: number | null;
  status: string;
};
export type Yc = {
  slug: string; name: string; domain: string; website: string; hq: string; oneLiner: string; description: string; logo: string;
  batch: string; industry: string; tags: string[]; teamSize: number | null; status: string; url: string;
};

let ycIndex: Promise<Yc[]> | null = null;
let ycLoadedAt = 0;

export function loadYc() {
  if (!ycIndex || Date.now() - ycLoadedAt > 24 * 3600 * 1000) {
    ycLoadedAt = Date.now();
    ycIndex = fetch("https://yc-oss.github.io/api/companies/all.json", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((all: YcRaw[]) => all.map((c) => ({
        slug: c.slug, name: c.name, domain: domainOf(c.website || ""), website: c.website || "", hq: c.all_locations || "",
        oneLiner: c.one_liner || "", description: c.long_description || "", logo: c.small_logo_thumb_url || "",
        batch: c.batch || "", industry: c.subindustry || c.industry || "", tags: c.tags || [], teamSize: c.team_size ?? null,
        status: c.status || "", url: `https://www.ycombinator.com/companies/${c.slug}`,
      })))
      .catch(() => { ycIndex = null; return []; });
  }
  return ycIndex;
}

export function searchYc(all: Yc[], q: string, limit = 6) {
  const s = q.toLowerCase().trim();
  const d = /\.[a-z]{2,}/i.test(q) ? domainOf(q) : "";
  const scored: [number, Yc][] = [];
  for (const c of all) {
    const n = c.name.toLowerCase();
    let score = 0;
    if (d && c.domain && c.domain === d) score = 100;
    else if (n === s) score = 90;
    else if (n.startsWith(s)) score = 70 - Math.min(20, n.length - s.length);
    else if (s.length >= 3 && n.includes(s)) score = 40;
    if (score) scored.push([score + (c.status === "Active" ? 3 : 0), c]);
  }
  return scored.sort((a, b) => b[0] - a[0]).slice(0, limit).map(([, c]) => c);
}

/* ---------------------------------------------------------------- everyone else */

export type WebCompany = { name: string; domain: string };

export async function suggestCompanies(q: string): Promise<WebCompany[]> {
  try {
    const r = await fetch(`https://autocomplete.clearbit.com/v1/companies/suggest?query=${encodeURIComponent(q)}`, {
      signal: AbortSignal.timeout(2500), next: { revalidate: 86400 },
    });
    if (!r.ok) return [];
    const rows = (await r.json()) as { name?: string; domain?: string }[];
    return rows.filter((x) => x.name && x.domain && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(x.domain))
      .map((x) => ({ name: x.name!.slice(0, 80), domain: x.domain!.toLowerCase() }));
  } catch {
    return [];
  }
}

/* ---------------------------------------------------------------- People Data Labs */

export type Pdl = {
  name: string; hq: string; description: string; industry: string; tags: string[];
  teamSize: number | null; foundedYear: number | null; fundingTotal: number | null; fundingStage: string;
  linkedin: string; x: string; facebook: string; website: string;
};

export const pdlEnabled = () => Boolean(process.env.PDL_API_KEY);

const https = (u: unknown) => (typeof u === "string" && u ? (/^https?:\/\//.test(u) ? u.replace(/^http:/, "https:") : `https://www.${u.replace(/^www\./, "")}`) : "");

// People Data Labs charges per lookup: the same company asked again within a day is answered from here
const pdlCache = new Map<string, { at: number; value: Pdl | null }>();

/** Enrich by the most specific key we have: website, then LinkedIn page, then name. */
export async function pdlCompany(by: { website?: string; linkedin?: string; name?: string }): Promise<Pdl | null> {
  const key = process.env.PDL_API_KEY;
  if (!key) return null;
  const params = new URLSearchParams({ min_likelihood: "4" });
  if (by.website) params.set("website", domainOf(by.website));
  else if (by.linkedin) params.set("profile", by.linkedin);
  else if (by.name) params.set("name", by.name);
  else return null;
  const cached = pdlCache.get(params.toString());
  if (cached && Date.now() - cached.at < 86_400_000) return cached.value;
  const value = await pdlFetch(params, key);
  if (pdlCache.size > 2000) pdlCache.clear();
  pdlCache.set(params.toString(), { at: Date.now(), value });
  return value;
}

async function pdlFetch(params: URLSearchParams, key: string): Promise<Pdl | null> {
  try {
    const r = await fetch(`https://api.peopledatalabs.com/v5/company/enrich?${params}`, {
      headers: { "X-Api-Key": key }, signal: AbortSignal.timeout(6000),
    });
    if (!r.ok) return null;
    const c = await r.json();
    const loc = c.location ? [c.location.locality, c.location.region].filter(Boolean).join(", ") : "";
    const titled = (s: string) => s.replace(/\b\w/g, (m) => m.toUpperCase());
    return {
      name: c.display_name || c.name || "",
      hq: titled(loc),
      description: c.headline || c.summary || "",
      industry: c.industry || "",
      tags: Array.isArray(c.tags) ? c.tags : [],
      teamSize: typeof c.employee_count === "number" ? c.employee_count : null,
      foundedYear: typeof c.founded === "number" ? c.founded : null,
      fundingTotal: typeof c.total_funding_raised === "number" ? c.total_funding_raised : null,
      fundingStage: c.latest_funding_stage || "",
      linkedin: https(c.linkedin_url),
      x: https(c.twitter_url).replace("www.twitter.com", "x.com").replace("twitter.com", "x.com"),
      facebook: https(c.facebook_url),
      website: c.website ? https(c.website) : "",
    };
  } catch {
    return null;
  }
}

/** PDL's latest_funding_stage → the stages we ask about. */
export function stageFromPdl(s: string): string {
  if (!s) return "";
  if (s === "pre_seed") return "Pre-seed";
  if (s === "seed" || s === "angel") return "Seed";
  if (s === "series_a") return "Series A";
  if (/^series_[b-z]/.test(s) || ["private_equity", "venture_round_late", "ipo", "post_ipo_equity"].includes(s)) return "Series B+";
  return "";
}

export const money = (n: number) =>
  n >= 1e9 ? `$${(n / 1e9).toFixed(n >= 1e10 ? 0 : 1)}B` : n >= 1e6 ? `$${Math.round(n / 1e6)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}K` : `$${n}`;
