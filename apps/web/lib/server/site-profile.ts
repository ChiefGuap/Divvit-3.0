/* Read a business's own website for autofill: meta tags, schema.org JSON-LD
   (Organization / LocalBusiness / CafeOrCoffeeShop) and the social links in
   its header and footer — which is where most companies link their LinkedIn
   page. One polite GET of the homepage, through safeFetch. */

import { safeFetch, safeUrl } from "./safe-fetch";

export type Links = Partial<Record<"linkedin" | "x" | "instagram" | "github" | "crunchbase" | "facebook", string>>;

export type SiteProfile = {
  website: string; domain: string; name: string; description: string; image: string; logo: string;
  links: Links; foundedYear: number | null; teamSize: number | null;
  address: { street: string; city: string; region: string; postcode: string } | null;
  openingHours: string; phone: string;
};

const UA = "Mozilla/5.0 (compatible; DivvitBot/1.0; +https://divvit.app)";

export const decode = (s: string) =>
  s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&#x27;/g, "'").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

export const domainOf = (u: string) => {
  try { return new URL(/^https?:\/\//i.test(u) ? u : `https://${u}`).hostname.replace(/^www\./, "").toLowerCase(); }
  catch { return ""; }
};

/** Canonical public profile URL for a link found on a page, or null if it isn't one. */
export function socialLink(href: string): [keyof Links, string] | null {
  let u: URL;
  try { u = new URL(href); } catch { return null; }
  const host = u.hostname.replace(/^(www|[a-z]{2})\./, "").toLowerCase();
  const seg = u.pathname.split("/").filter(Boolean);
  const clean = (s: string) => s.replace(/[^A-Za-z0-9_.%-]/g, "");
  if (host === "linkedin.com" && ["company", "school", "showcase"].includes(seg[0]) && seg[1])
    return ["linkedin", `https://www.linkedin.com/${seg[0]}/${clean(seg[1])}/`];
  if ((host === "x.com" || host === "twitter.com") && seg[0] && !["share", "intent", "home", "hashtag", "search", "i"].includes(seg[0]))
    return ["x", `https://x.com/${clean(seg[0])}`];
  if (host === "instagram.com" && seg[0] && !["p", "reel", "reels", "explore", "stories", "accounts"].includes(seg[0]))
    return ["instagram", `https://www.instagram.com/${clean(seg[0])}/`];
  if (host === "github.com" && seg[0] && !["sponsors", "features", "about", "login"].includes(seg[0]))
    return ["github", `https://github.com/${clean(seg[0])}`];
  if (host === "crunchbase.com" && seg[0] === "organization" && seg[1])
    return ["crunchbase", `https://www.crunchbase.com/organization/${clean(seg[1])}`];
  if (host === "facebook.com" && seg[0] && !["sharer", "sharer.php", "share", "dialog", "plugins", "tr"].includes(seg[0]))
    return ["facebook", `https://www.facebook.com/${clean(seg[0])}`];
  return null;
}

/** The schema.org nodes on the page, flattened (handles @graph and arrays). */
function jsonLd(html: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const walk = (n: unknown) => {
        if (Array.isArray(n)) n.forEach(walk);
        else if (n && typeof n === "object") {
          const o = n as Record<string, unknown>;
          out.push(o);
          if (o["@graph"]) walk(o["@graph"]);
        }
      };
      walk(JSON.parse(m[1].trim()));
    } catch { /* malformed block */ }
  }
  return out;
}

const ORG_TYPES = /^(Organization|Corporation|LocalBusiness|CafeOrCoffeeShop|FoodEstablishment|Restaurant|Bakery|Store|OnlineBusiness|NGO|EducationalOrganization|SoftwareApplication)$/;
const typesOf = (o: Record<string, unknown>) => ([] as unknown[]).concat(o["@type"] ?? []).map(String);
const str = (v: unknown): string => (typeof v === "string" ? v : Array.isArray(v) ? str(v[0]) : v && typeof v === "object" ? str((v as Record<string, unknown>).url ?? (v as Record<string, unknown>).name ?? "") : "");

export async function readSite(raw: string): Promise<SiteProfile | null> {
  if (!(await safeUrl(raw))) return null;
  try {
    const got = await safeFetch(raw, { headers: { "User-Agent": UA, Accept: "text/html" }, timeoutMs: 6000 });
    if (!got) return null;
    const { res, url } = got;
    const type = res.headers.get("content-type") || "";
    const markdown = /text\/(markdown|plain)/.test(type);
    if (!res.ok || !(type.includes("html") || markdown)) return null;
    // the footer links matter, so read the page — capped at ~800KB
    const reader = res.body!.getReader();
    let html = "", bytes = 0;
    const dec = new TextDecoder();
    while (bytes < 800_000) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
      html += dec.decode(value, { stream: true });
    }
    reader.cancel().catch(() => {});

    // some sites answer bots with a Markdown version: take its name and profile links only
    if (markdown) {
      const links: Links = {};
      for (const m of html.matchAll(/https?:\/\/[^\s)<>"']+/g)) { const l = socialLink(m[0]); if (l && !links[l[0]]) links[l[0]] = l[1]; }
      const h1 = html.match(/^#\s+(.+)$/m)?.[1] ?? "";
      return {
        website: `${url.protocol}//${url.hostname}`, domain: url.hostname.replace(/^www\./, ""),
        name: h1.split(/\s[|–—·-]\s/)[0].trim().slice(0, 80), description: "", image: "",
        logo: `https://www.google.com/s2/favicons?domain=${url.hostname}&sz=128`, links,
        foundedYear: null, teamSize: null, address: null, openingHours: "", phone: "",
      };
    }

    const head = html.slice(0, html.search(/<\/head>/i) + 1 || 200_000);
    const meta = (key: string) => {
      const tag = head.match(new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*>`, "i"))?.[0];
      return tag ? decode(tag.match(/content=["']([^"']*)["']/i)?.[1] ?? "") : "";
    };
    const abs = (h: string) => { try { return new URL(h, url).toString(); } catch { return ""; } };
    const title = decode(head.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? "");

    // schema.org: the organisation/business node, if the site has one
    const nodes = jsonLd(html);
    const org = nodes.find((n) => typesOf(n).some((t) => ORG_TYPES.test(t)) && !typesOf(n).includes("SoftwareApplication"))
      ?? nodes.find((n) => typesOf(n).some((t) => ORG_TYPES.test(t)));

    const links: Links = {};
    const addLink = (h: string) => {
      const s = socialLink(h);
      if (s && !links[s[0]]) links[s[0]] = s[1];
    };
    if (org) ([] as unknown[]).concat(org.sameAs ?? []).forEach((h) => typeof h === "string" && addLink(h));
    for (const m of html.matchAll(/<a\b[^>]*\bhref=["']([^"'#]+)["']/gi)) addLink(decode(m[1]));

    const year = (v: unknown) => { const y = Number(String(str(v)).match(/\b(18|19|20)\d\d\b/)?.[0]); return y || null; };
    const employees = (v: unknown): number | null => {
      if (typeof v === "number") return v;
      if (v && typeof v === "object") {
        const o = v as Record<string, unknown>;
        const n = Number(o.value ?? o.maxValue ?? o.minValue);
        return Number.isFinite(n) && n > 0 ? n : null;
      }
      const n = Number(String(v ?? "").replace(/[^\d]/g, ""));
      return n > 0 ? n : null;
    };
    const addr = org?.address && typeof org.address === "object" ? ([] as unknown[]).concat(org.address)[0] as Record<string, unknown> : null;
    const hours = org ? ([] as unknown[]).concat(org.openingHours ?? []).filter((h) => typeof h === "string").join("; ") : "";

    // square icons read better as an avatar than a wide wordmark: apple-touch-icon, then the schema.org logo, then the favicon
    const hrefOf = (tag?: string) => tag?.match(/href=["']([^"']+)["']/i)?.[1] ?? "";
    const touch = hrefOf(head.match(/<link[^>]+rel=["'][^"']*apple-touch-icon[^"']*["'][^>]*>/i)?.[0]);
    const icon = hrefOf(head.match(/<link[^>]+rel=["'](?:shortcut )?icon["'][^>]*>/i)?.[0]);
    const orgLogo = org ? str(org.logo) : "";

    const siteName = meta("og:site_name") || (org ? str(org.name) : "") || title.split(/\s[|–—·-]\s/)[0].trim();
    return {
      website: `${url.protocol}//${url.hostname}`,
      domain: url.hostname.replace(/^www\./, ""),
      name: decode(siteName).slice(0, 80),
      description: decode(meta("og:description") || meta("description") || (org ? str(org.description) : "")).slice(0, 600),
      image: meta("og:image") ? abs(meta("og:image")) : "",
      logo: (touch && abs(touch)) || (orgLogo && abs(orgLogo)) || (icon && !/\.ico(\?|$)/i.test(icon) && abs(icon)) || `https://www.google.com/s2/favicons?domain=${url.hostname}&sz=128`,
      links,
      foundedYear: org ? year(org.foundingDate) : null,
      teamSize: org ? employees(org.numberOfEmployees) : null,
      address: addr ? {
        street: decode(str(addr.streetAddress)), city: decode(str(addr.addressLocality)),
        region: decode(str(addr.addressRegion)), postcode: decode(str(addr.postalCode)),
      } : null,
      openingHours: hours.slice(0, 300),
      phone: org ? decode(str(org.telephone)).slice(0, 40) : "",
    };
  } catch {
    return null;
  }
}
