"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Check } from "lucide-react";
import { SourceThumbnail } from "@/components/source-thumbnail";
import {
  MIN_SEED_SELECTIONS,
  SEGMENTS,
  SEGMENT_BY_ID,
  SEGMENTS_STORAGE_KEY,
  SEED_SELECTIONS_STORAGE_KEY,
  seedItemsForSegment,
  type SeedItem,
  type SegmentId,
} from "@/lib/seed-catalog";
import { cn } from "@/lib/utils";

function readPickedSegments(): SegmentId[] {
  try {
    const raw = localStorage.getItem(SEGMENTS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) {
      return parsed.filter((id): id is SegmentId => id in SEGMENT_BY_ID);
    }
  } catch {
    /* ignore */
  }
  return [];
}

export function SeedPicker() {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<SegmentId>(SEGMENTS[0].id);

  // Tab order: the segments chosen on /landing come first and are active by
  // default; the rest follow so every segment stays reachable.
  const [tabOrder, setTabOrder] = useState<SegmentId[]>(SEGMENTS.map((s) => s.id));

  useEffect(() => {
    const picked = readPickedSegments();
    if (picked.length) {
      const rest = SEGMENTS.map((s) => s.id).filter((id) => !picked.includes(id));
      setTabOrder([...picked, ...rest]);
      setActiveTab(picked[0]);
    }
  }, []);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function addToLibrary() {
    if (selected.size < MIN_SEED_SELECTIONS) return;
    try {
      localStorage.setItem(
        SEED_SELECTIONS_STORAGE_KEY,
        JSON.stringify(Array.from(selected)),
      );
    } catch {
      /* ignore */
    }
    router.push("/signup");
  }

  const items = useMemo(() => seedItemsForSegment(activeTab), [activeTab]);
  const count = selected.size;
  const ready = count >= MIN_SEED_SELECTIONS;

  return (
    <div className="min-h-screen bg-eco-main pb-36 text-eco-heading">
      <div className="relative z-0 mx-auto max-w-5xl px-6 py-10">
        <Link
          href="/landing"
          className="text-sm text-eco-muted transition-colors hover:text-eco-heading"
        >
          ← Back
        </Link>

        <header className="mt-6 text-center">
          <h1 className="font-display text-3xl tracking-tight">
            Build your starter library
          </h1>
          <p className="mt-3 text-sm text-eco-muted">
            Choose at least {MIN_SEED_SELECTIONS}. These will be waiting in your
            library the moment you sign up.
          </p>
        </header>

        {/* Scrollable tabs */}
        <div className="-mx-6 mt-8 flex gap-2 overflow-x-auto px-6 pb-1 scrollbar-thin">
          {tabOrder.map((id) => {
            const isActive = id === activeTab;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setActiveTab(id)}
                className={cn(
                  "shrink-0 whitespace-nowrap rounded-full border px-4 py-1.5 text-sm transition-colors",
                  isActive
                    ? "border-eco-tertiary bg-eco-tertiary text-white"
                    : "border-eco-border bg-eco-surface text-eco-heading hover:border-eco-border",
                )}
              >
                {SEGMENT_BY_ID[id].label}
              </button>
            );
          })}
        </div>

        {/* Content list */}
        <div className="mt-8">
          {items.length === 0 ? (
            <p className="py-16 text-center text-sm text-eco-muted">
              Starter picks for this topic are coming soon — you can save your own
              once you&apos;re in. Pick from another tab to continue.
            </p>
          ) : (
            <div className="rounded-2xl border border-eco-border-light bg-eco-surface p-1 shadow-sm">
              <ul className="divide-y divide-black/[0.05]">
                {items.map((item) => (
                  <li key={item.id}>
                    <SeedListRow
                      item={item}
                      selected={selected.has(item.id)}
                      onToggle={() => toggle(item.id)}
                    />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      {/* Persistent selection bar */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-eco-border-light bg-eco-surface shadow-[0_-4px_16px_rgba(0,0,0,0.06)]">
        <div className="mx-auto max-w-5xl px-6 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4">
          <p className="mb-3 text-center text-sm text-eco-muted">
            {count} selected
            {!ready && (
              <span> — pick at least {MIN_SEED_SELECTIONS} to continue.</span>
            )}
          </p>
          <button
            type="button"
            onClick={addToLibrary}
            disabled={!ready}
            className="w-full rounded-full bg-eco-tertiary py-3.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Add to my library →
          </button>
        </div>
      </div>
    </div>
  );
}

function SeedListRow({
  item,
  selected,
  onToggle,
}: {
  item: SeedItem;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={selected}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left transition-colors",
        selected ? "bg-eco-tertiary/5" : "hover:bg-eco-hover",
      )}
    >
      <SourceThumbnail
        url={item.url}
        className="h-12 w-16 shrink-0 rounded-lg"
        iconClassName="h-4 w-4"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate font-sans text-sm font-medium text-eco-heading">
          {item.title}
        </p>
        <p className="mt-0.5 truncate text-xs text-eco-muted">
          {item.platform === "youtube" ? "Video" : "Article"} · {item.summary}
        </p>
      </div>
      <span
        className={cn(
          "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border transition-colors",
          selected
            ? "border-eco-tertiary bg-eco-tertiary text-white"
            : "border-eco-border bg-eco-surface",
        )}
      >
        {selected && <Check className="h-4 w-4" strokeWidth={3} />}
      </span>
    </button>
  );
}
