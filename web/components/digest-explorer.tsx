"use client";

import { Fragment, useMemo, useState } from "react";
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

type Level1Group = { level1: string; rows: FlatEntity[] };

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

// Within one level-1 group, order by the deeper path then name so siblings
// cluster.
function compareWithinLevel1(a: FlatEntity, b: FlatEntity): number {
  const pa = categoryPath(a).slice(1);
  const pb = categoryPath(b).slice(1);
  const len = Math.min(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const c = pa[i].localeCompare(pb[i]);
    if (c !== 0) return c;
  }
  if (pa.length !== pb.length) return pa.length - pb.length;
  return a.name.localeCompare(b.name);
}

// Flat sort for the (rarely shown) hidden list.
function compareRows(a: FlatEntity, b: FlatEntity): number {
  const c = categoryPath(a)[0].localeCompare(categoryPath(b)[0]);
  return c !== 0 ? c : a.name.localeCompare(b.name);
}

// Bucket rows by their top-level category, label shown once per bucket.
// Uncategorized sinks to the bottom; other buckets sort alphabetically.
function groupByLevel1(entities: FlatEntity[]): Level1Group[] {
  const byL1 = new Map<string, FlatEntity[]>();
  for (const entity of entities) {
    const l1 = categoryPath(entity)[0];
    if (!byL1.has(l1)) byL1.set(l1, []);
    byL1.get(l1)?.push(entity);
  }
  return Array.from(byL1.entries())
    .map(([level1, rows]) => ({
      level1,
      rows: [...rows].sort(compareWithinLevel1),
    }))
    .sort((a, b) => {
      const aUnc = a.level1 === "uncategorized";
      const bUnc = b.level1 === "uncategorized";
      if (aUnc !== bUnc) return aUnc ? 1 : -1;
      return a.level1.localeCompare(b.level1);
    });
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

// Name + optional command chip. When the entity has a deeper category path, an
// instant (no-delay) tooltip reveals the full chain on hover/focus.
function EntityName({ entity }: { entity: FlatEntity }) {
  const path = categoryPath(entity);
  const command = entityCommand(entity);
  const hasMore = path.length > 1;
  return (
    <span
      className={`group/name relative inline-flex flex-wrap items-center gap-2 ${
        hasMore ? "cursor-help" : ""
      }`}
      tabIndex={hasMore ? 0 : undefined}
    >
      <span className="break-words font-medium text-eco-on-surface">
        {entity.name}
      </span>
      {command ? (
        <code className="break-all rounded bg-eco-hover px-1.5 py-0.5 font-mono text-label-md font-normal text-eco-foreground/70">
          {command}
        </code>
      ) : null}
      {hasMore ? (
        <span
          role="tooltip"
          className="pointer-events-none absolute left-0 top-full z-30 mt-1 hidden whitespace-nowrap rounded-md border border-eco-border-light bg-eco-surface px-2 py-1 text-[12px] font-normal leading-none text-eco-foreground/80 shadow-lg group-hover/name:block group-focus-within/name:block"
        >
          {path.join(" › ")}
        </span>
      ) : null}
    </span>
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

function VisibilityToggle({
  hidden,
  pending,
  alwaysVisible,
  onClick,
}: {
  hidden: boolean;
  pending: boolean;
  alwaysVisible?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={pending}
      onClick={onClick}
      aria-label={hidden ? "Show entity" : "Hide entity"}
      title={hidden ? "Show in digest" : "Hide from digest"}
      className={`inline-flex text-eco-foreground/55 transition-opacity duration-eco hover:text-eco-primary disabled:opacity-40 ${
        hidden || alwaysVisible
          ? "opacity-100"
          : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
      }`}
    >
      {hidden ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
    </button>
  );
}

// ─── Desktop (sm+) table row ──────────────────────────────────────────────────
function DesktopRow({
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
  return (
    <tr
      className={`group align-top text-body-md text-eco-foreground ${
        hidden ? "opacity-45" : ""
      }`}
    >
      <td className="py-2 pl-3 pr-4">
        <EntityName entity={entity} />
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
          <DashboardSourceLink itemId={entity.itemId} label="Open item details" />
        ) : null}
      </td>
      <td className="py-2 pl-1">
        <VisibilityToggle
          hidden={hidden}
          pending={pending}
          onClick={() => onToggle(entity, !hidden)}
        />
      </td>
    </tr>
  );
}

// ─── Mobile (<sm) card ────────────────────────────────────────────────────────
function MobileCard({
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
  // No hover on touch, so surface the deeper path inline (level-1 is the header).
  const deeper = categoryPath(entity).slice(1);
  return (
    <li className={`py-3 ${hidden ? "opacity-50" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {deeper.length > 0 ? (
            <div className="mb-0.5 text-[11px] leading-none text-eco-foreground/40">
              {deeper.join(" › ")}
            </div>
          ) : null}
          <EntityName entity={entity} />
          <div className="mt-1 text-body-md leading-snug text-eco-foreground/75">
            <WhatItIsCell entity={entity} />
          </div>
          <div className="mt-1.5 flex items-center gap-3 text-label-md text-eco-foreground/45">
            <span className="whitespace-nowrap">
              {formatDateShort(entity.dateSaved)}
            </span>
            {entity.url ? (
              <ExternalLinkIcon href={entity.url} label="Open entity" />
            ) : null}
            {entity.sourceUrl ? (
              <DashboardSourceLink
                itemId={entity.itemId}
                label="Open item details"
              />
            ) : null}
          </div>
        </div>
        <VisibilityToggle
          hidden={hidden}
          pending={pending}
          alwaysVisible
          onClick={() => onToggle(entity, !hidden)}
        />
      </div>
    </li>
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

  const activeGroup = groups.find((g) => g.type === activeType) ?? groups[0];

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

  const visibleRows = activeGroup.entities.filter((e) => !isHidden(e));
  const hiddenRows = activeGroup.entities
    .filter((e) => isHidden(e))
    .sort(compareRows);
  const level1Groups = groupByLevel1(visibleRows);

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

      {/* Active type only. */}
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
              {showHidden ? "Hide hidden" : `Show hidden (${hiddenRows.length})`}
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
          <>
            {/* Desktop table */}
            <table className="digest-table hidden w-full table-fixed border-collapse text-left sm:table">
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
                  <th className="py-2 pl-3 pr-4 font-normal">Name</th>
                  <th className="py-2 pr-4 font-normal">What it is</th>
                  <th className="py-2 pr-4 font-normal">Link</th>
                  <th className="py-2 pr-4 font-normal">Saved</th>
                  <th className="py-2 pr-2 font-normal">Source</th>
                  <th className="py-2 font-normal sr-only">Visibility</th>
                </tr>
              </thead>
              <tbody>
                {level1Groups.map((g) => (
                  <Fragment key={g.level1}>
                    <tr className="digest-cat-row">
                      <td colSpan={6} className="px-3 py-2">
                        <span className="inline-flex items-baseline gap-2">
                          <span className="font-display text-body-md font-semibold capitalize tracking-tight text-eco-heading">
                            {g.level1}
                          </span>
                          <span className="font-sans text-label-md font-normal text-eco-foreground/45">
                            {g.rows.length}
                          </span>
                        </span>
                      </td>
                    </tr>
                    {g.rows.map((entity) => {
                      const key = entityKey(entity);
                      return (
                        <DesktopRow
                          key={key}
                          entity={entity}
                          hidden={false}
                          pending={!!pending[key]}
                          onToggle={handleToggle}
                        />
                      );
                    })}
                  </Fragment>
                ))}
                {showHidden && hiddenRows.length > 0 ? (
                  <>
                    <tr className="digest-cat-row">
                      <td colSpan={6} className="px-3 py-2">
                        <span className="inline-flex items-baseline gap-2">
                          <span className="font-display text-body-md font-semibold capitalize tracking-tight text-eco-foreground/50">
                            Hidden
                          </span>
                          <span className="font-sans text-label-md font-normal text-eco-foreground/40">
                            {hiddenRows.length}
                          </span>
                        </span>
                      </td>
                    </tr>
                    {hiddenRows.map((entity) => {
                      const key = entityKey(entity);
                      return (
                        <DesktopRow
                          key={key}
                          entity={entity}
                          hidden
                          pending={!!pending[key]}
                          onToggle={handleToggle}
                        />
                      );
                    })}
                  </>
                ) : null}
              </tbody>
            </table>

            {/* Mobile cards */}
            <div className="space-y-5 sm:hidden">
              {level1Groups.map((g) => (
                <div key={g.level1}>
                  <h3 className="mb-1 flex items-baseline gap-2 rounded-md bg-eco-badge-bg px-3 py-1.5 shadow-[inset_3px_0_0_var(--eco-primary)]">
                    <span className="font-display text-body-md font-semibold capitalize tracking-tight text-eco-heading">
                      {g.level1}
                    </span>
                    <span className="font-sans text-label-md font-normal text-eco-foreground/45">
                      {g.rows.length}
                    </span>
                  </h3>
                  <ul className="divide-y divide-eco-border-subtle px-3">
                    {g.rows.map((entity) => {
                      const key = entityKey(entity);
                      return (
                        <MobileCard
                          key={key}
                          entity={entity}
                          hidden={false}
                          pending={!!pending[key]}
                          onToggle={handleToggle}
                        />
                      );
                    })}
                  </ul>
                </div>
              ))}
              {showHidden && hiddenRows.length > 0 ? (
                <div>
                  <h3 className="mb-1 flex items-baseline gap-2 rounded-md bg-eco-badge-bg px-3 py-1.5 shadow-[inset_3px_0_0_var(--eco-primary)]">
                    <span className="font-display text-body-md font-semibold capitalize tracking-tight text-eco-foreground/50">
                      Hidden
                    </span>
                    <span className="font-sans text-label-md font-normal text-eco-foreground/40">
                      {hiddenRows.length}
                    </span>
                  </h3>
                  <ul className="divide-y divide-eco-border-subtle px-3">
                    {hiddenRows.map((entity) => {
                      const key = entityKey(entity);
                      return (
                        <MobileCard
                          key={key}
                          entity={entity}
                          hidden
                          pending={!!pending[key]}
                          onToggle={handleToggle}
                        />
                      );
                    })}
                  </ul>
                </div>
              ) : null}
            </div>
          </>
        )}
      </section>
    </>
  );
}
