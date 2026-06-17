"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
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
import { GetStartedBanner } from "@/components/get-started-banner";
import { StarterLibraryLoader } from "@/components/starter-library-loader";
import { useOnboarding } from "@/lib/onboarding";
import { cn, itemRecencyMs } from "@/lib/utils";

const VIEW_STORAGE_KEY = "grimoire-library-view";

function sortItems(items: Item[]) {
  return [...items].sort(
    (a, b) => itemRecencyMs(b) - itemRecencyMs(a),
  );
}

async function fetchItemsWithEnsured(
  q: string,
  cat: string | null,
  ensureIds?: string[],
): Promise<Item[]> {
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

  return sortItems(next);
}

function readStoredView(): LibraryViewMode {
  if (typeof window === "undefined") return "list";
  const stored = window.localStorage.getItem(VIEW_STORAGE_KEY);
  return stored === "grid" ? "grid" : "list";
}

export function Library({ initialItems }: { initialItems: Item[] }) {
  const { query, setQuery, category, setCategory } = useLibraryFilters();
  const {
    starterLibraryLoading,
    starterLibraryExpected,
    starterLibraryLoaded,
    starterLibraryPhase,
  } = useOnboarding();
  const [items, setItems] = useState<Item[]>(() => sortItems(initialItems));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<LibraryViewMode>("list");

  const reqId = useRef(0);
  const pendingEnsureIds = useRef<string[] | undefined>();

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
      let next = await fetchItemsWithEnsured(q, cat, ensureIds);

      // After a save, the list query can briefly lag behind the new row.
      if (ensureIds?.length) {
        const have = new Set(next.map((item) => item.id));
        const stillMissing = ensureIds.filter((itemId) => !have.has(itemId));
        if (stillMissing.length && id === reqId.current) {
          await new Promise((resolve) => setTimeout(resolve, 500));
          if (id === reqId.current) {
            next = await fetchItemsWithEnsured(q, cat, ensureIds);
          }
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

  const refresh = useCallback(() => {
    load(query, category);
  }, [load, query, category]);

  useEffect(() => {
    if (starterLibraryLoading) return;
    const delay = query.trim() ? 300 : 0;
    const t = setTimeout(() => {
      const ensureIds = pendingEnsureIds.current;
      pendingEnsureIds.current = undefined;
      load(query, category, ensureIds);
    }, delay);
    return () => clearTimeout(t);
  }, [query, category, load, starterLibraryLoading]);

  useEffect(() => {
    function onRefresh(e: Event) {
      const detail = (e as CustomEvent<{ savedIds?: string[] } | undefined>).detail;
      const savedIds = detail?.savedIds?.filter(Boolean);

      // After a save, clear filters so the new item is not hidden by an active
      // category/search. Queue ensureIds for the filter-driven reload so we
      // don't race two concurrent list fetches.
      if (savedIds?.length) {
        pendingEnsureIds.current = savedIds;
        if (query || category) {
          setCategory(null);
          setQuery("");
        } else {
          load("", null, savedIds);
        }
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
  const recentItems = isFiltered ? [] : sorted.slice(0, 3);
  const feedItems = isFiltered ? sorted : sorted.slice(recentItems.length);

  return (
    <div
      className={cn(
        "mx-auto px-4 py-6 lg:px-8 lg:py-10",
        view === "grid" ? "max-w-7xl" : "max-w-3xl",
      )}
    >
      <GetStartedBanner />

      <MainHeader
        title={title}
        actions={
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={refresh}
              disabled={loading}
              className={cn(
                "inline-flex h-8 w-8 items-center justify-center rounded-lg border border-eco-border-muted bg-eco-input text-eco-foreground/65 transition-colors duration-eco hover:text-eco-heading disabled:opacity-50",
              )}
              aria-label="Refresh library"
            >
              <RefreshCw
                className={cn("h-4 w-4", loading && "animate-spin")}
              />
            </button>
            <LibraryViewToggle view={view} onChange={handleViewChange} />
          </div>
        }
      />

      {recentItems.length > 0 && !starterLibraryLoading && (
        <RecentSaves items={recentItems} />
      )}

      {starterLibraryLoading ? (
        <StarterLibraryLoader
          loaded={starterLibraryLoaded}
          expected={starterLibraryExpected}
          phase={starterLibraryPhase}
        />
      ) : loading && items.length === 0 ? (
        <div className="flex items-center justify-center py-24 text-eco-foreground/65">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : error ? (
        <p className="py-16 text-center font-sans text-body-md text-rose-600">
          {error}
        </p>
      ) : items.length === 0 ? (
        <div className="py-16 text-center">
          <p className="font-sans text-body-md text-eco-foreground/85">
            {isFiltered
              ? "Nothing saved on that yet."
              : "Your library is empty. Save a link to get started."}
          </p>
        </div>
      ) : (
        <div className={loading ? "opacity-60" : ""}>
          <ActivityFeed items={feedItems} view={view} />
        </div>
      )}
    </div>
  );
}
