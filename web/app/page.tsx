import { fetchItems } from "@/lib/api";
import { Library } from "@/components/library";
import type { Item } from "@/lib/types";

// Server-render the first paint with all items; the client takes over for
// search/category filtering and live refresh after saves.
export const dynamic = "force-dynamic";

export default async function HomePage() {
  let initialItems: Item[] = [];
  try {
    initialItems = await fetchItems();
  } catch {
    // Backend unreachable at SSR time — render empty; the client will retry
    // on the first filter change, and the paste-box still works.
    initialItems = [];
  }

  return <Library initialItems={initialItems} />;
}
