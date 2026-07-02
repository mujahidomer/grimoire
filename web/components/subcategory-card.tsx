import Link from "next/link";
import { slugifyTopCategory, type SubcategorySummary } from "@/lib/types";

export function SubcategoryCard({
  categorySlug,
  subcategory,
}: {
  categorySlug: string;
  subcategory: SubcategorySummary;
}) {
  const subSlug = slugifyTopCategory(subcategory.name);

  return (
    <Link
      href={`/home/${categorySlug}/${subSlug}`}
      className="group block rounded-xl border border-eco-border-subtle bg-eco-surface p-5 shadow-eco-sm transition-shadow duration-eco hover:shadow-eco"
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-sans text-body-md font-medium text-eco-heading transition-colors duration-eco group-hover:text-eco-primary">
          {subcategory.name}
        </h3>
        <span className="shrink-0 rounded-full bg-eco-primary/15 px-2 py-0.5 font-sans text-label-md tabular-nums text-eco-tertiary">
          {subcategory.count}
        </span>
      </div>
    </Link>
  );
}
