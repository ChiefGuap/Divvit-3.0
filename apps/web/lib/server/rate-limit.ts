import { NextResponse } from "next/server";

/* A per-visitor limit for the public endpoints that cost money or bandwidth (company
   lookups that call People Data Labs, the image proxy, map searches). It counts in
   memory, so each server instance keeps its own tally: enough to stop one script
   hammering a route, not a substitute for a shared store. */

const hits = new Map<string, number[]>();

export function visitorOf(req: Request) {
  return (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "local";
}

/** true when this visitor has made more than `max` calls to `name` in the last `windowMs` */
export function overLimit(req: Request, name: string, max: number, windowMs = 60_000) {
  const now = Date.now(), key = `${name}|${visitorOf(req)}`;
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 10_000) for (const [k, v] of hits) if (now - v[v.length - 1] > windowMs) hits.delete(k);
  return recent.length > max;
}

export const tooMany = () =>
  NextResponse.json({ error: "Too many requests. Try again in a minute." }, { status: 429, headers: { "Retry-After": "60" } });
