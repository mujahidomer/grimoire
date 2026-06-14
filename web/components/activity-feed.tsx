"use client";

import Link from "next/link";
import type { Item } from "@/lib/types";
import { formatDate, formatTime, formatType, truncate } from "@/lib/utils";
import { SourceThumbnail } from "@/components/source-thumbnail";

export type LibraryViewMode = "grid" | "list";

function groupByDay(items: Item[]): { label: string; items: Item[] }[] {
  const map = new Map<string, Item[]>();
  for (const item of items) {
    const d = new Date(item.date_saved);
    const key = d.toLocaleDateString("en-US", {
      weekday: "short",
      day: "numeric",
      month: "short",
    });
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(item);
  }
  return Array.from(map.entries()).map(([label, group]) => ({ label, items: group }));
}

function LibraryListRow({ item }: { item: Item }) {
  return (
    <Link
      href={`/item/${item.id}`}
      className="group flex items-start gap-3 rounded-xl px-2 py-3 transition-colors hover:bg-black/[0.03]"
    >
      <SourceThumbnail
        url={item.source_url}
        className="mt-0.5 h-14 w-[4.5rem] shrink-0 rounded-lg"
        iconClassName="h-4 w-4"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate font-sans text-body-md font-medium text-eco-heading group-hover:text-eco-primary">
          {item.title}
        </p>
        <p className="mt-0.5 truncate font-sans text-label-md text-eco-foreground/50">
          {item.category} · {formatType(item.type)}
        </p>
      </div>
      <span className="shrink-0 pt-0.5 font-sans text-label-md tabular-nums text-eco-foreground/40">
        {formatTime(item.created_at)}
      </span>
    </Link>
  );
}

function LibraryGridCard({ item }: { item: Item }) {
  return (
    <Link
      href={`/item/${item.id}`}
      className="group block overflow-hidden rounded-xl border border-black/[0.06] bg-white shadow-eco-sm transition-shadow duration-eco hover:shadow-eco"
    >
      <SourceThumbnail url={item.source_url} className="aspect-video w-full" />
      <div className="space-y-2 p-4">
        <div className="flex items-center justify-between gap-2 font-sans text-label-md text-eco-foreground/50">
          <span className="truncate">
            {item.category} · {formatType(item.type)}
          </span>
          <span className="shrink-0 whitespace-nowrap">
            {formatDate(item.date_saved)}
          </span>
        </div>
        <h3 className="line-clamp-2 font-display text-lg font-light leading-snug text-eco-heading transition-colors duration-eco group-hover:text-eco-primary">
          {item.title}
        </h3>
        {item.summary && (
          <p className="line-clamp-2 prose-reading text-body-md text-eco-foreground/60">
            {truncate(item.summary, 100)}
          </p>
        )}
      </div>
    </Link>
  );
}

export function ActivityFeed({
  items,
  view = "list",
}: {
  items: Item[];
  view?: LibraryViewMode;
}) {
  const groups = groupByDay(items);

  if (groups.length === 0) return null;

  return (
    <div className="space-y-8">
      {groups.map((group) => (
        <section key={group.label}>
          <h2 className="mb-4 font-sans text-label-md font-medium text-eco-foreground/45">
            {group.label}
          </h2>
          {view === "grid" ? (
            <ul className="grid grid-cols-1 gap-4 md:grid-cols-3 xl:grid-cols-4">
              {group.items.map((item) => (
                <li key={item.id}>
                  <LibraryGridCard item={item} />
                </li>
              ))}
            </ul>
          ) : (
            <ul className="space-y-1">
              {group.items.map((item) => (
                <li key={item.id}>
                  <LibraryListRow item={item} />
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}

export function RecentSaves({ items }: { items: Item[] }) {
  const recent = items.slice(0, 3);
  if (recent.length === 0) return null;

  return (
    <section className="mb-10">
      <div className="mb-4 flex items-center gap-2">
        <h2 className="font-sans text-body-md font-medium text-eco-heading">
          Recently saved
        </h2>
        <span className="rounded-md bg-eco-primary/15 px-1.5 py-0.5 font-sans text-label-md text-eco-tertiary">
          New
        </span>
      </div>
      <div className="rounded-2xl border border-eco-border-light bg-eco-surface p-1 shadow-eco-sm">
        <ul className="divide-y divide-black/[0.05]">
          {recent.map((item) => (
            <li key={item.id}>
              <Link
                href={`/item/${item.id}`}
                className="flex items-center gap-3 rounded-xl px-4 py-3 transition-colors hover:bg-black/[0.02]"
              >
                <SourceThumbnail
                  url={item.source_url}
                  className="h-12 w-16 shrink-0 rounded-lg"
                  iconClassName="h-4 w-4"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-sans text-body-md font-medium text-eco-heading">
                    {item.title}
                  </p>
                  <p className="truncate font-sans text-label-md text-eco-foreground/50">
                    {item.summary ? item.summary.slice(0, 80) : item.category}
                  </p>
                </div>
                <span className="shrink-0 font-sans text-label-md text-eco-foreground/40">
                  {formatDate(item.date_saved)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
