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
    <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 scrollbar-thin sm:mx-0 sm:flex-wrap sm:px-0">
      {pills.map((pill) => {
        const isActive = active === pill.value;
        return (
          <button
            key={pill.label}
            onClick={() => onChange(pill.value)}
            className={cn(
              "whitespace-nowrap rounded-lg px-3 py-1.5 font-sans text-sm transition-colors",
              isActive
                ? "bg-indigo-600 text-white"
                : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50",
            )}
          >
            {pill.label}
          </button>
        );
      })}
    </div>
  );
}
