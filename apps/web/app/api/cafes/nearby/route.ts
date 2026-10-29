import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { serverDb } from "@/lib/server/db";
import { fetchPlaces, NEARBY_RADIUS_M, pickNearby } from "@/lib/server/nearby";

/* Looks up the places near cafés that don't have them yet — new cafés, or ones
   that moved — a few per call, since each is an OpenStreetMap (Overpass) query.
   The café onboarding and the startup home call it; signed-in users only.
   POST → { filled, checked } */

export const runtime = "nodejs";
export const maxDuration = 60;

type Todo = { id: string; name: string; lat: number; lng: number };

export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  try {
    const { db, secret } = serverDb();
    const { data, error } = await db.rpc("mp_cafes_missing_nearby", { p_secret: secret, p_limit: 3 });
    if (error) throw new Error(error.message);
    let filled = 0;
    for (const c of (data as Todo[]) ?? []) {
      const places = pickNearby(await fetchPlaces(`(around:${NEARBY_RADIUS_M},${c.lat},${c.lng})`), c.lat, c.lng, c.name);
      const { error: e } = await db.rpc("mp_set_cafe_nearby", { p_secret: secret, p_cafe: c.id, p_nearby: places });
      if (!e) filled++;
    }
    return NextResponse.json({ filled, checked: (data as Todo[] | null)?.length ?? 0 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
