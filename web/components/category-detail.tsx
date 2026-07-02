"use client";

import { useRouter } from "next/navigation";
import type { SubcategorySummary } from "@/lib/types";
import { SubcategoryCard } from "@/components/subcategory-card";
import { ConsolidateSubcategories } from "@/components/consolidate-subcategories";

export function CategoryDetail({
  topCategory,
  categorySlug,
  subcategories,
}: {
  topCategory: string;
  categorySlug: string;
  subcategories: SubcategorySummary[];
}) {
  const router = useRouter();

  return (
    <>
      <div className="mb-6 flex items-center justify-between gap-3">
        <p className="font-sans text-label-md text-eco-foreground/65">
          {subcategories.length} subcategor
          {subcategories.length === 1 ? "y" : "ies"}
        </p>
        <ConsolidateSubcategories
          topCategory={topCategory}
          onApplied={() => router.refresh()}
        />
      </div>

      {subcategories.length === 0 ? (
        <p className="py-16 text-center font-sans text-body-md text-eco-foreground/65">
          Nothing saved in {topCategory} yet.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {subcategories.map((sub) => (
            <SubcategoryCard
              key={sub.name}
              categorySlug={categorySlug}
              subcategory={sub}
            />
          ))}
        </div>
      )}
    </>
  );
}
