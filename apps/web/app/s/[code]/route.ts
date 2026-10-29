import { createHmac } from "node:crypto";
import { NextResponse } from "next/server";
import { serverDb } from "@/lib/server/db";
import { overLimit } from "@/lib/server/rate-limit";
import { site } from "@/lib/urls";

/* The link in a sleeve's QR code: divvit.app/s/<code>. Counts the scan for the
   campaign report (mp_record_scan), then sends the scanner on to the startup's
   website, tagged for their analytics. Unknown codes go to divvit.app.
   No IP address is stored: people are told apart by a keyed hash of the connection.
   Link-preview bots and HEAD requests are forwarded without being counted. */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BOT = /bot|crawl|spider|slurp|preview|facebookexternalhit|embedly|whatsapp|telegram|slack|discord|curl|wget|python|node-fetch|headless/i;

async function forward(req: Request, code: string, count: boolean) {
  const home = NextResponse.redirect(site("/"), 302);
  if (!/^[a-z0-9]{8}$/i.test(code)) return home;
  const ua = req.headers.get("user-agent") ?? "";
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "";
  let dest: string | null = null;
  try {
    const { db, secret } = serverDb();
    const visitor = createHmac("sha256", secret).update(`${code.toLowerCase()}|${ip}|${ua}`).digest("hex").slice(0, 32);
    const { data, error } = await db.rpc("mp_record_scan", { p_secret: secret, p_code: code, p_visitor: visitor, p_count: count && !BOT.test(ua) && !overLimit(req, "scan", 20) });
    if (!error) dest = data as string | null;
  } catch { /* still send them somewhere useful */ }
  if (!dest) return home;
  let url: URL;
  try { url = new URL(/^https?:\/\//i.test(dest) ? dest : `https://${dest}`); } catch { return home; }
  url.searchParams.set("utm_source", "divvit");
  url.searchParams.set("utm_medium", "coffee_sleeve");
  url.searchParams.set("utm_campaign", code.toLowerCase());
  const res = NextResponse.redirect(url.toString(), 302);
  res.headers.set("Cache-Control", "no-store");
  return res;
}

export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  return forward(req, (await params).code, true);
}

export async function HEAD(req: Request, { params }: { params: Promise<{ code: string }> }) {
  return forward(req, (await params).code, false);
}
