/* Creators — server half: fetch, then hand measured rows to the client view.

   Split because the table filters and sorts in the browser but the numbers
   must come from the database. Keeping the fetch here means no creator figure
   is ever computed from a fixture. */

import { creatorLeaderboard } from "@/lib/queries";
import { createClient } from "@/utils/supabase/server";
import { cookies } from "next/headers";
import CreatorsView from "./CreatorsView";

export const dynamic = "force-dynamic";

export default async function CreatorsPage() {
  const [creators, videoTotal] = await Promise.all([
    creatorLeaderboard(),
    (async () => {
      const supabase = createClient(await cookies());
      const { count } = await supabase
        .from("discovered_videos")
        .select("id", { count: "exact", head: true });
      return count ?? 0;
    })(),
  ]);

  return <CreatorsView creators={creators} videoTotal={videoTotal} />;
}
