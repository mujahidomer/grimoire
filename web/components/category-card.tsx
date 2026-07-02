import Link from "next/link";
import { slugifyTopCategory, type DashboardCategorySummary } from "@/lib/types";
import { cn, truncate } from "@/lib/utils";

export function CategoryCard({
  summary,
}: {
  summary: DashboardCategorySummary;
}) {
  const empty = summary.count === 0;
  const slug = slugifyTopCategory(summary.top_category);

  return (
    <Link
      href={`/home/${slug}`}
      className={cn(
        "group block rounded-xl border border-eco-border-subtle bg-eco-surface p-5 shadow-eco-sm transition-shadow duration-eco",
        empty ? "opacity-55 hover:opacity-80" : "hover:shadow-eco",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-display text-lg font-light leading-snug text-eco-heading transition-colors duration-eco group-hover:text-eco-primary">
          {summary.top_category}
        </h3>
        <span
          className={cn(
            "shrink-0 rounded-full px-2 py-0.5 font-sans text-label-md tabular-nums",
            empty
              ? "bg-eco-hover text-eco-foreground/50"
              : "bg-eco-primary/15 text-eco-tertiary",
          )}
        >
          {summary.count}
        </span>
      </div>
      <p className="mt-2 truncate font-sans text-label-md text-eco-foreground/65">
        {summary.latest
          ? `Latest: ${truncate(summary.latest.title, 60)}`
          : "Nothing saved yet"}
      </p>
    </Link>
  );
}
