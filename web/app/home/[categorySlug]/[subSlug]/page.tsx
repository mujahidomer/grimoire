import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { fetchItems, fetchSubcategories } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";
import { slugifyTopCategory, topCategoryFromSlug } from "@/lib/types";
import type { Item } from "@/lib/types";
import { ItemCard } from "@/components/item-card";

export const dynamic = "force-dynamic";

export default async function SubcategoryPage({
  params,
}: {
  params: { categorySlug: string; subSlug: string };
}) {
  const topCategory = topCategoryFromSlug(params.categorySlug);
  if (!topCategory) notFound();

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

  let subcategoryName: string | null = null;
  try {
    const { subcategories } = await fetchSubcategories(
      topCategory,
      accessToken,
    );
    subcategoryName =
      subcategories.find(
        (sub) => slugifyTopCategory(sub.name) === params.subSlug,
      )?.name ?? null;
  } catch {
    // Backend unreachable — fall through; we can't verify the slug so 404.
  }

  if (!subcategoryName) notFound();

  let items: Item[] = [];
  try {
    items = await fetchItems(
      { topCategory, subcategory: subcategoryName },
      accessToken,
    );
  } catch {
    items = [];
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 lg:px-8 lg:py-10">
      <nav className="mb-4 flex flex-wrap items-center gap-1.5 font-sans text-label-md text-eco-foreground/65">
        <Link
          href="/home"
          className="transition-colors duration-eco hover:text-eco-heading"
        >
          Home
        </Link>
        <ChevronRight className="h-3 w-3" />
        <Link
          href={`/home/${params.categorySlug}`}
          className="transition-colors duration-eco hover:text-eco-heading"
        >
          {topCategory}
        </Link>
        <ChevronRight className="h-3 w-3" />
        <span className="text-eco-foreground/85">{subcategoryName}</span>
      </nav>

      <h1 className="mb-6 font-display text-[1.625rem] font-normal leading-tight text-eco-heading lg:text-[2rem]">
        {subcategoryName}
      </h1>

      {items.length === 0 ? (
        <p className="py-16 text-center font-sans text-body-md text-eco-foreground/65">
          Nothing saved here yet.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => (
            <ItemCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}
