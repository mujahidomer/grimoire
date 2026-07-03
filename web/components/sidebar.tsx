"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpen,
  Bookmark,
  Home,
  LayoutGrid,
  Library,
  Lock,
  MessageCircle,
  PanelLeftClose,
  PenLine,
  Users,
} from "lucide-react";
import type { TopCategoryRecord } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useLibraryFilters } from "@/lib/library-context";
import { fetchTopCategories } from "@/lib/api";
import { SearchBox } from "@/components/search-box";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { UserMenu } from "@/components/user-menu";

export function Sidebar({
  open,
  onToggleSidebar,
  onToggleChat,
  onNavigate,
  chatOpen,
}: {
  open: boolean;
  onToggleSidebar: () => void;
  onToggleChat: () => void;
  onNavigate?: () => void;
  chatOpen: boolean;
}) {
  const pathname = usePathname();
  const { query, setQuery, topCategory, setTopCategory } = useLibraryFilters();
  const isAllItems = pathname === "/";
  const isHomeDashboard = pathname === "/home" || pathname.startsWith("/home/");

  // Spaces = the live, data-driven top categories (top_categories table),
  // ordered by sort_order.
  const [spaces, setSpaces] = useState<TopCategoryRecord[]>([]);
  // fetchTopCategories() swallows errors and returns []; the endpoint always
  // yields >=13 (seed fallback) when reachable, so an empty result means the
  // fetch itself failed. Track that so an outage shows an inline error instead
  // of an empty list that looks like "you have no categories" — retry once
  // before giving up.
  const [spacesError, setSpacesError] = useState(false);

  useEffect(() => {
    let active = true;
    async function loadSpaces() {
      for (let attempt = 0; attempt < 2 && active; attempt++) {
        if (attempt > 0) await new Promise((r) => setTimeout(r, 500));
        const records = await fetchTopCategories();
        if (!active) return;
        if (records.length > 0) {
          setSpaces([...records].sort((a, b) => a.sort_order - b.sort_order));
          setSpacesError(false);
          return;
        }
      }
      if (active) setSpacesError(true);
    }
    void loadSpaces();
    return () => {
      active = false;
    };
  }, []);

  if (!open) return null;

  return (
    <aside className="app-sidebar">
      <div className="flex items-center gap-2 px-3 pb-2 pt-4">
        <SearchBox
          value={query}
          onChange={setQuery}
          variant="sidebar"
          className="min-w-0 flex-1 max-w-none"
        />
        <button
          type="button"
          onClick={onToggleSidebar}
          className="shrink-0 rounded-lg p-2 text-eco-foreground/65 transition-colors hover:bg-eco-hover-strong hover:text-eco-foreground"
          aria-label="Hide sidebar"
        >
          <PanelLeftClose className="h-4 w-4" />
        </button>
      </div>

      <nav className="flex flex-col gap-0.5 px-2 py-2">
        <Link
          href="/home"
          onClick={() => onNavigate?.()}
          className={cn(
            "flex items-center gap-2.5 rounded-lg px-2.5 py-2 font-sans text-body-md transition-colors duration-eco",
            isHomeDashboard && !chatOpen
              ? "bg-eco-primary/10 text-eco-primary"
              : "text-eco-foreground hover:bg-eco-hover",
          )}
        >
          <Home className="h-4 w-4 shrink-0 opacity-70" />
          Home
        </Link>
        <Link
          href="/"
          onClick={() => {
            setTopCategory(null);
            onNavigate?.();
          }}
          className={cn(
            "flex items-center gap-2.5 rounded-lg px-2.5 py-2 font-sans text-body-md transition-colors duration-eco",
            isAllItems && !topCategory && !chatOpen
              ? "bg-eco-primary/10 text-eco-primary"
              : "text-eco-foreground hover:bg-eco-hover",
          )}
        >
          <Library className="h-4 w-4 shrink-0 opacity-70" />
          All items
        </Link>
        <button
          type="button"
          onClick={() => {
            onToggleChat();
            onNavigate?.();
          }}
          className={cn(
            "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left font-sans text-body-md transition-colors duration-eco",
            chatOpen
              ? "bg-eco-primary/10 text-eco-primary"
              : "text-eco-foreground hover:bg-eco-hover",
          )}
        >
          <MessageCircle className="h-4 w-4 shrink-0 opacity-70" />
          Chat
        </button>
        <Link
          href="/dashboard"
          onClick={() => onNavigate?.()}
          className={cn(
            "flex items-center gap-2.5 rounded-lg px-2.5 py-2 font-sans text-body-md transition-colors duration-eco",
            pathname === "/dashboard"
              ? "bg-eco-primary/10 text-eco-primary"
              : "text-eco-foreground hover:bg-eco-hover",
          )}
        >
          <LayoutGrid className="h-4 w-4 shrink-0 opacity-70" />
          Digest
        </Link>
        <Link
          href="/onboarding/shortcut"
          onClick={() => onNavigate?.()}
          className={cn(
            "flex items-center gap-2.5 rounded-lg px-2.5 py-2 font-sans text-body-md transition-colors duration-eco",
            pathname === "/onboarding/shortcut"
              ? "bg-eco-primary/10 text-eco-primary"
              : "text-eco-foreground hover:bg-eco-hover",
          )}
        >
          <Bookmark className="h-4 w-4 shrink-0 opacity-70" />
          Save shortcut
        </Link>
      </nav>

      <div className="mt-2 px-4">
        <p className="mb-1.5 font-sans text-label-md font-medium text-eco-foreground/75">
          Spaces
        </p>
        <div className="flex flex-col gap-0.5">
          <button
            type="button"
            onClick={() => {
              setTopCategory(null);
              onNavigate?.();
            }}
            className={cn(
              "flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-left font-sans text-body-md transition-colors duration-eco",
              isAllItems && !topCategory
                ? "bg-eco-primary/10 text-eco-primary"
                : "text-eco-foreground hover:bg-eco-hover",
            )}
          >
            <Lock className="h-4 w-4 shrink-0 opacity-50" />
            My library
          </button>
          {spaces.map((space) => (
            <button
              key={space.slug}
              type="button"
              onClick={() => {
                setTopCategory(space.name);
                onNavigate?.();
              }}
              className={cn(
                "flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-left font-sans text-body-md transition-colors duration-eco",
                topCategory === space.name
                  ? "bg-eco-primary/10 text-eco-primary"
                  : "text-eco-foreground hover:bg-eco-hover",
              )}
            >
              <span className="flex h-4 w-4 shrink-0 items-center justify-center text-xs">
                {space.emoji}
              </span>
              <span className="truncate">{space.name}</span>
            </button>
          ))}
          {spacesError && (
            <p className="px-2 py-1.5 font-sans text-label-md text-eco-foreground/50">
              Couldn&apos;t load categories.
            </p>
          )}
        </div>
      </div>

      <div className="mt-auto flex flex-col gap-3 px-3 pb-3">
        <div className="flex items-center gap-1 px-1">
          <button
            type="button"
            className="rounded-lg p-2 text-eco-foreground/65 transition-colors hover:bg-eco-hover-strong hover:text-eco-foreground"
            aria-label="Compose"
          >
            <PenLine className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="rounded-lg p-2 text-eco-foreground/65 transition-colors hover:bg-eco-hover-strong hover:text-eco-foreground"
            aria-label="People"
          >
            <Users className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="rounded-lg p-2 text-eco-foreground/65 transition-colors hover:bg-eco-hover-strong hover:text-eco-foreground"
            aria-label="Library"
          >
            <BookOpen className="h-4 w-4" />
          </button>
        </div>

        <div className="overflow-hidden rounded-xl border border-eco-border-light bg-eco-surface shadow-eco-sm">
          <div className="space-y-1 px-3 py-3">
            <p className="font-sans text-body-md font-medium text-eco-on-surface">
              New: Ask Grimoire
            </p>
            <p className="font-sans text-label-md text-eco-foreground/75">
              Search everything you&apos;ve saved.
            </p>
            <button
              type="button"
              onClick={onToggleChat}
              className="font-sans text-label-md font-medium text-eco-tertiary hover:underline"
            >
              Try it →
            </button>
          </div>
        </div>

        <ThemeSwitcher />

        <UserMenu />
      </div>
    </aside>
  );
}
