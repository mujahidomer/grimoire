"use client";

import { useMemo, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  BookOpen,
  BookMarked,
  Eye,
  EyeOff,
  ExternalLink,
  GitBranch,
  Layers,
  Library,
  Moon,
  ScrollText,
  Wrench,
  Zap,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { formatDateShort } from "@/lib/utils";
import type { Entity } from "@/lib/types";
import { DashboardSourceLink } from "@/components/dashboard-source-link";

// One entity with its parent item's identity attached, so a deduped row can
// still link back to where it was saved.
export type FlatEntity = Entity & {
  itemId: string;
  dateSaved: string;
  sourceUrl: string;
};

export type EntityGroup = {
  type: string;
  label: string;
  entities: FlatEntity[];
};

const ICON_BY_TYPE: Record<string, LucideIcon> = {
  skill: Zap,
  tool: Wrench,
  workflow: GitBranch,
  dua: Moon,
  hadith: BookOpen,
  quranic_verse: ScrollText,
  book: BookMarked,
  resource: Library,
};

function iconForType(type: string): LucideIcon {
  return ICON_BY_TYPE[type] ?? Layers;
}

// Stable key for an entity row: parent item + type + name. Matches the tuple we
// use to locate the entity inside the parent item's entities array in Supabase.
function entityKey(entity: FlatEntity): string {
  return `${entity.itemId}\u0000${entity.type}\u0000${entity.name}`;
}

// A non-empty, cleaned category path, or ["uncategorized"] as the fallback.
function categoryPath(entity: FlatEntity): string[] {
  const path = Array.isArray(entity.category_path)
    ? entity.category_path.filter(Boolean)
    : [];
  return path.length > 0 ? path : ["uncategorized"];
}

// Sort rows by the first level of category_path so related items cluster, with
// uncategorized sinking to the bottom; ties break on name.
function compareRows(a: FlatEntity, b: FlatEntity): number {
  const aFirst = categoryPath(a)[0];
  const bFirst = categoryPath(b)[0];
  const aUnc = aFirst === "uncategorized";
  const bUnc = bFirst === "uncategorized";
  if (aUnc !== bUnc) return aUnc ? 1 : -1;
  const c = aFirst.localeCompare(bFirst);
  if (c !== 0) return c;
  return a.name.localeCompare(b.name);
}

function formatSkillSlashName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return trimmed;
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function entityCommand(entity: FlatEntity): string | null {
  const cmd = entity.detail?.command;
  return typeof cmd === "string" && cmd.trim()
    ? formatSkillSlashName(cmd)
    : null;
}

function lastSavedDate(entities: FlatEntity[]): string | null {
  let latest: string | null = null;
  for (const entity of entities) {
    if (!latest || entity.dateSaved > latest) latest = entity.dateSaved;
  }
  return latest;
}

function CategoryBreadcrumb({ entity }: { entity: FlatEntity }) {
  const path = categoryPath(entity);
  const hasMore = path.length > 1;
  // Show only the top-level category to keep rows compact; the full chain is
  // revealed on hover via the native title tooltip.
  return (
    <div
      title={hasMore ? path.join(" › ") : undefined}
      className={`mb-0.5 inline-flex max-w-full items-center gap-1 truncate text-[12px] leading-none text-eco-foreground/45 ${
        hasMore ? "cursor-help" : ""
      }`}
    >
      <span className="truncate">{path[0]}</span>
      {hasMore ? (
        <span aria-hidden className="text-eco-foreground/30">
          ›
        </span>
      ) : null}
    </div>
  );
}

function WhatItIsCell({ entity }: { entity: FlatEntity }) {
  const detail = entity.detail ?? {};
  if (
    entity.type === "dua" ||
    entity.type === "hadith" ||
    entity.type === "quranic_verse"
  ) {
    const arabic = typeof detail.arabic === "string" ? detail.arabic : "";
    const translation =
      typeof detail.translation === "string" ? detail.translation : "";
    const source = typeof detail.source === "string" ? detail.source : "";
    return (
      <>
        {arabic ? (
          <div
            dir="rtl"
            className="text-right text-lg leading-relaxed text-eco-on-surface"
          >
            {arabic}
          </div>
        ) : null}
        {translation ? <div className="mt-0.5">{translation}</div> : null}
        {source ? (
          <div className="mt-0.5 text-label-md text-eco-foreground/55">
            {source}
          </div>
        ) : null}
      </>
    );
  }
  const whatItDoes = detail.what_it_does;
  return <>{typeof whatItDoes === "string" ? whatItDoes : ""}</>;
}

function ExternalLinkIcon({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      className="inline-flex text-eco-foreground/55 transition-colors duration-eco hover:text-eco-primary"
    >
      <ExternalLink className="h-3.5 w-3.5" />
    </a>
  );
}

function EntityRow({
  entity,
  hidden,
  pending,
  onToggle,
}: {
  entity: FlatEntity;
  hidden: boolean;
  pending: boolean;
  onToggle: (entity: FlatEntity, nextHidden: boolean) => void;
}) {
  const command = entityCommand(entity);
  return (
    <tr
      className={`group align-top text-body-md text-eco-foreground ${
        hidden ? "opacity-45" : ""
      }`}
    >
      <td className="py-2 pr-4 font-medium text-eco-on-surface">
        <CategoryBreadcrumb entity={entity} />
        <span className="flex flex-wrap items-center gap-2">
          <span className="break-words">{entity.name}</span>
          {command ? (
            <code className="break-all rounded bg-eco-hover px-1.5 py-0.5 font-mono text-label-md text-eco-foreground/70">
              {command}
            </code>
          ) : null}
        </span>
      </td>
      <td className="py-2 pr-4 text-eco-foreground/85">
        <WhatItIsCell entity={entity} />
      </td>
      <td className="py-2 pr-4">
        {entity.url ? (
          <ExternalLinkIcon href={entity.url} label="Open entity" />
        ) : null}
      </td>
      <td className="whitespace-nowrap py-2 pr-4 text-eco-foreground/65">
        {formatDateShort(entity.dateSaved)}
      </td>
      <td className="py-2 pr-2">
        {entity.sourceUrl ? (
          <DashboardSourceLink
            itemId={entity.itemId}
            label="Open item details"
          />
        ) : null}
      </td>
      <td className="py-2 pl-1">
        <button
          type="button"
          disabled={pending}
          onClick={() => onToggle(entity, !hidden)}
          aria-label={hidden ? "Show entity" : "Hide entity"}
          title={hidden ? "Show in digest" : "Hide from digest"}
          className={`inline-flex text-eco-foreground/55 transition-opacity duration-eco hover:text-eco-primary disabled:opacity-40 ${
            hidden
              ? "opacity-100"
              : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
          }`}
        >
          {hidden ? (
            <Eye className="h-3.5 w-3.5" />
          ) : (
            <EyeOff className="h-3.5 w-3.5" />
          )}
        </button>
      </td>
    </tr>
  );
}

// Persist a single entity's hidden flag onto the parent item's entities array
// in Supabase, matching on type + name. RLS restricts this to the owner's rows.
async function persistHidden(
  itemId: string,
  type: string,
  name: string,
  hidden: boolean,
): Promise<void> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("items")
    .select("entities")
    .eq("id", itemId)
    .single();
  if (error) throw error;

  const entities = Array.isArray(data?.entities)
    ? (data.entities as Entity[])
    : [];
  const updated = entities.map((e) =>
    e && e.type === type && e.name === name ? { ...e, hidden } : e,
  );

  const { error: updateError } = await supabase
    .from("items")
    .update({ entities: updated })
    .eq("id", itemId);
  if (updateError) throw updateError;
}

export function DigestExplorer({ groups }: { groups: EntityGroup[] }) {
  // Optimistic per-entity hidden overrides, keyed by entityKey. Seeded lazily
  // from each entity's stored hidden flag the first time it's toggled.
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [pending, setPending] = useState<Record<string, boolean>>({});

  const isHidden = (entity: FlatEntity): boolean => {
    const key = entityKey(entity);
    return key in overrides ? overrides[key] : !!entity.hidden;
  };

  const visibleCount = (group: EntityGroup): number =>
    group.entities.filter((e) => !isHidden(e)).length;

  // Default to the entity type with the most visible items.
  const defaultType = useMemo(() => {
    let best = groups[0]?.type ?? "";
    let bestCount = -1;
    for (const group of groups) {
      const count = group.entities.filter((e) => !e.hidden).length;
      if (count > bestCount) {
        bestCount = count;
        best = group.type;
      }
    }
    return best;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [activeType, setActiveType] = useState(defaultType);
  const [showHidden, setShowHidden] = useState(false);

  const activeGroup =
    groups.find((g) => g.type === activeType) ?? groups[0];

  function selectTab(type: string) {
    setActiveType(type);
    setShowHidden(false);
  }

  async function handleToggle(entity: FlatEntity, nextHidden: boolean) {
    const key = entityKey(entity);
    setPending((p) => ({ ...p, [key]: true }));
    setOverrides((o) => ({ ...o, [key]: nextHidden }));
    try {
      await persistHidden(entity.itemId, entity.type, entity.name, nextHidden);
    } catch (err) {
      // Revert the optimistic change on failure.
      setOverrides((o) => ({ ...o, [key]: !nextHidden }));
      console.error("Failed to update entity visibility:", err);
    } finally {
      setPending((p) => {
        const next = { ...p };
        delete next[key];
        return next;
      });
    }
  }

  if (!activeGroup) return null;

  const visibleRows = activeGroup.entities
    .filter((e) => !isHidden(e))
    .sort(compareRows);
  const hiddenRows = activeGroup.entities
    .filter((e) => isHidden(e))
    .sort(compareRows);

  return (
    <>
      {/* Tab cards — responsive grid; each card selects its entity type. */}
      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {groups.map((group) => {
          const Icon = iconForType(group.type);
          const count = visibleCount(group);
          const latest = lastSavedDate(
            group.entities.filter((e) => !isHidden(e)),
          );
          const active = group.type === activeType;
          return (
            <button
              key={group.type}
              type="button"
              onClick={() => selectTab(group.type)}
              aria-pressed={active}
              className={`flex flex-col gap-1 rounded-xl border p-3 text-left transition-colors duration-eco ${
                active
                  ? "border-eco-primary bg-eco-hover ring-1 ring-eco-primary"
                  : "border-eco-border-light bg-eco-surface hover:bg-eco-hover"
              }`}
            >
              <Icon
                className={`h-4 w-4 ${
                  active ? "text-eco-primary" : "text-eco-foreground/55"
                }`}
                aria-hidden
              />
              <span className="font-sans text-2xl font-medium leading-none text-eco-on-surface">
                {count}
              </span>
              <span className="font-sans text-label-md text-eco-foreground/55">
                {group.label}
              </span>
              {latest ? (
                <span className="font-sans text-label-md text-eco-foreground/45">
                  {formatDateShort(latest)}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {/* Active table only. */}
      <section className="mb-10">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 className="flex items-baseline gap-2 font-display text-xl text-eco-heading">
            {activeGroup.label}
            <span className="font-sans text-body-md font-normal text-eco-foreground/55">
              {visibleRows.length}
            </span>
          </h2>
          {hiddenRows.length > 0 ? (
            <button
              type="button"
              onClick={() => setShowHidden((s) => !s)}
              className="font-sans text-label-md text-eco-foreground/55 underline-offset-2 transition-colors duration-eco hover:text-eco-primary hover:underline"
            >
              {showHidden
                ? "Hide hidden"
                : `Show hidden (${hiddenRows.length})`}
            </button>
          ) : null}
        </div>

        {visibleRows.length === 0 && !showHidden ? (
          <p className="font-sans text-body-md text-eco-foreground/55">
            Nothing visible here.
            {hiddenRows.length > 0
              ? ` ${hiddenRows.length} hidden — use “Show hidden” to reveal.`
              : ""}
          </p>
        ) : (
          <table className="digest-table w-full table-fixed border-collapse text-left">
            <colgroup>
              <col className="w-[24%]" />
              <col className="w-[48%]" />
              <col className="w-[6%]" />
              <col className="w-[11%]" />
              <col className="w-[6%]" />
              <col className="w-[5%]" />
            </colgroup>
            <thead>
              <tr className="text-label-md font-medium uppercase tracking-wide text-eco-foreground/55">
                <th className="py-2 pr-4 font-normal">Name</th>
                <th className="py-2 pr-4 font-normal">What it is</th>
                <th className="py-2 pr-4 font-normal">Link</th>
                <th className="py-2 pr-4 font-normal">Saved</th>
                <th className="py-2 pr-2 font-normal">Source</th>
                <th className="py-2 font-normal sr-only">Visibility</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((entity) => {
                const key = entityKey(entity);
                return (
                  <EntityRow
                    key={key}
                    entity={entity}
                    hidden={false}
                    pending={!!pending[key]}
                    onToggle={handleToggle}
                  />
                );
              })}
              {showHidden
                ? hiddenRows.map((entity) => {
                    const key = entityKey(entity);
                    return (
                      <EntityRow
                        key={key}
                        entity={entity}
                        hidden
                        pending={!!pending[key]}
                        onToggle={handleToggle}
                      />
                    );
                  })
                : null}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
