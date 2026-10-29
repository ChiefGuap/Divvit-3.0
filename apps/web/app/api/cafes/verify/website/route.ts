import { createHmac } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeFetch } from "@/lib/server/safe-fetch";
import { isNewOnMap, osmPlace, publicContact } from "@/lib/server/osm";
import { domainOf } from "@/lib/server/site-profile";

/* "Add a code to your website" check. The website is the one on the café's
   public map listing — not anything typed at sign-up — so only someone who
   controls the real café's site can pass. When the code is there, this server
   signs (café id : code) with DIVVIT_VERIFY_SECRET and the database, which
   holds the same secret, checks the signature before marking the café verified.
   POST /api/cafes/verify/website (signed-in café) */

export const runtime = "nodejs";

const say = (message: string, status = 200, extra: Record<string, unknown> = {}) =>
  NextResponse.json({ ok: false, message, ...extra }, { status });

async function pageText(url: string) {
  const got = await safeFetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; DivvitBot/1.0; +https://divvit.app)", Accept: "text/html,text/*;q=0.8" },
    timeoutMs: 8000,
  });
  if (!got || !got.res.ok || !/^text\//.test(got.res.headers.get("content-type") || "")) return null;
  const reader = got.res.body!.getReader();
  const dec = new TextDecoder();
  let text = "", bytes = 0;
  while (bytes < 1_500_000) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.length;
    text += dec.decode(value, { stream: true });
  }
  reader.cancel().catch(() => {});
  return text;
}

export async function POST() {
  const secret = process.env.DIVVIT_VERIFY_SECRET;
  if (!secret) return say("Website checks aren't switched on yet — choose another way for now.", 503);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return say("Sign in first.", 401);

  const [{ data: cafeId }, { data: v }] = await Promise.all([supabase.rpc("mp_my_cafe_id"), supabase.rpc("mp_my_verification")]);
  const ver = v as { method?: string; website_code?: string; osm_ref?: string; status?: string } | null;
  if (!cafeId || !ver) return say("List your café first.", 400);
  if (ver.status === "verified") return NextResponse.json({ ok: true });
  if (ver.method !== "website" || !ver.website_code) return say("Choose “Add a code to your website” first.", 400);
  if (!ver.osm_ref) return say("We can only check the website on your café's public listing. Choose another way.", 400);

  const place = await osmPlace(ver.osm_ref);
  if (!place) return say("We couldn't reach your café's map listing. Try again in a minute.", 502);
  if (isNewOnMap(place)) {
    return say("Your café was only just added to the map, so we'll check this one by hand. Choose “Have Divvit check it”.", 409, { review: true });
  }
  const { website } = publicContact(place);
  if (!website) return say("Your café's public listing doesn't have a website. Choose another way.", 400);

  const domain = domainOf(website);
  const text = await pageText(website);
  if (text === null) return say(`We couldn't open ${domain}. Make sure the site is live, then try again.`, 502);
  if (!text.toLowerCase().includes(ver.website_code.toLowerCase())) {
    return say(`We couldn't find ${ver.website_code} on ${domain} yet. Publish the change, wait a minute, then check again.`);
  }

  const signature = createHmac("sha256", secret).update(`${cafeId}:${ver.website_code}`).digest("hex");
  const { error } = await supabase.rpc("mp_confirm_website", { p_signature: signature });
  if (error) return say(error.message, 400);
  return NextResponse.json({ ok: true });
}
