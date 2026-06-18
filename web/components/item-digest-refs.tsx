import { Fragment } from "react";
import Link from "next/link";
import { LayoutGrid } from "lucide-react";
import type { Entity } from "@/lib/types";
import { entityTypeLabel, truncate } from "@/lib/utils";

function entitySummary(entity: Entity): string | null {
  const detail = entity.detail ?? {};
  if (
    entity.type === "dua" ||
    entity.type === "hadith" ||
    entity.type === "quranic_verse"
  ) {
    const translation =
      typeof detail.translation === "string" ? detail.translation.trim() : "";
    return translation || null;
  }
  const whatItDoes =
    typeof detail.what_it_does === "string" ? detail.what_it_does.trim() : "";
  return whatItDoes || null;
}

function categoryLabel(entity: Entity): string | null {
  const path = Array.isArray(entity.category_path)
    ? entity.category_path.filter(Boolean)
    : [];
  return path.length > 1 ? path.slice(1).join(" › ") : null;
}

function digestHref(entity: Entity): string {
  const params = new URLSearchParams({ type: entity.type, q: entity.name });
  return `/dashboard?${params}`;
}

function compareEntities(a: Entity, b: Entity): number {
  const typeCmp = a.type.localeCompare(b.type);
  return typeCmp !== 0 ? typeCmp : a.name.localeCompare(b.name);
}

export function ItemDigestRefs({ entities }: { entities: Entity[] }) {
  const rows = entities
    .filter((entity) => entity?.type && entity?.name)
    .sort(compareEntities);
  if (rows.length === 0) return null;

  const types = [...new Set(rows.map((entity) => entity.type))];
  const showTypeHeaders = types.length > 1;

  return (
    <section className="mb-10">
      <h2 className="mb-1 font-sans text-label-md font-light uppercase tracking-wide text-eco-foreground/65">
        Library Digest
      </h2>
      <p className="mb-3 font-sans text-label-md text-eco-foreground/55">
        Entries from this save shown in your digest.
      </p>

      <div className="overflow-x-auto">
        <table className="digest-table w-full min-w-[20rem] table-fixed border-collapse text-left">
          <colgroup>
            <col className="w-[38%]" />
            <col className="w-[54%]" />
            <col className="w-[8%]" />
          </colgroup>
          <thead>
            <tr className="text-label-md font-medium uppercase tracking-wide text-eco-foreground/55">
              <th className="py-1.5 pl-3 pr-3 font-normal">Name</th>
              <th className="py-1.5 pr-3 font-normal">What it is</th>
              <th className="py-1.5 font-normal sr-only">Digest</th>
            </tr>
          </thead>
          <tbody className="text-body-md text-eco-foreground">
            {rows.map((entity, index) => {
              const summary = entitySummary(entity);
              const category = categoryLabel(entity);
              const showHeader =
                showTypeHeaders &&
                (index === 0 || rows[index - 1].type !== entity.type);

              return (
                <FragmentRow
                  key={`${entity.type}\u0000${entity.name}`}
                  entity={entity}
                  summary={summary}
                  category={category}
                  showHeader={showHeader}
                />
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function FragmentRow({
  entity,
  summary,
  category,
  showHeader,
}: {
  entity: Entity;
  summary: string | null;
  category: string | null;
  showHeader: boolean;
}) {
  return (
    <Fragment>
      {showHeader ? (
        <tr className="digest-cat-row">
          <td colSpan={3} className="px-3 py-1.5">
            <span className="font-display text-label-md font-semibold capitalize tracking-tight text-eco-heading">
              {entityTypeLabel(entity.type)}
            </span>
          </td>
        </tr>
      ) : null}
      <tr className={`align-top ${entity.hidden ? "opacity-50" : ""}`}>
        <td className="py-1.5 pl-3 pr-3">
          <span className="break-words font-medium text-eco-on-surface">
            {entity.name}
          </span>
          {category ? (
            <div className="mt-0.5 text-[11px] leading-tight text-eco-foreground/45">
              {category}
            </div>
          ) : null}
          {entity.hidden ? (
            <div className="mt-0.5 text-[11px] leading-tight text-eco-foreground/45">
              Hidden
            </div>
          ) : null}
        </td>
        <td className="py-1.5 pr-3 text-eco-foreground/80">
          {summary ? truncate(summary, 100) : "—"}
        </td>
        <td className="py-1.5">
          <Link
            href={digestHref(entity)}
            aria-label={`View ${entity.name} in Library Digest`}
            className="inline-flex text-eco-foreground/55 transition-colors duration-eco hover:text-eco-primary"
          >
            <LayoutGrid className="h-3.5 w-3.5" />
          </Link>
        </td>
      </tr>
    </Fragment>
  );
}
