"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import type { Item } from "@/lib/types";
import { fetchItem, fetchItems } from "@/lib/api";
import { useLibraryFilters } from "@/lib/library-context";
import {
  ActivityFeed,
  RecentSaves,
  type LibraryViewMode,
} from "@/components/activity-feed";
import { LibraryViewToggle } from "@/components/library-view-toggle";
import { MainHeader } from "@/components/main-header";
import { cn } from "@/lib/utils";

const VIEW_STORAGE_KEY = "grimoire-library-view";

function sortItems(items: Item[]) {
  return [...items].sort((a, b) => {
    const dateDiff =
      new Date(b.date_saved).getTime() - new Date(a.date_saved).getTime();
    if (dateDiff !== 0) return dateDiff;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
}

function readStoredView(): LibraryViewMode {
  if (typeof window === "undefined") return "list";
  const stored = window.localStorage.getItem(VIEW_STORAGE_KEY);
  return stored === "grid" ? "grid" : "list";
}

export function Library({ initialItems }: { initialItems: Item[] }) {
  const { query, setQuery, category, setCategory } = useLibraryFilters();
  const [items, setItems] = useState<Item[]>(initialItems);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<LibraryViewMode>("list");

  const reqId = useRef(0);

  useEffect(() => {
    setView(readStoredView());
  }, []);

  function handleViewChange(next: LibraryViewMode) {
    setView(next);
    window.localStorage.setItem(VIEW_STORAGE_KEY, next);
  }

  const load = useCallback(async (q: string, cat: string | null, ensureIds?: string[]) => {
    const id = ++reqId.current;
    setLoading(true);
    setError(null);
    try {
      let next = await fetchItems({
        q: q.trim() || undefined,
        category: cat || undefined,
      });

      if (ensureIds?.length) {
        const have = new Set(next.map((item) => item.id));
        const missing = ensureIds.filter((itemId) => !have.has(itemId));
        if (missing.length) {
          const fetched = await Promise.all(
            missing.map((itemId) => fetchItem(itemId).catch(() => null)),
          );
          next = [
            ...fetched.filter((item): item is Item => item !== null),
            ...next,
          ];
        }
      }

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
    function onRefresh(e: Event) {
      const detail = (e as CustomEvent<{ savedIds?: string[] } | undefined>).detail;
      const savedIds = detail?.savedIds?.filter(Boolean);

      // After a save, clear filters so the new item is not hidden by an active
      // category/search, and fetch it directly if the list query still omits it.
      if (savedIds?.length) {
        setCategory(null);
        setQuery("");
        load("", null, savedIds);
        return;
      }

      load(query, category);
    }
    window.addEventListener("grimoire:refresh", onRefresh);
    return () => window.removeEventListener("grimoire:refresh", onRefresh);
  }, [load, query, category, setCategory, setQuery]);

  const isFiltered = !!query || !!category;
  const title = category ?? (isFiltered ? "Search results" : "Library");
  const sorted = sortItems(items);

  return (
    <div
      className={cn(
        "mx-auto px-4 py-6 lg:px-8 lg:py-10",
        view === "grid" ? "max-w-7xl" : "max-w-3xl",
      )}
    >
      <MainHeader
        title={title}
        actions={
          <LibraryViewToggle view={view} onChange={handleViewChange} />
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
          <ActivityFeed items={sorted} view={view} />
        </div>
      )}
    </div>
  );
}
