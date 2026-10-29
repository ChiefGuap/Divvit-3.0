import { NextResponse } from "next/server";
import { loadYc, searchYc, suggestCompanies } from "@/lib/server/companies";
import { domainOf, readSite } from "@/lib/server/site-profile";
import { overLimit, tooMany } from "@/lib/server/rate-limit";

/* "Is this you?" — company matches while a startup types its name.
   YC directory first (richest data), then any company on the web by name or
   domain. Picking one calls /api/lookup/profile for the full autofill.
   GET /api/lookup?q=<name or website> */

export const runtime = "nodejs";

export type Match = {
  key: string; name: string; domain: string; logo: string; line: string; source: "yc" | "web"; yc?: string;
};

const favicon = (domain: string) => `https://www.google.com/s2/favicons?domain=${domain}&sz=128`;

export async function GET(req: Request) {
  if (overLimit(req, "lookup", 90)) return tooMany();
  const q = (new URL(req.url).searchParams.get("q") || "").trim().slice(0, 200);
  if (q.length < 2) return NextResponse.json({ matches: [] });

  const looksLikeSite = /^[^\s]+\.[a-z]{2,}(\/\S*)?$/i.test(q) && !/linkedin\.com/i.test(q);
  const [all, web, site] = await Promise.all([
    loadYc(),
    looksLikeSite ? Promise.resolve([]) : suggestCompanies(q),
    looksLikeSite ? readSite(q) : Promise.resolve(null),
  ]);

  const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, "");
  const nq = norm(looksLikeSite ? domainOf(q).split(".")[0] : q);
  const similar = (a: string, b: string) => { const x = norm(a), y = norm(b); return !!x && !!y && (x.includes(y) || y.includes(x)); };

  const matches: Match[] = [];
  const seen = new Set<string>();
  const add = (m: Match) => {
    if (matches.length >= 5 || (m.domain && seen.has(m.domain))) return;
    if (m.domain) seen.add(m.domain);
    matches.push(m);
  };
  // a pasted website is the strongest signal: lead with the site itself
  if (looksLikeSite) {
    const d = site?.domain || domainOf(q);
    add({ key: `web:${d}`, name: site?.name || d, domain: d, logo: site?.logo || favicon(d), line: d, source: "web" });
  }
  for (const c of searchYc(all, q, 3)) {
    // a YC company that once used this domain but has another name (acquired, renamed) isn't a match
    if (looksLikeSite && c.domain === matches[0]?.domain && !similar(c.name, site?.name || nq)) continue;
    if (looksLikeSite && c.domain === matches[0]?.domain) { matches[0] = { ...matches[0], key: `yc:${c.slug}`, name: c.name, line: c.oneLiner || c.industry, source: "yc", yc: c.slug, logo: c.logo || matches[0].logo }; continue; }
    add({ key: `yc:${c.slug}`, name: c.name, domain: c.domain, logo: c.logo || (c.domain ? favicon(c.domain) : ""), line: c.oneLiner || c.industry, source: "yc", yc: c.slug });
  }
  // everyone else, exact names first; drop obvious noise
  const ranked = web.filter((c) => /^[\p{L}\p{N}]/u.test(c.name))
    .map((c, k) => ({ c, score: (norm(c.name) === nq ? 100 : norm(c.name).startsWith(nq) ? 10 : 0) - k }))
    .sort((a, b) => b.score - a.score);
  const exact = matches.some((m) => norm(m.name) === nq) || ranked[0]?.score >= 90;
  for (const { c } of ranked) {
    if (matches.length >= (exact ? 3 : 4)) break;
    add({ key: `web:${c.domain}`, name: c.name, domain: c.domain, logo: favicon(c.domain), line: c.domain, source: "web" });
  }
  // exact name matches lead
  matches.sort((a, b) => Number(norm(b.name) === nq) - Number(norm(a.name) === nq));

  return NextResponse.json({ matches }, { headers: { "Cache-Control": "private, max-age=300" } });
}
