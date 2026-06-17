"use client";

import { CATEGORIES } from "@/lib/types";
import { cn } from "@/lib/utils";

export function CategoryPills({
  active,
  onChange,
}: {
  active: string | null;
  onChange: (category: string | null) => void;
}) {
  const pills: { label: string; value: string | null }[] = [
    { label: "All", value: null },
    ...CATEGORIES.map((c) => ({ label: c, value: c })),
  ];

  return (
    <div className="-mx-section flex gap-2 overflow-x-auto px-section pb-1 scrollbar-thin sm:mx-0 sm:flex-wrap sm:px-0">
      {pills.map((pill) => {
        const isActive = active === pill.value;
        return (
          <button
            key={pill.label}
            onClick={() => onChange(pill.value)}
            className={cn(
              "whitespace-nowrap rounded-surface px-3 py-1.5 font-sans text-body-md transition-colors duration-eco",
              isActive
                ? "bg-eco-surface text-eco-on-surface ring-1 ring-eco-border"
                : "bg-eco-input text-eco-foreground ring-1 ring-eco-border backdrop-blur-eco hover:bg-eco-primary/10",
            )}
          >
            {pill.label}
          </button>
        );
      })}
    </div>
  );
}
