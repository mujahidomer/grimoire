"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { applyPendingOnboarding } from "@/lib/apply-onboarding";
import { createClient } from "@/lib/supabase/client";
import { DEFAULT_SEGMENT, SEGMENT_BY_ID, type SegmentId } from "@/lib/seed-catalog";

interface OnboardingState {
  loaded: boolean;
  // The "Get started" banner is shown only while onboarding is explicitly
  // incomplete. Users created before this feature shipped have no flag at all
  // (undefined) and must never see the banner (spec note #4).
  show: boolean;
  queryDone: boolean;
  saveDone: boolean;
  segments: SegmentId[];
  // Example query to pre-fill the chat bar, or "" once the query beat is done.
  prefillQuery: string;
  markQueryDone: () => void;
  markSaveDone: () => void;
}

const OnboardingContext = createContext<OnboardingState | null>(null);

export function OnboardingProvider({ children }: { children: React.ReactNode }) {
  const [loaded, setLoaded] = useState(false);
  const [active, setActive] = useState(false); // onboarding_complete === false
  const [queryDone, setQueryDone] = useState(false);
  const [saveDone, setSaveDone] = useState(false);
  const [segments, setSegments] = useState<SegmentId[]>([]);
  // Keep the banner mounted briefly after completion so it can fade out.
  const [dismissed, setDismissed] = useState(false);
  const writing = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (cancelled) return;

        // OAuth signups skip the email form, so funnel selections may still be
        // in localStorage when the authenticated library first mounts.
        if (user) {
          const applied = await applyPendingOnboarding();
          if (cancelled) return;
          if (applied) {
            window.dispatchEvent(new CustomEvent("grimoire:refresh"));
          }
        }

        const {
          data: { user: freshUser },
        } = await supabase.auth.getUser();
        if (cancelled) return;
        const meta = freshUser?.user_metadata ?? {};
        setActive(meta.onboarding_complete === false);
        setQueryDone(meta.getting_started_query_done === true);
        setSaveDone(meta.getting_started_save_done === true);
        setSegments(Array.isArray(meta.segments) ? meta.segments : []);
      } catch {
        /* unauthenticated / SSR — banner simply stays hidden */
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Persist a metadata patch, and flip onboarding_complete once both beats land.
  const patchMeta = useCallback(
    async (patch: Record<string, unknown>, bothDone: boolean) => {
      if (writing.current) return;
      writing.current = true;
      try {
        const supabase = createClient();
        await supabase.auth.updateUser({
          data: bothDone ? { ...patch, onboarding_complete: true } : patch,
        });
      } catch {
        /* best-effort — local state already reflects the change */
      } finally {
        writing.current = false;
      }
    },
    [],
  );

  const markQueryDone = useCallback(() => {
    setQueryDone((prev) => {
      if (prev || !active) return prev;
      const bothDone = saveDone;
      void patchMeta({ getting_started_query_done: true }, bothDone);
      if (bothDone) finishSoon();
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, saveDone, patchMeta]);

  const markSaveDone = useCallback(() => {
    setSaveDone((prev) => {
      if (prev || !active) return prev;
      const bothDone = queryDone;
      void patchMeta({ getting_started_save_done: true }, bothDone);
      if (bothDone) finishSoon();
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, queryDone, patchMeta]);

  // Let the last checkmark register, then fade the banner out for good.
  const finishSoon = useCallback(() => {
    window.setTimeout(() => setDismissed(true), 1200);
  }, []);

  const firstSegment = segments[0] ?? DEFAULT_SEGMENT;
  const show = loaded && active && !dismissed;
  const prefillQuery =
    active && !queryDone ? SEGMENT_BY_ID[firstSegment]?.query ?? "" : "";

  return (
    <OnboardingContext.Provider
      value={{
        loaded,
        show,
        queryDone,
        saveDone,
        segments,
        prefillQuery,
        markQueryDone,
        markSaveDone,
      }}
    >
      {children}
    </OnboardingContext.Provider>
  );
}

export function useOnboarding(): OnboardingState {
  const ctx = useContext(OnboardingContext);
  if (!ctx) {
    // Outside the provider (e.g. bare routes) onboarding is simply inert.
    return {
      loaded: true,
      show: false,
      queryDone: false,
      saveDone: false,
      segments: [],
      prefillQuery: "",
      markQueryDone: () => {},
      markSaveDone: () => {},
    };
  }
  return ctx;
}
