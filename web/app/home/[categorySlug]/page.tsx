import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { fetchSubcategories } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";
import { topCategoryFromSlug } from "@/lib/types";
import type { SubcategorySummary } from "@/lib/types";
import { CategoryDetail } from "@/components/category-detail";

export const dynamic = "force-dynamic";

export default async function CategoryDashboardPage({
  params,
}: {
  params: { categorySlug: string };
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

  let subcategories: SubcategorySummary[] = [];
  try {
    const data = await fetchSubcategories(topCategory, accessToken);
    subcategories = data.subcategories ?? [];
  } catch {
    // Backend unreachable or endpoint not live yet — render the empty state.
    subcategories = [];
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 lg:px-8 lg:py-10">
      <nav className="mb-4 flex items-center gap-1.5 font-sans text-label-md text-eco-foreground/65">
        <Link
          href="/home"
          className="transition-colors duration-eco hover:text-eco-heading"
        >
          Home
        </Link>
        <ChevronRight className="h-3 w-3" />
        <span className="text-eco-foreground/85">{topCategory}</span>
      </nav>

      <h1 className="mb-6 font-display text-[1.625rem] font-normal leading-tight text-eco-heading lg:text-[2rem]">
        {topCategory}
      </h1>

      <CategoryDetail
        topCategory={topCategory}
        categorySlug={params.categorySlug}
        subcategories={subcategories}
      />
    </div>
  );
}
