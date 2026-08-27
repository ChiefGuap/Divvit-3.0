import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

/**
 * Server-side Supabase client, for server components and route handlers.
 *
 * `setAll` is wrapped because a Server Component cannot write cookies. That is
 * not an error worth surfacing: the middleware refreshes the session on every
 * request, so a failed write here is already handled a layer up.
 */
export const createClient = (cookieStore: Awaited<ReturnType<typeof cookies>>) =>
  createServerClient(supabaseUrl!, supabaseKey!, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // Called from a Server Component — middleware handles the refresh.
        }
      },
    },
  });
