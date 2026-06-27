"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchChatUsage, type ChatUsageInfo } from "./api";

// Daily credit allowance, mirroring DAILY_LIMIT in lib/queryLimits.js. A normal
// query costs 1 credit, a Deep Dive 3.
export const DAILY_LIMIT = 20;
export const DEEP_COST = 3;

export interface ChatUsageState {
  usage: ChatUsageInfo | null;
  /** Account is on the server-side query limit bypass list. */
  unlimited: boolean;
  /** Credits consumed today (limit - remaining), clamped to [0, limit]. */
  used: number;
  /** Fraction of the daily allowance consumed, 0..1. */
  pct: number;
  /** No credits left for even a normal query. */
  atLimit: boolean;
  /** 80%+ consumed but not yet at the hard limit. */
  nearLimit: boolean;
  /** "Resets in 6h" / "Resets in 45m" — hours if > 1hr out, else minutes. */
  resetLabel: string;
  refresh: () => void;
}

// "Resets in Xh" when more than an hour remains, otherwise "Resets in Xm".
export function formatReset(resetAt: string | undefined): string {
  if (!resetAt) return "";
  const ms = new Date(resetAt).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return "Resets soon";
  const minutes = Math.ceil(ms / 60000);
  if (minutes > 60) return `Resets in ${Math.round(minutes / 60)}h`;
  return `Resets in ${minutes}m`;
}

// Fetches usage on mount and exposes refresh() to call after each query.
export function useChatUsage(): ChatUsageState {
  const [usage, setUsage] = useState<ChatUsageInfo | null>(null);

  const refresh = useCallback(() => {
    fetchChatUsage()
      .then(setUsage)
      .catch(() => {
        /* usage bar is non-critical — leave prior state on failure */
      });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const unlimited = usage?.unlimited === true;
  const remaining = usage?.remaining ?? DAILY_LIMIT;
  const used = unlimited ? 0 : Math.min(DAILY_LIMIT, Math.max(0, DAILY_LIMIT - remaining));
  const pct = unlimited ? 0 : Math.min(1, used / DAILY_LIMIT);
  const atLimit = !unlimited && remaining < 1;
  const nearLimit = !unlimited && used >= 16 && !atLimit;

  return {
    usage,
    unlimited,
    used,
    pct,
    atLimit,
    nearLimit,
    resetLabel: formatReset(usage?.resetAt),
    refresh,
  };
}
