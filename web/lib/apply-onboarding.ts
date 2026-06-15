import { fetchItems, seedLibrary } from "@/lib/api";
import { createClient } from "@/lib/supabase/client";
import {
  SEGMENTS_STORAGE_KEY,
  SEED_SELECTIONS_STORAGE_KEY,
} from "@/lib/seed-catalog";

export interface PendingOnboarding {
  segments: string[];
  seedSelections: string[];
}

export interface ApplyOnboardingResult {
  applied: boolean;
  requestedSeeds: number;
  seededCount: number;
}

function readJsonArray(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function readPendingOnboarding(): PendingOnboarding {
  return {
    segments: readJsonArray(SEGMENTS_STORAGE_KEY),
    seedSelections: readJsonArray(SEED_SELECTIONS_STORAGE_KEY),
  };
}

export function hasPendingOnboarding(pending: PendingOnboarding): boolean {
  return pending.segments.length > 0 || pending.seedSelections.length > 0;
}

function clearPendingOnboarding() {
  try {
    localStorage.removeItem(SEGMENTS_STORAGE_KEY);
    localStorage.removeItem(SEED_SELECTIONS_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Poll the library until seeded items show up (or we time out). Seeding can
// finish on the server before the list query reflects new rows.
export async function waitForStarterLibrary(
  expectedCount: number,
  onProgress?: (loaded: number) => void,
): Promise<number> {
  if (expectedCount <= 0) return 0;

  const deadline = Date.now() + 30_000;
  let lastCount = 0;

  while (Date.now() < deadline) {
    try {
      const items = await fetchItems({});
      lastCount = items.length;
      onProgress?.(lastCount);
      if (lastCount >= expectedCount) return lastCount;
    } catch {
      /* retry until timeout */
    }
    await sleep(400);
  }

  return lastCount;
}

// Carry pre-auth funnel selections (from /landing + /seed-picker) into the new
// account: stamp onboarding metadata and copy seed items. Clears localStorage
// only after a successful apply so OAuth signups and slow session sync can retry.
export async function applyPendingOnboarding(): Promise<ApplyOnboardingResult | null> {
  const pending = readPendingOnboarding();
  if (!hasPendingOnboarding(pending)) return null;

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const requestedSeeds = pending.seedSelections.length;

  try {
    await supabase.auth.updateUser({
      data: {
        segments: pending.segments,
        onboarding_complete: false,
        getting_started_query_done: false,
        getting_started_save_done: false,
      },
    });
  } catch {
    return null;
  }

  let seededCount = 0;
  if (requestedSeeds > 0) {
    try {
      const result = await seedLibrary(pending.seedSelections);
      seededCount = result.seeded;
    } catch {
      return null;
    }
  }

  clearPendingOnboarding();
  return { applied: true, requestedSeeds, seededCount };
}
