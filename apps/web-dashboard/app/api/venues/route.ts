/**
 * Venue lookup for onboarding.
 *
 * A route rather than a server action because the search runs on every
 * keystroke: the client debounces and cancels in-flight requests, which a
 * server action cannot be aborted the same way.
 */
import { NextResponse } from "next/server";
import { searchVenues } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q") ?? "";
  // Two characters is where results stop being the whole roster; below that
  // the query is answered locally as empty rather than billed to the database.
  if (q.trim().length < 2) return NextResponse.json({ venues: [] });

  try {
    return NextResponse.json({ venues: await searchVenues(q, 8) });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "search failed", venues: [] },
      { status: 500 },
    );
  }
}
