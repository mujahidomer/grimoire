import { useEffect, useState } from "react";
import { getCachedLinkPreview, loadLinkPreview } from "@/lib/preview-cache";
import type { Item, LinkPreview } from "@/lib/types";
import { itemPipelineStatus } from "@/lib/item-status";

const PLACEHOLDER_TITLE = "Untitled";
const PLACEHOLDER_CATEGORY = "Other";

const PROCESSING_STEP_MESSAGES = [
  { afterMs: 0, label: "Fetching content from the link" },
  { afterMs: 20_000, label: "Analyzing and summarizing" },
  { afterMs: 60_000, label: "Saving to your library" },
] as const;

export function sourceHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function isPlaceholderTitle(title: string): boolean {
  return !title.trim() || title.trim() === PLACEHOLDER_TITLE;
}

export function isPlaceholderCategory(category: string): boolean {
  return !category.trim() || category.trim() === PLACEHOLDER_CATEGORY;
}

export function itemDisplayTitle(
  item: Item,
  previewTitle?: string | null,
): string {
  if (previewTitle?.trim()) return previewTitle.trim();
  if (!isPlaceholderTitle(item.title)) return item.title;
  return sourceHostname(item.source_url);
}

export function getProcessingMessage(item: Item, now = Date.now()): string {
  if (itemPipelineStatus(item) === "pending") {
    return "Queued — starting soon";
  }

  const elapsed = now - new Date(item.created_at).getTime();
  let message: string = PROCESSING_STEP_MESSAGES[0].label;
  for (const step of PROCESSING_STEP_MESSAGES) {
    if (elapsed >= step.afterMs) message = step.label;
  }
  return message;
}

export function useItemLinkPreview(
  url: string,
  enabled: boolean,
): LinkPreview | null {
  const [preview, setPreview] = useState<LinkPreview | null>(() =>
    enabled ? (getCachedLinkPreview(url) ?? null) : null,
  );

  useEffect(() => {
    if (!enabled) return;

    const cached = getCachedLinkPreview(url);
    if (cached) {
      setPreview(cached);
      return;
    }

    let cancelled = false;
    loadLinkPreview(url)
      .then((next) => {
        if (!cancelled) setPreview(next);
      })
      .catch(() => {
        /* thumbnail/title fallbacks handle missing preview */
      });

    return () => {
      cancelled = true;
    };
  }, [url, enabled]);

  return preview;
}

export function useProcessingMessage(item: Item, active: boolean): string {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return;
    const interval = window.setInterval(() => setNow(Date.now()), 3_000);
    return () => window.clearInterval(interval);
  }, [active]);

  return getProcessingMessage(item, now);
}
