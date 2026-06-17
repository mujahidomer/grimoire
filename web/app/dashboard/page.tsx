import { ExternalLink } from "lucide-react";
import { fetchDigest } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";
import { formatDateShort } from "@/lib/utils";
import type { DigestGroup, DigestItem } from "@/lib/types";
import { DashboardSourceLink } from "@/components/dashboard-source-link";
import {
  DigestSummaryCards,
  type DigestSummaryCard,
} from "@/components/digest-summary-cards";

// Server-render the digest each request; it's read-only and small (~50 items),
// so there's nothing to hydrate on the client.
export const dynamic = "force-dynamic";

// First tag that isn't a low-confidence ("?") tag — the human label for what
// this artifact is. Falls back to the first tag of any kind, then nothing.
function whatItIs(item: DigestItem): string {
  return (
    item.tags.find((t) => !t.confidence_pending)?.name ??
    item.tags[0]?.name ??
    ""
  );
}

function formatSkillSlashName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return trimmed;
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
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

function subcategoryLabel(value: string | null | undefined): string {
  const cleaned = (value ?? "").trim();
  return cleaned ? cleaned : "uncategorized";
}

function digestItemRowCount(item: DigestItem): number {
  const skills = item.skills ?? [];
  return skills.length > 0 ? skills.length : 1;
}

function digestGroupRowCount(group: DigestGroup): number {
  return group.items.reduce((sum, item) => sum + digestItemRowCount(item), 0);
}

function digestGroupLastSaved(group: DigestGroup): string | null {
  if (group.items.length === 0) return null;
  let latest = group.items[0].date_saved;
  for (const item of group.items) {
    if (item.date_saved > latest) latest = item.date_saved;
  }
  return latest;
}

function buildSummaryCards(groups: DigestGroup[]): DigestSummaryCard[] {
  return groups.map((group) => {
    const lastSaved = digestGroupLastSaved(group);
    return {
      type: group.type,
      label: group.label,
      rowCount: digestGroupRowCount(group),
      lastSavedLabel: lastSaved ? formatDateShort(lastSaved) : "",
    };
  });
}

function groupBySubcategory(items: DigestItem[]): Array<{ key: string; items: DigestItem[] }> {
  const bySubcategory = new Map<string, DigestItem[]>();
  for (const item of items) {
    const key = subcategoryLabel(item.subcategory).toLowerCase();
    if (!bySubcategory.has(key)) bySubcategory.set(key, []);
    bySubcategory.get(key)?.push(item);
  }
  return Array.from(bySubcategory.entries())
    .sort(([a], [b]) => {
      if (a === "uncategorized") return 1;
      if (b === "uncategorized") return -1;
      return a.localeCompare(b);
    })
    .map(([key, grouped]) => ({ key, items: grouped }));
}

function DigestTable({ group }: { group: DigestGroup }) {
  const grouped = groupBySubcategory(group.items);
  return (
    <section id={group.type} className="mb-10 scroll-mt-6">
      <h2 className="mb-3 flex items-baseline gap-2 font-display text-xl text-eco-heading">
        {group.label}
        <span className="font-sans text-body-md font-normal text-eco-foreground/55">
          {group.items.length}
        </span>
      </h2>

      <table className="digest-table w-full border-collapse text-left">
        <thead>
          <tr className="text-label-md font-medium uppercase tracking-wide text-eco-foreground/55">
            <th className="py-2 pr-4 font-normal">Name</th>
            <th className="py-2 pr-4 font-normal">What it is</th>
            <th className="py-2 pr-4 font-normal">Link</th>
            <th className="py-2 pr-4 font-normal">Saved</th>
            <th className="py-2 font-normal">Source</th>
          </tr>
        </thead>
        <tbody>
          {grouped.flatMap(({ key, items }) => {
            const rows = items.flatMap((item) => {
            const skills = item.skills ?? [];
            // Skill-type saves with an extracted skills[] expand to one row per
            // skill. Everything else (older saves, other artifact types) keeps
            // the original single-row rendering.
            if (skills.length > 0) {
              return skills.map((skill, i) => {
                const link = skill.source_url ?? item.artifact_url;
                return (
                  <tr
                    key={`${item.id}-${i}`}
                    className="align-top text-body-md text-eco-foreground"
                  >
                    <td className="py-2 pr-4 font-medium text-eco-on-surface">
                      <span className="inline-flex items-center gap-1.5">
                        {item.data_version === "v2" ? (
                          <span
                            className="h-1 w-1 rounded-full bg-green-500"
                            aria-label="v2 item"
                            title="v2 item"
                          />
                        ) : null}
                        <span>
                          {group.type === "skill"
                            ? formatSkillSlashName(skill.name)
                            : skill.name}
                        </span>
                      </span>
                    </td>
                    <td className="py-2 pr-4 text-eco-foreground/85">
                      {skill.what_it_does ?? ""}
                    </td>
                    <td className="py-2 pr-4">
                      {link && <ExternalLinkIcon href={link} label="Open skill" />}
                    </td>
                    <td className="whitespace-nowrap py-2 pr-4 text-eco-foreground/65">
                      {formatDateShort(item.date_saved)}
                    </td>
                    <td className="py-2">
                      {item.source_url && <DashboardSourceLink itemId={item.id} label="Open item details" />}
                    </td>
                  </tr>
                );
              });
            }
            return (
              <tr
                key={item.id}
                className="align-top text-body-md text-eco-foreground"
              >
                <td className="py-2 pr-4 font-medium text-eco-on-surface">
                  <span className="inline-flex items-center gap-1.5">
                    {item.data_version === "v2" ? (
                      <span
                        className="h-1 w-1 rounded-full bg-green-500"
                        aria-label="v2 item"
                        title="v2 item"
                      />
                    ) : null}
                    <span>{item.artifact_name ?? item.title}</span>
                  </span>
                </td>
                <td className="py-2 pr-4 text-eco-foreground/85">
                  {whatItIs(item)}
                </td>
                <td className="py-2 pr-4">
                  {item.artifact_url && (
                    <ExternalLinkIcon href={item.artifact_url} label="Open artifact" />
                  )}
                </td>
                <td className="whitespace-nowrap py-2 pr-4 text-eco-foreground/65">
                  {formatDateShort(item.date_saved)}
                </td>
                <td className="py-2">
                  {item.source_url && <DashboardSourceLink itemId={item.id} label="Open item details" />}
                </td>
              </tr>
            );
            });
            return [
              <tr key={`subcategory-${group.type}-${key}`}>
                <td
                  colSpan={5}
                  className="py-2 pr-4 text-label-md tracking-wide text-eco-foreground/55"
                >
                  {key}
                </td>
              </tr>,
              ...rows,
            ];
          })}
        </tbody>
      </table>
    </section>
  );
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

  let groups: DigestGroup[] = [];
  try {
    ({ groups } = await fetchDigest(accessToken));
  } catch {
    // Backend unreachable at SSR time — render the empty state.
    groups = [];
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 lg:px-8 lg:py-10">
      <h1 className="mb-8 font-display text-2xl text-eco-heading">
        Library Digest
      </h1>

      {groups.length === 0 ? (
        <p className="font-sans text-body-md text-eco-foreground/65">
          Nothing here yet. Saved skills, tools, and other artifacts will show up
          grouped here.
        </p>
      ) : (
        <>
          <DigestSummaryCards cards={buildSummaryCards(groups)} />
          {groups.map((group) => (
            <DigestTable key={group.type} group={group} />
          ))}
        </>
      )}
    </div>
  );
}
