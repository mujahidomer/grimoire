"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Plus } from "lucide-react";
import type { Item } from "@/lib/types";
import { fetchItems } from "@/lib/api";
import { useLibraryFilters } from "@/lib/library-context";
import { ActivityFeed, RecentSaves } from "@/components/activity-feed";
import { MainHeader } from "@/components/main-header";
import { Button } from "@/components/ui/button";

export function Library({ initialItems }: { initialItems: Item[] }) {
  const { query, category } = useLibraryFilters();
  const [items, setItems] = useState<Item[]>(initialItems);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    const t = setTimeout(() => load(query, category), 300);
    return () => clearTimeout(t);
  }, [query, category, load]);

  useEffect(() => {
    function onRefresh() {
      load(query, category);
    }
    window.addEventListener("grimoire:refresh", onRefresh);
    return () => window.removeEventListener("grimoire:refresh", onRefresh);
  }, [load, query, category]);

  const isFiltered = !!query || !!category;
  const title = category ?? (isFiltered ? "Search results" : "Library");
  const sorted = [...items].sort(
    (a, b) => new Date(b.date_saved).getTime() - new Date(a.date_saved).getTime(),
  );

  return (
    <div className="mx-auto max-w-3xl px-8 py-10">
      <MainHeader
        title={title}
        actions={
          <Button size="sm">
            <Plus className="h-4 w-4" />
            Quick save
          </Button>
        }
      />

      {!isFiltered && <RecentSaves items={sorted} />}

      {loading && items.length === 0 ? (
        <div className="flex items-center justify-center py-24 text-eco-foreground/50">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : error ? (
        <p className="py-16 text-center font-sans text-body-md text-rose-600">
          {error}
        </p>
      ) : items.length === 0 ? (
        <div className="py-16 text-center">
          <p className="font-sans text-body-md text-eco-foreground/70">
            {isFiltered
              ? "Nothing saved on that yet."
              : "Your library is empty. Save a link to get started."}
          </p>
        </div>
      ) : (
        <div className={loading ? "opacity-60" : ""}>
          <ActivityFeed items={sorted} />
        </div>
      )}
    </div>
  );
}
