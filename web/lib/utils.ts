import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// "Technology · Video" — sentence-cased type.
export function formatType(type: string): string {
  if (!type) return "";
  return type.charAt(0).toUpperCase() + type.slice(1);
}

export function formatDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// "Jun 12" — compact month + day, used in dense tables like the digest.
// A plain YYYY-MM-DD (date_saved) is parsed as local, not UTC, so the day
// doesn't slip backwards in negative-offset timezones.
export function formatDateShort(iso: string): string {
  if (!iso) return "";
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  const d = dateOnly
    ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
    : new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** When the item was last saved or updated in the library (not publication date). */
export function itemRecencyMs(item: {
  created_at: string;
  updated_at?: string;
}): number {
  const created = new Date(item.created_at).getTime();
  const updated = item.updated_at ? new Date(item.updated_at).getTime() : 0;
  return Math.max(created, updated);
}

export function formatTime(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function looksLikeUrl(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  try {
    const url = new URL(trimmed);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return /^https?:\/\//i.test(trimmed);
  }
}

export function truncate(text: string | null | undefined, n: number): string {
  if (!text) return "";
  return text.length > n ? text.slice(0, n).trimEnd() + "…" : text;
}

const ARTIFACT_EMOJI: Record<string, string> = {
  skill: "✨",
  tool: "🔧",
  resource: "📎",
  person: "👤",
  concept: "💡",
};

export function artifactEmoji(type: string): string {
  return ARTIFACT_EMOJI[type] ?? "📌";
}
