import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

/* One app, two hosts:
     divvit.app               → app/(site)        landing, How it works
     marketplace.divvit.app   → app/marketplace   startup + café marketplace
   Locally: localhost:3200 and marketplace.localhost:3200. */

export async function middleware(request: NextRequest) {
  const host = (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "").toLowerCase();
  const { pathname, search } = request.nextUrl;

  if (host.startsWith("marketplace.")) {
    // already-internal paths, the API and the crawler files pass straight through
    if (pathname.startsWith("/marketplace") || pathname.startsWith("/api") || pathname === "/robots.txt" || pathname === "/sitemap.xml") {
      return updateSession(request, () => NextResponse.next({ request }));
    }
    const url = request.nextUrl.clone();
    url.pathname = `/marketplace${pathname === "/" ? "" : pathname}`;
    return updateSession(request, () => NextResponse.rewrite(url, { request }));
  }

  // On the main site the marketplace lives on its own subdomain.
  if (pathname === "/marketplace" || pathname.startsWith("/marketplace/")) {
    const target = new URL(process.env.NEXT_PUBLIC_MARKETPLACE_URL || "http://marketplace.localhost:3200");
    target.pathname = pathname.replace(/^\/marketplace/, "") || "/";
    target.search = search;
    return NextResponse.redirect(target);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|assets/|fonts/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ttf|woff2?)$).*)"],
};
