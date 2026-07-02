import type { Item } from "@/lib/types";

export type ItemPipelineStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed";

export const PROCESSING_POLL_INTERVAL_MS = 5_000;
export const PROCESSING_POLL_CAP_MS = 10 * 60 * 1000;

export function itemPipelineStatus(item: Item): ItemPipelineStatus {
  return item.status ?? "completed";
}

export function isItemProcessing(item: Item): boolean {
  const status = itemPipelineStatus(item);
  return status === "pending" || status === "processing";
}

export function isItemFailed(item: Item): boolean {
  return itemPipelineStatus(item) === "failed";
}

export function hasActiveProcessingItems(
  items: Item[],
  processingSince: Record<string, number>,
  now = Date.now(),
): boolean {
  return items.some((item) => {
    if (!isItemProcessing(item)) return false;
    const started = processingSince[item.id] ?? now;
    return now - started < PROCESSING_POLL_CAP_MS;
  });
}
