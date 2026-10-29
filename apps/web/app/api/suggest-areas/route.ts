import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { cafeAccepts } from "@/lib/marketplace/categories";
import { hoodId, matchAreas, PROFILES, TAGS, type Hood, type Suggestion } from "@/lib/marketplace/audiences";

/* Where should this startup run its campaign? Ranks the neighborhoods that
   have cafés open to the startup's category, from its description.
     ANTHROPIC_API_KEY set → Claude picks from the neighborhood profiles and
                             explains each pick for this startup
     otherwise / on error  → the built-in matcher (lib/marketplace/audiences)
   ANTHROPIC_WORKSPACE_ID (wrkspc_…) is needed when the key isn't scoped to a
   workspace (personal and org-level keys); it's sent on every request.
   POST /api/suggest-areas { description? }  (signed-in startup) */

export const runtime = "nodejs";

const MODEL = "claude-opus-5-5";
const SYSTEM = `You help startups decide where to run coffee-sleeve ad campaigns: their brand is printed on the cups local cafés serve.
Given a startup and the neighborhoods that have Divvit cafés (with who drinks coffee there), pick the 3 to 5 neighborhoods where the startup's likely customers or users buy coffee, best first.
Spread picks across cities unless the startup is clearly about one place.
For each pick: audience is who it reaches, 2 to 5 words. reason is why it fits this startup specifically, under 15 words, plain language, no hype.`;

// same startup + description → same AI picks for an hour (no repeat model calls); matcher
// answers aren't cached, so a passing Claude outage doesn't stick for the hour
const cache = new Map<string, { at: number; source: string; suggestions: Suggestion[] }>();

// a key or billing problem (no credit, bad key, no workspace access) won't clear up in seconds:
// skip Claude for a while rather than make every page load wait on a failing call
let claudeOffUntil = 0;

async function askClaude(startup: { name: string; description: string; category: string; hq: string | null }, hoods: Hood[]) {
  if (!process.env.ANTHROPIC_API_KEY || Date.now() < claudeOffUntil) return null;
  const listed = hoods.filter((h) => PROFILES[hoodId(h.city, h.neighborhood)]);
  const ids = listed.map((h) => hoodId(h.city, h.neighborhood));
  const lines = listed.map((h) => {
    const p = PROFILES[hoodId(h.city, h.neighborhood)];
    return `${hoodId(h.city, h.neighborhood)} — ${h.cafes} cafés — ${p.tags.map((t) => TAGS[t]).join(", ")} — ${p.blurb}`;
  });
  try {
    const workspace = process.env.ANTHROPIC_WORKSPACE_ID;
    // the home page waits on this, so give up early and let the matcher answer
    const client = new Anthropic({ timeout: 25_000, maxRetries: 1, ...(workspace ? { defaultHeaders: { "anthropic-workspace-id": workspace } } : {}) });
    const res = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 4000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SYSTEM,
      output_config: {
        effort: "low",
        format: {
          type: "json_schema",
          schema: {
            type: "object", additionalProperties: false, required: ["suggestions"],
            properties: {
              suggestions: {
                type: "array",
                items: {
                  type: "object", additionalProperties: false, required: ["id", "audience", "reason"],
                  properties: { id: { type: "string", enum: ids }, audience: { type: "string" }, reason: { type: "string" } },
                },
              },
            },
          },
        },
      },
      messages: [{
        role: "user",
        content: `Startup: ${startup.name}\nWhat it does: ${startup.description || "(no description)"}\nCategory: ${startup.category}\nBased in: ${startup.hq || "unknown"}\n\nNeighborhoods with Divvit cafés (id — cafés — who goes there — notes):\n${lines.join("\n")}`,
      }],
    });
    if (res.stop_reason === "refusal") return null;
    const text = res.content.find((b) => b.type === "text");
    if (!text || text.type !== "text") return null;
    const parsed = JSON.parse(text.text) as { suggestions: { id: string; audience: string; reason: string }[] };
    const byId = new Map(listed.map((h) => [hoodId(h.city, h.neighborhood), h]));
    const seen = new Set<string>();
    const out: Suggestion[] = [];
    for (const s of parsed.suggestions) {
      const h = byId.get(s.id);
      if (!h || seen.has(s.id)) continue;
      seen.add(s.id);
      out.push({ id: s.id, city: h.city, neighborhood: h.neighborhood, cafes: h.cafes, audience: s.audience.slice(0, 60), reason: s.reason.slice(0, 140) });
      if (out.length === 5) break;
    }
    return out.length ? out : null;
  } catch (e) {
    // any failure (no credit, rate limit, network, bad JSON) falls back to the matcher
    if (e instanceof Anthropic.APIError && [400, 401, 403, 404].includes(e.status ?? 0)) claudeOffUntil = Date.now() + 10 * 60_000;
    console.error("[suggest-areas] Claude unavailable:", e instanceof Anthropic.APIError ? e.message : e);
    return null;
  }
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { description?: string };
  const { data: s } = await supabase.from("mp_startups").select("name, description, category, hq").eq("owner_id", user.id).order("created_at").limit(1).maybeSingle();
  if (!s) return NextResponse.json({ error: "No startup profile" }, { status: 404 });
  const startup = { name: s.name as string, category: (s.category as string) || "tech", hq: s.hq as string | null,
    description: (body.description ?? (s.description as string | null) ?? "").trim().slice(0, 600) };

  // neighborhoods with cafés that take this startup's category (RLS: verified + sample cafés)
  const { data: rows } = await supabase.from("mp_cafes").select("city, neighborhood, accepted_categories, blocked_categories").gt("sleeves_per_month", 0);
  const counts = new Map<string, Hood>();
  for (const c of rows ?? []) {
    if (!c.neighborhood || !cafeAccepts(c as { accepted_categories: string[]; blocked_categories: string[] }, startup.category)) continue;
    const id = hoodId(c.city, c.neighborhood);
    counts.set(id, { city: c.city, neighborhood: c.neighborhood, cafes: (counts.get(id)?.cafes ?? 0) + 1 });
  }
  const hoods = [...counts.values()];

  const key = `${user.id}|${startup.category}|${startup.description}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 3600_000) return NextResponse.json({ source: hit.source, suggestions: hit.suggestions });

  const ai = await askClaude(startup, hoods);
  const result = ai ? { source: "ai", suggestions: ai } : { source: "match", suggestions: matchAreas(startup, hoods) };
  if (ai) cache.set(key, { at: Date.now(), ...result });
  return NextResponse.json(result);
}
