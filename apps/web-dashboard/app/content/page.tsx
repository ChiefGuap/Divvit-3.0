/* Content Manager — server half. */

import { contentItems } from "@/lib/queries";
import ContentView from "./ContentView";

export const dynamic = "force-dynamic";

export default async function ContentPage() {
  return <ContentView items={await contentItems()} />;
}
