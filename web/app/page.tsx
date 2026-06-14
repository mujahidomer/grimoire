import { fetchItems } from "@/lib/api";
import { Library } from "@/components/library";
import { createClient } from "@/lib/supabase/server";
import type { Item } from "@/lib/types";

// Server-render the first paint with all items; the client takes over for
// search/category filtering and live refresh after saves.
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  let accessToken: string | null = null;
  if (user) {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    accessToken = session?.access_token ?? null;
  }

  let initialItems: Item[] = [];
  try {
    initialItems = await fetchItems({}, accessToken);
  } catch {
    // Backend unreachable at SSR time — render empty; the client will retry
    // on the first filter change, and the paste-box still works.
    initialItems = [];
  }

  return <Library initialItems={initialItems} />;
}
