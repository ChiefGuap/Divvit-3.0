import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/** Refreshes the Supabase session cookie on the way through. `respond` builds
    the response (a rewrite or a plain next()) and is re-run whenever Supabase
    needs to set cookies, so the refreshed session survives the rewrite. */
export async function updateSession(request: NextRequest, respond: () => NextResponse) {
  let response = respond();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list) => {
          list.forEach(({ name, value }) => request.cookies.set(name, value));
          response = respond();
          list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );
  // touching auth refreshes an expiring token; nothing else should run between
  // creating the client and this call
  await supabase.auth.getUser();
  return response;
}
