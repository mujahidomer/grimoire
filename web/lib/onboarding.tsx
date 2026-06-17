"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  applyPendingOnboarding,
  readPendingOnboarding,
  waitForStarterLibrary,
} from "@/lib/apply-onboarding";
import { createClient } from "@/lib/supabase/client";
import { isDevAuthBypassEnabled } from "@/lib/dev-auth";
import { DEFAULT_SEGMENT, SEGMENT_BY_ID, type SegmentId } from "@/lib/seed-catalog";

export type StarterLibraryPhase = "seeding" | "syncing";

interface OnboardingState {
  loaded: boolean;
  // The "Get started" banner is shown only while onboarding is explicitly
  // incomplete. Users created before this feature shipped have no flag at all
  // (undefined) and must never see the banner (spec note #4).
  show: boolean;
  queryDone: boolean;
  saveDone: boolean;
  shortcutDone: boolean;
  segments: SegmentId[];
  // Example query to pre-fill the chat bar, or "" once the query beat is done.
  prefillQuery: string;
  // True while funnel seed items are being copied and surfaced in the library.
  starterLibraryLoading: boolean;
  starterLibraryExpected: number;
  starterLibraryLoaded: number;
  starterLibraryPhase: StarterLibraryPhase;
  markQueryDone: () => void;
  markSaveDone: () => void;
  markShortcutDone: () => void;
  dismissWelcome: () => void;
}

const OnboardingContext = createContext<OnboardingState | null>(null);

export function OnboardingProvider({ children }: { children: React.ReactNode }) {
  const [loaded, setLoaded] = useState(false);
  const [active, setActive] = useState(false); // onboarding_complete === false
  const [queryDone, setQueryDone] = useState(false);
  const [saveDone, setSaveDone] = useState(false);
  const [shortcutDone, setShortcutDone] = useState(false);
  const [welcomeDismissed, setWelcomeDismissed] = useState(false);
  const [segments, setSegments] = useState<SegmentId[]>([]);
  const [starterLibraryLoading, setStarterLibraryLoading] = useState(false);
  const [starterLibraryExpected, setStarterLibraryExpected] = useState(0);
  const [starterLibraryLoaded, setStarterLibraryLoaded] = useState(0);
  const [starterLibraryPhase, setStarterLibraryPhase] =
    useState<StarterLibraryPhase>("seeding");
  const writing = useRef(false);

  // Read funnel selections before first paint so we never flash "library empty".
  useLayoutEffect(() => {
    if (isDevAuthBypassEnabled()) return;

    const expected = readPendingOnboarding().seedSelections.length;
    if (expected > 0) {
      setStarterLibraryLoading(true);
      setStarterLibraryExpected(expected);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (cancelled) return;

        // Dev bypass skips login; pending funnel seeds only apply after signup.
        if (!user) {
          setStarterLibraryLoading(false);
        } else {
          const pending = readPendingOnboarding();
          if (pending.seedSelections.length > 0) {
            setStarterLibraryLoading(true);
            setStarterLibraryExpected(pending.seedSelections.length);
            setStarterLibraryPhase("seeding");
          }

          const result = await applyPendingOnboarding();
          if (cancelled) return;

          if (result?.seededCount) {
            setStarterLibraryExpected(result.seededCount);
            setStarterLibraryPhase("syncing");
            await waitForStarterLibrary(result.seededCount, (count) => {
              if (!cancelled) setStarterLibraryLoaded(count);
            });
            if (cancelled) return;
          }

          if (result?.applied) {
            window.dispatchEvent(new CustomEvent("grimoire:refresh"));
          }

          setStarterLibraryLoading(false);
        }

        const {
          data: { user: freshUser },
        } = await supabase.auth.getUser();
        if (cancelled) return;
        const meta = freshUser?.user_metadata ?? {};
        setActive(meta.onboarding_complete === false);
        setQueryDone(meta.getting_started_query_done === true);
        setSaveDone(meta.getting_started_save_done === true);
        setShortcutDone(meta.getting_started_shortcut_done === true);
        setWelcomeDismissed(meta.getting_started_welcome_dismissed === true);
        setSegments(Array.isArray(meta.segments) ? meta.segments : []);
      } catch {
        if (!cancelled) setStarterLibraryLoading(false);
        /* unauthenticated / SSR — banner simply stays hidden */
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Persist a metadata patch, and flip onboarding_complete once all three beats land.
  const patchMeta = useCallback(
    async (patch: Record<string, unknown>, allDone: boolean) => {
      if (writing.current) return;
      writing.current = true;
      try {
        const supabase = createClient();
        await supabase.auth.updateUser({
          data: allDone ? { ...patch, onboarding_complete: true } : patch,
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
      const allDone = saveDone && shortcutDone;
      void patchMeta({ getting_started_query_done: true }, allDone);
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, saveDone, shortcutDone, patchMeta]);

  const markSaveDone = useCallback(() => {
    setSaveDone((prev) => {
      if (prev || !active) return prev;
      const allDone = queryDone && shortcutDone;
      void patchMeta({ getting_started_save_done: true }, allDone);
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, queryDone, shortcutDone, patchMeta]);

  const markShortcutDone = useCallback(() => {
    setShortcutDone((prev) => {
      if (prev || !active) return prev;
      const allDone = queryDone && saveDone;
      void patchMeta({ getting_started_shortcut_done: true }, allDone);
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, queryDone, saveDone, patchMeta]);

  const dismissWelcome = useCallback(() => {
    setWelcomeDismissed(true);
    void patchMeta({ getting_started_welcome_dismissed: true }, false);
  }, [patchMeta]);

  const firstSegment = segments[0] ?? DEFAULT_SEGMENT;
  const allDone = queryDone && saveDone && shortcutDone;
  const showChecklist = loaded && active && !allDone && !starterLibraryLoading;
  const showWelcome = loaded && allDone && !welcomeDismissed && !starterLibraryLoading;
  const show = showChecklist || showWelcome;
  const prefillQuery =
    active && !queryDone ? SEGMENT_BY_ID[firstSegment]?.query ?? "" : "";

  return (
    <OnboardingContext.Provider
      value={{
        loaded,
        show,
        queryDone,
        saveDone,
        shortcutDone,
        segments,
        prefillQuery,
        starterLibraryLoading,
        starterLibraryExpected,
        starterLibraryLoaded,
        starterLibraryPhase,
        markQueryDone,
        markSaveDone,
        markShortcutDone,
        dismissWelcome,
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
      shortcutDone: false,
      segments: [],
      prefillQuery: "",
      starterLibraryLoading: false,
      starterLibraryExpected: 0,
      starterLibraryLoaded: 0,
      starterLibraryPhase: "seeding",
      markQueryDone: () => {},
      markSaveDone: () => {},
      markShortcutDone: () => {},
      dismissWelcome: () => {},
    };
  }
  return ctx;
}
