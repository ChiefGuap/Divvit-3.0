/**
 * Claim verification — the five gates, driven from the browser.
 *
 * Same subprocess boundary as /api/intake and for the same reason: the gates
 * are Python (fingerprint comparison, ffmpeg, the snowflake decode), and a
 * second implementation in Node would be two copies of a fraud check drifting
 * apart. The CLI prints JSON on stdout, so it is a clean seam.
 *
 * Spawned with an argument array and no shell — a pasted URL is attacker
 * controlled by definition, and it goes straight into argv, never a command
 * line.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 120;

const REPO_ROOT = path.resolve(process.cwd(), "..", "..");
const PYTHON = path.join(REPO_ROOT, ".venv", "bin", "python");

const TIERS = new Set([1, 2, 3, 4]);
// A pasted link is untrusted input. Length-cap it before it reaches argv.
const MAX_URL = 2048;

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "expected a JSON body" }, { status: 400 });
  }

  const url = String(body.url ?? "").trim();
  const submitter = String(body.submitter ?? "").trim();
  const handle = String(body.handle ?? "").trim().replace(/^@/, "");
  const tier = Number(body.tier ?? 1);
  // `connected` is deliberately NOT read from the body. Ownership proof is
  // looked up server-side from the linked-accounts store; a request that could
  // assert it would be able to upgrade its own ownership gate from a soft pass
  // to a hard pass, defeating the tier rule that holds expensive rewards.

  if (!url) return NextResponse.json({ error: "paste a link first" }, { status: 400 });
  if (url.length > MAX_URL)
    return NextResponse.json({ error: "that link is too long" }, { status: 400 });
  if (!submitter || !handle)
    return NextResponse.json(
      { error: "submitter and handle are both required — ownership is checked "
             + "against the handle on file" },
      { status: 400 },
    );
  if (!TIERS.has(tier))
    return NextResponse.json({ error: "tier must be 1-4" }, { status: 400 });

  const args = [
    "-m", "services.verify.cli", "claim", url,
    "--submitter", submitter,
    "--handle", handle,
    "--tier", String(tier),
  ];

  try {
    const { payload, stderr, code } = await run(args);
    if (payload) return NextResponse.json(payload);
    return NextResponse.json(
      { error: "verification did not return a result",
        detail: stderr.slice(-1200), code },
      { status: 502 },
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "verification failed" },
      { status: 500 },
    );
  }
}

function run(args: string[]): Promise<{
  payload: Record<string, unknown> | null; stderr: string; code: number | null;
}> {
  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON, args, { cwd: REPO_ROOT, shell: false,
                                        env: { ...process.env, PYTHONUNBUFFERED: "1" } });
    let out = "", err = "";
    child.stdout.on("data", (d) => { out += d.toString(); });
    child.stderr.on("data", (d) => { err += d.toString(); });
    const timer = setTimeout(() => { child.kill("SIGKILL");
                                     reject(new Error("verification timed out")); }, 110_000);
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", (code) => {
      clearTimeout(timer);
      // A rejected claim exits 1 but still carries a full result, so parse
      // before judging on the exit code.
      let payload: Record<string, unknown> | null = null;
      try { payload = JSON.parse(out.trim()); } catch { payload = null; }
      resolve({ payload, stderr: err, code });
    });
  });
}
