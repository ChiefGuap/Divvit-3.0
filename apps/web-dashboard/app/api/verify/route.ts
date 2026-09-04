/**
 * Thin proxy to the engine service.
 *
 * This route used to spawn a Python subprocess, which only worked because the
 * dashboard and the engine share a machine. The app cannot do that, so the
 * engine now lives behind an HTTP contract and BOTH front ends are clients of
 * it — same endpoint, same JSON, same verdicts, one implementation.
 *
 * What stays here is the dashboard's own concern: turning a browser session
 * into a bearer token. The browser never sees the engine token, and identity
 * still comes from the token rather than the request body.
 */
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 120;

const ENGINE = process.env.DIVVIT_ENGINE_URL ?? "http://127.0.0.1:8787";
// Stands in for the signed-in creator's session until real auth exists. The
// dashboard is a trusted server-side caller; the browser never holds this.
const ENGINE_TOKEN = process.env.DIVVIT_ENGINE_TOKEN ?? "devtok";

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "expected a JSON body" }, { status: 400 });
  }

  const payload = {
    url: String(body.url ?? "").trim(),
    handle: String(body.handle ?? "").trim().replace(/^@/, ""),
    tier: Number(body.tier ?? 1),
    submission_id: body.submission_id ?? null,
  };

  if (!payload.url) return NextResponse.json({ error: "paste a link first" }, { status: 400 });
  if (!payload.handle)
    return NextResponse.json({ error: "a handle is required — ownership is "
                                     + "checked against the post's author" },
                             { status: 400 });

  try {
    const res = await fetch(`${ENGINE}/v1/claims`, {
      method: "POST",
      headers: { "content-type": "application/json",
                 authorization: `Bearer ${ENGINE_TOKEN}` },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(115_000),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      return NextResponse.json(
        { error: json?.detail ?? `engine returned ${res.status}` },
        { status: res.status },
      );
    }
    return NextResponse.json(json);
  } catch (err) {
    // A dead engine is an outage, not a rejected claim — the same rule the
    // gates follow. Never let this surface as "your claim failed".
    return NextResponse.json(
      { error: "the verification engine is unreachable",
        detail: err instanceof Error ? err.message : String(err),
        hint: "start it with: .venv/bin/uvicorn services.api.app:app --port 8787" },
      { status: 503 },
    );
  }
}
