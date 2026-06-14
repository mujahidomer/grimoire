"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import type { Item } from "@/lib/types";
import { fetchItems } from "@/lib/api";
import { ItemCard } from "@/components/item-card";
import { PasteBox } from "@/components/paste-box";
import { SearchBox } from "@/components/search-box";
import { CategoryPills } from "@/components/category-pills";

export function Library({ initialItems }: { initialItems: Item[] }) {
  const [items, setItems] = useState<Item[]>(initialItems);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Guards against out-of-order responses when filters change quickly.
  const reqId = useRef(0);

  const load = useCallback(async (q: string, cat: string | null) => {
    const id = ++reqId.current;
    setLoading(true);
    setError(null);
    try {
      const next = await fetchItems({
        q: q.trim() || undefined,
        category: cat || undefined,
      });
      if (id === reqId.current) setItems(next);
    } catch (err) {
      if (id === reqId.current) {
        setError(err instanceof Error ? err.message : "Failed to load items.");
      }
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, []);

  // Debounced search (300ms) combined with the active category. Skips the very
  // first render so we keep the server-fetched initialItems until a filter changes.
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    const t = setTimeout(() => load(query, category), 300);
    return () => clearTimeout(t);
  }, [query, category, load]);

  const refresh = useCallback(
    () => load(query, category),
    [load, query, category],
  );

  const isEmptyLibrary = !query && !category && items.length === 0 && !loading;
  const isNoResults =
    (!!query || !!category) && items.length === 0 && !loading;

  return (
    <div>
      {/* Top nav: wordmark + search */}
      <header className="sticky top-0 z-20 border-b border-slate-100 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <span className="font-sans text-xl font-semibold text-indigo-600">
            Grimoire
          </span>
          <SearchBox value={query} onChange={setQuery} />
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        {/* Category filter row */}
        <div className="mb-6">
          <CategoryPills active={category} onChange={setCategory} />
        </div>

        {/* Paste-box — always visible above the grid */}
        <div className="mb-8">
          <PasteBox onSaved={refresh} />
        </div>

        {/* Grid / states */}
        {loading && items.length === 0 ? (
          <div className="flex items-center justify-center py-24 text-slate-400">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : error ? (
          <p className="py-16 text-center font-sans text-sm text-rose-600">
            {error}
          </p>
        ) : isEmptyLibrary ? (
          <div className="py-16 text-center">
            <p className="font-sans text-base text-slate-500">
              Your library is empty. Save a link to get started.
            </p>
          </div>
        ) : isNoResults ? (
          <div className="py-16 text-center">
            <p className="font-sans text-base text-slate-500">
              Nothing saved on that yet.
            </p>
          </div>
        ) : (
          <div
            className={`grid grid-cols-1 gap-4 md:grid-cols-2 ${
              loading ? "opacity-60" : ""
            }`}
          >
            {items.map((item) => (
              <ItemCard key={item.id} item={item} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
