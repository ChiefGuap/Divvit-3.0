/* Fetching URLs that users typed (their website, a logo) without letting them
   point the server at internal addresses: public hostnames only, DNS checked
   against private ranges, redirects followed by hand and re-checked each hop. */

import { lookup as dnsLookup } from "node:dns/promises";
import net from "node:net";

function isPrivateIp(ip: string) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80") || v.startsWith("::ffff:");
}

export async function safeUrl(raw: string): Promise<URL | null> {
  let u: URL;
  try { u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`); } catch { return null; }
  if (!["http:", "https:"].includes(u.protocol) || u.username || u.password) return null;
  if (u.port && !["80", "443"].includes(u.port)) return null;
  const host = u.hostname;
  if (!host.includes(".") || host.endsWith(".local") || host.endsWith(".internal") || net.isIP(host)) return null;
  try {
    const addrs = await dnsLookup(host, { all: true });
    if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) return null;
  } catch { return null; }
  return u;
}

export async function safeFetch(raw: string, init: RequestInit & { timeoutMs?: number } = {}) {
  let url = await safeUrl(raw);
  if (!url) return null;
  for (let hop = 0; hop < 4; hop++) {
    const res = await fetch(url, { ...init, redirect: "manual", signal: AbortSignal.timeout(init.timeoutMs ?? 6000) });
    const loc = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && loc) {
      const next = await safeUrl(new URL(loc, url).toString());
      if (!next) return null;
      url = next;
      continue;
    }
    return { res, url };
  }
  return null;
}
