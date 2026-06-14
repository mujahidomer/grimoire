"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpen,
  ChevronDown,
  Home,
  Lock,
  MessageCircle,
  PanelLeftClose,
  PenLine,
  Users,
} from "lucide-react";
import { CATEGORIES } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useLibraryFilters } from "@/lib/library-context";
import { SearchBox } from "@/components/search-box";

function categoryIcon(category: string) {
  if (category.includes("Food")) return "🍳";
  if (category.includes("Technology")) return "💻";
  if (category.includes("Health")) return "💪";
  if (category.includes("Finance")) return "💰";
  if (category.includes("Learning")) return "📚";
  if (category.includes("Entertainment")) return "🎬";
  if (category.includes("Travel")) return "✈️";
  if (category.includes("Business")) return "💼";
  if (category.includes("Personal")) return "🌱";
  return "📁";
}

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
  const { query, setQuery, category, setCategory } = useLibraryFilters();
  const isHome = pathname === "/";

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
          className="shrink-0 rounded-lg p-2 text-eco-foreground/50 transition-colors hover:bg-black/[0.04] hover:text-eco-foreground"
          aria-label="Hide sidebar"
        >
          <PanelLeftClose className="h-4 w-4" />
        </button>
      </div>

      <nav className="flex flex-col gap-0.5 px-2 py-2">
        <Link
          href="/"
          onClick={() => {
            setCategory(null);
            onNavigate?.();
          }}
          className={cn(
            "flex items-center gap-2.5 rounded-lg px-2.5 py-2 font-sans text-body-md transition-colors duration-eco",
            isHome && !category && !chatOpen
              ? "bg-eco-primary/10 text-eco-primary"
              : "text-eco-foreground hover:bg-black/[0.03]",
          )}
        >
          <Home className="h-4 w-4 shrink-0 opacity-70" />
          Home
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
              : "text-eco-foreground hover:bg-black/[0.03]",
          )}
        >
          <MessageCircle className="h-4 w-4 shrink-0 opacity-70" />
          Chat
        </button>
      </nav>

      <div className="mt-2 px-4">
        <p className="mb-1.5 font-sans text-label-md font-medium text-eco-foreground/45">
          Spaces
        </p>
        <div className="flex flex-col gap-0.5">
          <button
            type="button"
            onClick={() => {
              setCategory(null);
              onNavigate?.();
            }}
            className={cn(
              "flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-left font-sans text-body-md transition-colors duration-eco",
              isHome && !category
                ? "bg-eco-primary/10 text-eco-primary"
                : "text-eco-foreground hover:bg-black/[0.03]",
            )}
          >
            <Lock className="h-4 w-4 shrink-0 opacity-50" />
            My library
          </button>
          {CATEGORIES.slice(0, 5).map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => {
                setCategory(cat);
                onNavigate?.();
              }}
              className={cn(
                "flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-left font-sans text-body-md transition-colors duration-eco",
                category === cat
                  ? "bg-eco-primary/10 text-eco-primary"
                  : "text-eco-foreground hover:bg-black/[0.03]",
              )}
            >
              <span className="flex h-4 w-4 shrink-0 items-center justify-center text-xs">
                {categoryIcon(cat)}
              </span>
              <span className="truncate">{cat}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="mt-auto flex flex-col gap-3 px-3 pb-3">
        <div className="flex items-center gap-1 px-1">
          <button
            type="button"
            className="rounded-lg p-2 text-eco-foreground/50 transition-colors hover:bg-black/[0.04] hover:text-eco-foreground"
            aria-label="Compose"
          >
            <PenLine className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="rounded-lg p-2 text-eco-foreground/50 transition-colors hover:bg-black/[0.04] hover:text-eco-foreground"
            aria-label="People"
          >
            <Users className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="rounded-lg p-2 text-eco-foreground/50 transition-colors hover:bg-black/[0.04] hover:text-eco-foreground"
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
            <p className="font-sans text-label-md text-eco-foreground/60">
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

        <button
          type="button"
          className="flex items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors hover:bg-black/[0.03]"
        >
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-eco-primary text-xs font-semibold text-white">
            G
          </span>
          <span className="min-w-0 flex-1 truncate font-sans text-body-md text-eco-on-surface">
            My Grimoire
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-eco-foreground/40" />
        </button>
      </div>
    </aside>
  );
}
