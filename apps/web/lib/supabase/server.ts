import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

/** Server Supabase client for server components and route handlers. */
export async function createClient() {
  const store = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => store.getAll(),
        setAll: (list) => {
          try {
            list.forEach(({ name, value, options }) => store.set(name, value, options));
          } catch {
            // called from a server component — middleware refreshes the session instead
          }
        },
      },
    },
  );
}
