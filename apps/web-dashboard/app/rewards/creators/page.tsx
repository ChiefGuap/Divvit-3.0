/* Creators — server half: fetch, then hand measured rows to the client view.

   Split because the table filters and sorts in the browser but the numbers
   must come from the database. Keeping the fetch here means no creator figure
   is ever computed from a fixture. */

import { creatorLeaderboard, videoCount } from "@/lib/queries";
import CreatorsView from "./CreatorsView";

export const dynamic = "force-dynamic";

export default async function CreatorsPage() {
  const [creators, videos] = await Promise.all([creatorLeaderboard(), videoCount()]);
  return <CreatorsView creators={creators} videoTotal={videos} />;
}
