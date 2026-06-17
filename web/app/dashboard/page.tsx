import { fetchDigest } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";
import type { DigestItem } from "@/lib/types";
import {
  DigestExplorer,
  type EntityGroup,
  type FlatEntity,
} from "@/components/digest-explorer";

// Server-render the digest each request; it's read-only and small (~50 items),
// so there's nothing to hydrate on the client.
export const dynamic = "force-dynamic";

// Human-readable table labels per entity.type. Anything not listed falls back
// to a title-cased, pluralized version of the raw type.
const ENTITY_TYPE_LABELS: Record<string, string> = {
  tool: "Tools",
  skill: "Skills",
  dua: "Duas",
  hadith: "Hadiths",
  quranic_verse: "Quranic Verses",
  book: "Books",
  workflow: "Workflows",
  resource: "Resources",
};

function entityTypeLabel(type: string): string {
  if (ENTITY_TYPE_LABELS[type]) return ENTITY_TYPE_LABELS[type];
  const titled = type
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
  return titled.endsWith("s") ? titled : `${titled}s`;
}

// Collect every entity from every item into one flat list, tagging each with
// its parent item's id/date/source so rows can still link back. Hidden entities
// are kept here — the client decides whether to render them.
function flattenEntities(items: DigestItem[]): FlatEntity[] {
  const flat: FlatEntity[] = [];
  for (const item of items) {
    for (const entity of item.entities ?? []) {
      if (!entity || !entity.type || !entity.name) continue;
      flat.push({
        ...entity,
        itemId: item.id,
        dateSaved: item.date_saved,
        sourceUrl: item.source_url,
      });
    }
  }
  return flat;
}

// Cross-save dedup: the same entity (same type + normalized name) saved from
// multiple items collapses to one row, keeping the most recent date_saved and
// linking back to that most-recent parent item.
function dedupeEntities(flat: FlatEntity[]): FlatEntity[] {
  const byKey = new Map<string, FlatEntity>();
  for (const entity of flat) {
    const key = `${entity.type}\u0000${entity.name.trim().toLowerCase()}`;
    const existing = byKey.get(key);
    if (!existing || entity.dateSaved > existing.dateSaved) {
      byKey.set(key, entity);
    }
  }
  return Array.from(byKey.values());
}

// Group by entity.type into tables, sorted by row count descending.
function groupByType(entities: FlatEntity[]): EntityGroup[] {
  const byType = new Map<string, FlatEntity[]>();
  for (const entity of entities) {
    if (!byType.has(entity.type)) byType.set(entity.type, []);
    byType.get(entity.type)?.push(entity);
  }
  return Array.from(byType.entries())
    .map(([type, list]) => ({ type, label: entityTypeLabel(type), entities: list }))
    .sort((a, b) => b.entities.length - a.entities.length);
}

export default async function DashboardPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  let accessToken: string | null = null;
  if (user) {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    accessToken = session?.access_token ?? null;
  }

  let items: DigestItem[] = [];
  try {
    ({ items } = await fetchDigest(accessToken));
  } catch {
    // Backend unreachable at SSR time — render the empty state.
    items = [];
  }

  const groups = groupByType(dedupeEntities(flattenEntities(items)));

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 lg:px-8 lg:py-10">
      <h1 className="mb-8 font-display text-2xl text-eco-heading">
        Library Digest
      </h1>

      {groups.length === 0 ? (
        <p className="font-sans text-body-md text-eco-foreground/65">
          Nothing here yet. Saved tools, skills, duas, and other actionable
          entities will show up grouped here.
        </p>
      ) : (
        <DigestExplorer groups={groups} />
      )}
    </div>
  );
}
