import { createClient } from "@supabase/supabase-js";

/* The app server talking to the database as itself: a plain (anon) client plus
   DIVVIT_VERIFY_SECRET, which the server-only RPCs check (mp_server_ok). */

export function serverDb() {
  const secret = process.env.DIVVIT_VERIFY_SECRET;
  if (!secret) throw new Error("DIVVIT_VERIFY_SECRET is not set");
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } });
  return { db, secret };
}
