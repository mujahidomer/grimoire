"use client";

import { useState } from "react";
import { ChevronDown, Loader2 } from "lucide-react";
import { TOP_CATEGORIES } from "@/lib/types";
import type { Item } from "@/lib/types";
import { recategorizeItem } from "@/lib/api";
import { showToast } from "@/lib/toast";
import { cn } from "@/lib/utils";

// Quiet "Move to…" control on the item detail page — a small select of the
// 13 top categories. On change it PATCHes the item's top_category; the
// server resets subcategory to "General" and marks it manually set.
export function MoveCategoryMenu({
  item,
  onMoved,
}: {
  item: Item;
  onMoved: (item: Item) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value;
    if (!next || next === item.top_category) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await recategorizeItem(item.id, next);
      onMoved(updated);
      showToast(`Moved to ${next}`, "success");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Couldn't move this item.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="inline-flex items-center gap-1.5">
      <div className="relative inline-flex items-center">
        <select
          value={item.top_category ?? ""}
          onChange={handleChange}
          disabled={saving}
          aria-label="Move to category"
          className={cn(
            "h-8 appearance-none rounded-lg border border-eco-border-muted bg-eco-input py-0 pl-3 pr-7 font-sans text-label-md text-eco-foreground/85 transition-colors duration-eco hover:text-eco-heading focus-visible:border-eco-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-eco-primary disabled:opacity-50",
          )}
        >
          {!item.top_category && (
            <option value="" disabled>
              Move to…
            </option>
          )}
          {TOP_CATEGORIES.map((cat) => (
            <option key={cat} value={cat}>
              {cat}
            </option>
          ))}
        </select>
        {saving ? (
          <Loader2 className="pointer-events-none absolute right-2 h-3.5 w-3.5 animate-spin text-eco-foreground/55" />
        ) : (
          <ChevronDown className="pointer-events-none absolute right-2 h-3.5 w-3.5 text-eco-foreground/55" />
        )}
      </div>
      {error && (
        <span className="font-sans text-label-md text-rose-600">{error}</span>
      )}
    </div>
  );
}
