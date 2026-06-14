import { notFound } from "next/navigation";
import { fetchItem } from "@/lib/api";
import { ItemView } from "@/components/item-view";

export const dynamic = "force-dynamic";

export default async function ItemPage({
  params,
}: {
  params: { id: string };
}) {
  try {
    const item = await fetchItem(params.id);
    return <ItemView item={item} />;
  } catch {
    // 404 / not_found from the API, or backend unreachable.
    notFound();
  }
}
