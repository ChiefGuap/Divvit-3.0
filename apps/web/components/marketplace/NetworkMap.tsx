"use client";

import { CafeMap } from "./CafeMap";
import type { Cafe } from "@/lib/marketplace/types";

/** Read-only view of the whole network (marketplace home). */
export function NetworkMap({ cafes }: { cafes: Cafe[] }) {
  return <CafeMap cafes={cafes} legend={false} />;
}
