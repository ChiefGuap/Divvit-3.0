import { safeFetch } from "@/lib/server/safe-fetch";

/* Same-origin image proxy for logos found by autofill. Drawing a cross-origin
   image onto the sleeve canvas would taint it (no WebGL upload, no export),
   so the designer loads remote logos through here. Images only, ≤ 2MB. */

export const runtime = "nodejs";

export async function GET(req: Request) {
  const src = new URL(req.url).searchParams.get("url") || "";
  if (!src) return new Response("missing url", { status: 400 });
  try {
    const got = await safeFetch(src, { headers: { Accept: "image/*", "User-Agent": "DivvitBot/1.0 (+https://divvit.app)" } });
    if (!got || !got.res.ok) return new Response("not found", { status: 404 });
    const type = got.res.headers.get("content-type") || "";
    if (!/^image\/(png|jpe?g|gif|webp|x-icon|vnd\.microsoft\.icon|svg\+xml)/i.test(type)) return new Response("not an image", { status: 415 });
    const buf = await got.res.arrayBuffer();
    if (buf.byteLength > 2_000_000) return new Response("too large", { status: 413 });
    return new Response(buf, {
      headers: {
        "Content-Type": type,
        "Cache-Control": "public, max-age=86400",
        // never let a proxied SVG run script
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("fetch failed", { status: 502 });
  }
}
