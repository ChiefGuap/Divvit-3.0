"use client";

/* Marketplace auth state, shared by the header and every page. */

import React from "react";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

export type MpProfile = { role: "startup" | "cafe"; full_name: string | null };
type Session = {
  supabase: SupabaseClient;
  loading: boolean;
  user: User | null;
  profile: MpProfile | null;
  refresh: () => Promise<void>;
  /** make sure the signed-in user has a marketplace profile with this role */
  ensureProfile: (role: "startup" | "cafe") => Promise<MpProfile | null>;
  signOut: () => Promise<void>;
};

const Ctx = React.createContext<Session | null>(null);

export function MpSessionProvider({ children }: { children: React.ReactNode }) {
  const supabase = React.useMemo(() => createClient(), []);
  const [state, setState] = React.useState<{ loading: boolean; user: User | null; profile: MpProfile | null }>({
    loading: true, user: null, profile: null,
  });

  const refresh = React.useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    let profile: MpProfile | null = null;
    if (user) {
      const { data } = await supabase.from("mp_profiles").select("role, full_name").eq("id", user.id).maybeSingle();
      profile = (data as MpProfile) ?? null;
    }
    setState({ loading: false, user, profile });
  }, [supabase]);

  React.useEffect(() => {
    refresh();
    const { data } = supabase.auth.onAuthStateChange((event) => {
      // Defer: calling Supabase from inside this callback deadlocks on the auth
      // lock that signIn/signOut are still holding.
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") setTimeout(refresh, 0);
    });
    return () => data.subscription.unsubscribe();
  }, [supabase, refresh]);

  const ensureProfile = React.useCallback(async (role: "startup" | "cafe") => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const { data: existing } = await supabase.from("mp_profiles").select("role, full_name").eq("id", user.id).maybeSingle();
    if (existing) return existing as MpProfile;
    const full_name = (user.user_metadata?.full_name as string | undefined) ?? null;
    await supabase.from("mp_profiles").insert({ id: user.id, role, full_name });
    await refresh();
    return { role, full_name };
  }, [supabase, refresh]);

  const signOut = React.useCallback(async () => {
    await supabase.auth.signOut();
    await refresh();
  }, [supabase, refresh]);

  return <Ctx.Provider value={{ supabase, ...state, refresh, ensureProfile, signOut }}>{children}</Ctx.Provider>;
}

export function useMp() {
  const ctx = React.useContext(Ctx);
  if (!ctx) throw new Error("useMp must be used inside MpSessionProvider");
  return ctx;
}
