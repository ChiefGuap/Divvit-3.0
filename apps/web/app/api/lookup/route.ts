import { NextResponse } from "next/server";
import { safeFetch, safeUrl } from "@/lib/server/safe-fetch";

/* Startup autofill.
   Sources, in order of what they're good for:
     1. Y Combinator directory (yc-oss, public, keyless, ~6k companies): name,
        one-liner, description, HQ, batch, industry, logo.
     2. The startup's own website: title, description, icon — works for anyone
        with a site.
     3. People Data Labs company enrichment, only if PDL_API_KEY is set:
        funding raised, latest round, HQ, industry. (Free tier available.)
   GET /api/lookup?q=<name or website> */

export const runtime = "nodejs";

type YcCompany = {
  name: string; slug: string; website: string; all_locations: string; one_liner: string; long_description: string;
  small_logo_thumb_url: string; batch: string; industry: string; subindustry: string; tags: string[]; team_size: number | null;
  status: string; stage: string;
};
type Slim = { name: string; domain: string; website: string; hq: string; oneLiner: string; description: string; logo: string;
  batch: string; industry: string; tags: string[]; teamSize: number | null; status: string; url: string };

let ycIndex: Promise<Slim[]> | null = null;
let ycLoadedAt = 0;

const domainOf = (u: string) => {
  try { return new URL(/^https?:\/\//i.test(u) ? u : `https://${u}`).hostname.replace(/^www\./, "").toLowerCase(); }
  catch { return ""; }
};

function loadYc() {
  if (!ycIndex || Date.now() - ycLoadedAt > 24 * 3600 * 1000) {
    ycLoadedAt = Date.now();
    ycIndex = fetch("https://yc-oss.github.io/api/companies/all.json", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((all: YcCompany[]) => all.map((c) => ({
        name: c.name, domain: domainOf(c.website || ""), website: c.website || "", hq: c.all_locations || "",
        oneLiner: c.one_liner || "", description: c.long_description || "", logo: c.small_logo_thumb_url || "",
        batch: c.batch || "", industry: c.subindustry || c.industry || "", tags: c.tags || [], teamSize: c.team_size ?? null,
        status: c.status || "", url: `https://www.ycombinator.com/companies/${c.slug}`,
      })))
      .catch(() => { ycIndex = null; return []; });
  }
  return ycIndex;
}

function searchYc(all: Slim[], q: string) {
  const s = q.toLowerCase().trim();
  const d = domainOf(q);
  const scored: [number, Slim][] = [];
  for (const c of all) {
    const n = c.name.toLowerCase();
    let score = 0;
    if (d && c.domain && c.domain === d) score = 100;
    else if (n === s) score = 90;
    else if (n.startsWith(s)) score = 70 - Math.min(20, n.length - s.length);
    else if (s.length >= 3 && n.includes(s)) score = 40;
    if (score) scored.push([score + (c.status === "Active" ? 3 : 0), c]);
  }
  return scored.sort((a, b) => b[0] - a[0]).slice(0, 6).map(([, c]) => c);
}

/* ---------- website metadata (user-supplied URL → fetched via safeFetch) ---------- */

const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();

async function websiteMeta(raw: string) {
  if (!(await safeUrl(raw))) return null;
  try {
    const got = await safeFetch(raw, { headers: { "User-Agent": "Mozilla/5.0 (compatible; DivvitBot/1.0; +https://divvit.app)", Accept: "text/html" } });
    if (!got) return null;
    const { res, url } = got;
    if (!res || !res.ok || !(res.headers.get("content-type") || "").includes("html")) return null;
    // read at most ~600KB
    const reader = res.body!.getReader();
    let html = "", bytes = 0;
    const dec = new TextDecoder();
    while (bytes < 600_000) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
      html += dec.decode(value, { stream: true });
      if (html.includes("</head>")) break;
    }
    reader.cancel().catch(() => {});
    const meta = (key: string) => {
      const re = new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*>`, "i");
      const tag = html.match(re)?.[0];
      return tag ? decode(tag.match(/content=["']([^"']*)["']/i)?.[1] ?? "") : "";
    };
    const title = decode(html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? "");
    const siteName = meta("og:site_name") || title.split(/[|–—·-]/)[0].trim();
    const icon = html.match(/<link[^>]+rel=["'][^"']*(?:apple-touch-icon|icon)[^"']*["'][^>]*>/i)?.[0]?.match(/href=["']([^"']+)["']/i)?.[1];
    return {
      website: `${url.protocol}//${url.hostname}`,
      domain: url.hostname.replace(/^www\./, ""),
      name: siteName.slice(0, 80),
      description: (meta("og:description") || meta("description")).slice(0, 600),
      image: meta("og:image") ? new URL(meta("og:image"), url).toString() : "",
      logo: icon ? new URL(icon, url).toString() : `https://www.google.com/s2/favicons?domain=${url.hostname}&sz=128`,
    };
  } catch {
    return null;
  }
}

async function pdlCompany(domain: string) {
  const key = process.env.PDL_API_KEY;
  if (!key || !domain) return null;
  try {
    const r = await fetch(`https://api.peopledatalabs.com/v5/company/enrich?website=${encodeURIComponent(domain)}`, {
      headers: { "X-Api-Key": key }, signal: AbortSignal.timeout(6000),
    });
    if (!r.ok) return null;
    const c = await r.json();
    const loc = c.location ? [c.location.locality, c.location.region].filter(Boolean).join(", ") : "";
    return {
      name: c.display_name || c.name || "",
      hq: loc,
      fundingTotal: typeof c.total_funding_raised === "number" ? c.total_funding_raised : null,
      fundingStage: c.latest_funding_stage || "",
      description: c.summary || "",
      industry: c.industry || "",
      founded: c.founded || null,
    };
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  const q = (new URL(req.url).searchParams.get("q") || "").trim().slice(0, 200);
  if (q.length < 2) return NextResponse.json({ matches: [], website: null, enrichment: null });

  const looksLikeSite = /\.[a-z]{2,}(\/|$)/i.test(q) && !/\s/.test(q);
  const all = await loadYc();
  const matches = searchYc(all, q);
  const domain = looksLikeSite ? domainOf(q) : "";
  const [website, enrichment] = looksLikeSite
    ? await Promise.all([websiteMeta(q), pdlCompany(domain)])
    : [null, null];

  return NextResponse.json(
    { matches, website, enrichment, pdlEnabled: Boolean(process.env.PDL_API_KEY) },
    { headers: { "Cache-Control": "private, max-age=300" } },
  );
}
