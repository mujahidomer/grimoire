import { notFound } from "next/navigation";
import { fetchItem } from "@/lib/api";
import { ItemView } from "@/components/item-view";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function ItemPage({
  params,
}: {
  params: { id: string };
}) {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const accessToken = session?.access_token ?? null;

  try {
    const item = await fetchItem(params.id, accessToken);
    return <ItemView item={item} />;
  } catch {
    // 404 / not_found from the API, or backend unreachable.
    notFound();
  }
}
