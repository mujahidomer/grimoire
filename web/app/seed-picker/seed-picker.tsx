"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Check, FileText, Youtube } from "lucide-react";
import {
  MIN_SEED_SELECTIONS,
  SEGMENTS,
  SEGMENT_BY_ID,
  SEGMENTS_STORAGE_KEY,
  SEED_SELECTIONS_STORAGE_KEY,
  seedItemsForSegment,
  youtubeThumb,
  type SeedItem,
  type SegmentId,
} from "@/lib/seed-catalog";

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
    <div className="min-h-screen bg-[#EEEAE4] pb-28 text-[#1C1C1A]">
      <div className="mx-auto max-w-5xl px-6 py-10">
        <Link
          href="/landing"
          className="text-sm text-[#8A8780] transition-colors hover:text-[#1C1C1A]"
        >
          ← Back
        </Link>

        <header className="mt-6 text-center">
          <h1 className="font-display text-3xl tracking-tight">
            Build your starter library
          </h1>
          <p className="mt-3 text-sm text-[#8A8780]">
            Choose at least {MIN_SEED_SELECTIONS}. These will be waiting in your
            library the moment you sign up.
          </p>
        </header>

        {/* Tabs */}
        <div className="mt-8 flex flex-wrap justify-center gap-2">
          {tabOrder.map((id) => {
            const isActive = id === activeTab;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setActiveTab(id)}
                className={`rounded-full border px-4 py-1.5 text-sm transition-colors ${
                  isActive
                    ? "border-[#2D4B2D] bg-[#2D4B2D] text-white"
                    : "border-stone-300 bg-white text-[#1C1C1A] hover:border-stone-400"
                }`}
              >
                {SEGMENT_BY_ID[id].label}
              </button>
            );
          })}
        </div>

        {/* Content grid */}
        <div className="mt-8">
          {items.length === 0 ? (
            <p className="py-16 text-center text-sm text-[#8A8780]">
              Starter picks for this topic are coming soon — you can save your own
              once you&apos;re in. Pick from another tab to continue.
            </p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((item) => (
                <SeedCard
                  key={item.id}
                  item={item}
                  selected={selected.has(item.id)}
                  onToggle={() => toggle(item.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Persistent selection bar */}
      <div className="fixed inset-x-0 bottom-0 border-t border-stone-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-4">
          <p className="text-sm text-[#8A8780]">
            {count} selected
            {!ready && (
              <span> — pick at least {MIN_SEED_SELECTIONS} to continue.</span>
            )}
          </p>
          <button
            type="button"
            onClick={addToLibrary}
            disabled={!ready}
            className="rounded-full bg-[#2D4B2D] px-6 py-3 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Add to my library →
          </button>
        </div>
      </div>
    </div>
  );
}

function SeedCard({
  item,
  selected,
  onToggle,
}: {
  item: SeedItem;
  selected: boolean;
  onToggle: () => void;
}) {
  const thumb = item.platform === "youtube" ? youtubeThumb(item.url) : null;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={selected}
      className={`group relative flex flex-col overflow-hidden rounded-2xl border bg-white text-left transition-colors ${
        selected ? "border-[#2D4B2D] ring-1 ring-[#2D4B2D]" : "border-stone-200 hover:border-stone-300"
      }`}
    >
      {/* Selection check */}
      <span
        className={`absolute right-3 top-3 z-10 flex h-6 w-6 items-center justify-center rounded-full border transition-colors ${
          selected
            ? "border-[#2D4B2D] bg-[#2D4B2D] text-white"
            : "border-stone-300 bg-white/80 text-transparent"
        }`}
      >
        <Check className="h-4 w-4" strokeWidth={3} />
      </span>

      {/* Thumbnail / content-type indicator */}
      <div className="flex h-32 items-center justify-center bg-stone-100">
        {thumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumb}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <FileText className="h-8 w-8 text-stone-400" />
        )}
      </div>

      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-center gap-1.5 text-[#8A8780]">
          {item.platform === "youtube" ? (
            <Youtube className="h-3.5 w-3.5" />
          ) : (
            <FileText className="h-3.5 w-3.5" />
          )}
          <span className="text-xs capitalize">
            {item.platform === "youtube" ? "Video" : "Article"}
          </span>
        </div>
        <h3 className="mt-1.5 font-display text-base leading-snug tracking-tight text-[#1C1C1A]">
          {item.title}
        </h3>
        <p className="mt-1.5 text-sm leading-relaxed text-[#8A8780]">
          {item.summary}
        </p>
      </div>
    </button>
  );
}
