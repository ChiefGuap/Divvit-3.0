/**
 * Submission intake — the write path the Collection screen was missing.
 *
 * Takes an uploaded video plus the venue the submitter claims it is about, and
 * runs it through `services.intake`: perceptual dedupe, a theft check against
 * the harvested corpus, then venue verification via TwelveLabs. Returns every
 * gate's result, not just the verdict, because "rejected" is useless to a
 * person without the reason.
 *
 * Why a subprocess: the gates are Python (ffmpeg frame extraction, numpy
 * dHash, the TwelveLabs client) and reimplementing them in Node would mean two
 * implementations of a security check drifting apart. The CLI already prints
 * JSON on stdout and progress on stderr, so it is a clean boundary.
 *
 * The child is spawned with an argument array and **no shell**, so nothing the
 * submitter types can be interpreted as a command. The upload is written to a
 * random path under the OS temp dir and deleted in a `finally`, whatever
 * happens — an unreviewed video should not linger on disk.
 */
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 300;

// TwelveLabs rejects video under 4s, and indexing anything huge from a browser
// upload is not a thing we want to discover at render time.
const MAX_BYTES = 200 * 1024 * 1024;
const ALLOWED = new Set(["video/mp4", "video/quicktime", "video/webm", "video/x-m4v"]);

const REPO_ROOT = path.resolve(process.cwd(), "..", "..");
const PYTHON = path.join(REPO_ROOT, ".venv", "bin", "python");

type GateResult = {
  name: string;
  passed: boolean;
  verdict?: string;
  reason?: string;
  [k: string]: unknown;
};

export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "expected multipart/form-data" }, { status: 400 });
  }

  const file = form.get("video");
  const submitter = String(form.get("submitter") ?? "").trim();
  const business = String(form.get("business") ?? "").trim();
  const location = String(form.get("location") ?? "").trim();

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "no video attached" }, { status: 400 });
  }
  if (!submitter || !business) {
    return NextResponse.json(
      { error: "submitter and business are both required — a submission with no "
             + "claimed venue cannot be venue-verified" },
      { status: 400 },
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `video is ${(file.size / 1e6).toFixed(0)}MB; the limit is ${MAX_BYTES / 1e6}MB` },
      { status: 413 },
    );
  }
  if (file.type && !ALLOWED.has(file.type)) {
    return NextResponse.json(
      { error: `unsupported type ${file.type}` },
      { status: 415 },
    );
  }

  const dir = await mkdtemp(path.join(tmpdir(), "divvit-intake-"));
  // The submitter's filename never touches the filesystem: it is attacker
  // controlled and only decorative here.
  const target = path.join(dir, `${randomUUID()}${path.extname(file.name) || ".mp4"}`);

  try {
    await writeFile(target, Buffer.from(await file.arrayBuffer()));

    const result = await runIntake([
      "-m", "services.intake.cli", "submit", target,
      "--submitter", submitter,
      "--business", business,
      ...(location ? ["--location", location] : []),
    ]);

    if (result.payload) {
      return NextResponse.json({
        ...result.payload,
        progress: result.progress,
        original_filename: file.name,
        bytes: file.size,
      });
    }

    return NextResponse.json(
      {
        error: "the intake pipeline did not return a result",
        detail: result.stderr.slice(-1500),
        code: result.code,
      },
      { status: 502 },
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "intake failed" },
      { status: 500 },
    );
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

function runIntake(args: string[]): Promise<{
  payload: Record<string, unknown> | null;
  stderr: string;
  progress: string[];
  code: number | null;
}> {
  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON, args, {
      cwd: REPO_ROOT,
      // No shell: nothing the submitter typed can become a command.
      shell: false,
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr.on("data", (d) => { stderr += d.toString(); });

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("intake timed out after 280s"));
    }, 280_000);

    child.on("error", (err) => { clearTimeout(timer); reject(err); });
    child.on("close", (code) => {
      clearTimeout(timer);
      let payload: Record<string, unknown> | null = null;
      // The CLI prints JSON on stdout; a non-zero exit still carries a verdict
      // (an unscreenable video exits 1), so parse before judging on the code.
      try {
        payload = JSON.parse(stdout.trim());
      } catch {
        payload = null;
      }
      resolve({
        payload,
        stderr,
        progress: stderr.split("\n").map((l) => l.trim()).filter(Boolean).slice(-40),
        code,
      });
    });
  });
}
