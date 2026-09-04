/* The Collection — server half. */

import { submissions } from "@/lib/queries";
import CollectionView from "./CollectionView";

export const dynamic = "force-dynamic";

export default async function CollectionPage() {
  return <CollectionView submissions={await submissions()} />;
}
