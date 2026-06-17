"use client";

import { LayoutGrid, List } from "lucide-react";
import { cn } from "@/lib/utils";
import type { LibraryViewMode } from "@/components/activity-feed";

export function LibraryViewToggle({
  view,
  onChange,
}: {
  view: LibraryViewMode;
  onChange: (view: LibraryViewMode) => void;
}) {
  return (
    <div
      className="inline-flex rounded-lg border border-black/[0.08] bg-white/60 p-0.5"
      role="group"
      aria-label="Library view"
    >
      <button
        type="button"
        aria-pressed={view === "list"}
        onClick={() => onChange("list")}
        className={cn(
          "inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors duration-eco",
          view === "list"
            ? "bg-eco-primary/20 text-eco-heading"
            : "text-eco-foreground/65 hover:text-eco-heading",
        )}
        aria-label="List view"
      >
        <List className="h-4 w-4" />
      </button>
      <button
        type="button"
        aria-pressed={view === "grid"}
        onClick={() => onChange("grid")}
        className={cn(
          "inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors duration-eco",
          view === "grid"
            ? "bg-eco-primary/20 text-eco-heading"
            : "text-eco-foreground/65 hover:text-eco-heading",
        )}
        aria-label="Grid view"
      >
        <LayoutGrid className="h-4 w-4" />
      </button>
    </div>
  );
}
