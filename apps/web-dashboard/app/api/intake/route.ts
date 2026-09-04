/**
 * Thin proxy to the engine's screening endpoint.
 *
 * Same reasoning as /api/verify: the engine is one HTTP service that the
 * dashboard and the app both call, rather than a subprocess only the
 * dashboard can spawn. The upload is streamed straight through so a 200MB
 * video is never buffered twice.
 */
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 300;

const ENGINE = process.env.DIVVIT_ENGINE_URL ?? "http://127.0.0.1:8787";
const ENGINE_TOKEN = process.env.DIVVIT_ENGINE_TOKEN ?? "devtok";

export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "expected multipart/form-data" }, { status: 400 });
  }

  const file = form.get("video");
  const venue = String(form.get("business") ?? form.get("venue") ?? "").trim();
  const location = String(form.get("location") ?? "").trim();

  if (!(file instanceof File))
    return NextResponse.json({ error: "no video attached" }, { status: 400 });
  if (!venue)
    return NextResponse.json(
      { error: "name the venue — a submission with no claimed venue cannot be "
             + "venue-verified" },
      { status: 400 },
    );

  const upstream = new FormData();
  upstream.append("video", file, file.name);
  upstream.append("venue", venue);
  upstream.append("location", location);

  try {
    const res = await fetch(`${ENGINE}/v1/screen`, {
      method: "POST",
      headers: { authorization: `Bearer ${ENGINE_TOKEN}` },
      body: upstream,
      signal: AbortSignal.timeout(290_000),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok)
      return NextResponse.json(
        { error: json?.detail ?? `engine returned ${res.status}` },
        { status: res.status });
    return NextResponse.json({ ...json, original_filename: file.name });
  } catch (err) {
    return NextResponse.json(
      { error: "the screening engine is unreachable",
        detail: err instanceof Error ? err.message : String(err),
        hint: "start it with: .venv/bin/uvicorn services.api.app:app --port 8787" },
      { status: 503 },
    );
  }
}
