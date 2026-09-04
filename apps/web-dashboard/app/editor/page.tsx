/* Editor — server half. */

import { editorCuts, tableCounts } from "@/lib/queries";
import EditorView from "./EditorView";

export const dynamic = "force-dynamic";

export default async function EditorPage() {
  const [cuts, counts] = await Promise.all([editorCuts(), tableCounts()]);
  return <EditorView cuts={cuts} libraryCount={counts.contentItems} />;
}
