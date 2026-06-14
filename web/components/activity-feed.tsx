"use client";

import Link from "next/link";
import { Lock } from "lucide-react";
import type { Item } from "@/lib/types";
import { formatTime, formatType } from "@/lib/utils";

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

function itemIcon(type: string) {
  if (type === "video") return "▶";
  if (type === "article") return "📄";
  return "📌";
}

export function ActivityFeed({ items }: { items: Item[] }) {
  const groups = groupByDay(items);

  if (groups.length === 0) return null;

  return (
    <div className="space-y-8">
      {groups.map((group) => (
        <section key={group.label}>
          <h2 className="mb-4 font-sans text-label-md font-medium text-eco-foreground/45">
            {group.label}
          </h2>
          <ul className="space-y-1">
            {group.items.map((item) => (
              <li key={item.id}>
                <Link
                  href={`/item/${item.id}`}
                  className="group flex items-start gap-3 rounded-xl px-2 py-3 transition-colors hover:bg-black/[0.03]"
                >
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-eco-primary/15 text-sm">
                    {itemIcon(item.type)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-sans text-body-md font-medium text-eco-heading group-hover:text-eco-primary">
                      {item.title}
                    </p>
                    <p className="mt-0.5 truncate font-sans text-label-md text-eco-foreground/50">
                      {item.category} · {formatType(item.type)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2 pt-0.5">
                    <Lock className="h-3 w-3 text-eco-foreground/25" />
                    <span className="font-sans text-label-md tabular-nums text-eco-foreground/40">
                      {formatTime(item.date_saved)}
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
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
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-eco-primary/15 text-xs font-medium text-eco-primary">
                  {item.category.charAt(0)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-sans text-body-md font-medium text-eco-heading">
                    {item.title}
                  </p>
                  <p className="truncate font-sans text-label-md text-eco-foreground/50">
                    {item.summary ? item.summary.slice(0, 80) : item.category}
                  </p>
                </div>
                <span className="shrink-0 font-sans text-label-md text-eco-foreground/40">
                  Today
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
