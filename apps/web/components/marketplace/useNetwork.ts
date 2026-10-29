"use client";

import React from "react";
import { useMp } from "./session";
import { CAFE_COLUMNS, type Cafe } from "@/lib/marketplace/types";

let cache: Cafe[] | null = null;

/** The café network, fetched once per page load. */
export function useNetwork() {
  const { supabase } = useMp();
  const [cafes, setCafes] = React.useState<Cafe[]>(cache ?? []);
  React.useEffect(() => {
    if (cache) return;
    supabase.from("mp_cafes").select(CAFE_COLUMNS).then(({ data }) => {
      cache = (data as Cafe[]) ?? [];
      setCafes(cache);
    });
  }, [supabase]);
  return cafes;
}
