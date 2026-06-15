import { seedLibrary } from "@/lib/api";
import { createClient } from "@/lib/supabase/client";
import {
  SEGMENTS_STORAGE_KEY,
  SEED_SELECTIONS_STORAGE_KEY,
} from "@/lib/seed-catalog";

export interface PendingOnboarding {
  segments: string[];
  seedSelections: string[];
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

// Carry pre-auth funnel selections (from /landing + /seed-picker) into the new
// account: stamp onboarding metadata and copy seed items. Returns true when
// pending selections were applied; false when there was nothing to do or the
// user is not signed in yet. Clears localStorage only after a successful apply
// so OAuth signups and slow session sync can retry on the next page load.
export async function applyPendingOnboarding(): Promise<boolean> {
  const pending = readPendingOnboarding();
  if (!hasPendingOnboarding(pending)) return false;

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;

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
    return false;
  }

  if (pending.seedSelections.length > 0) {
    try {
      await seedLibrary(pending.seedSelections);
    } catch {
      return false;
    }
  }

  clearPendingOnboarding();
  return true;
}
