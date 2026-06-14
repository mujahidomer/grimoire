import { useEffect, useState } from "react";

export const SAVE_LINK_STEPS = [
  {
    id: "fetch",
    label: "Fetching content from the link",
    hint: "Reading the page, transcript, or post.",
  },
  {
    id: "classify",
    label: "Analyzing and summarizing",
    hint: "Picking a category, title, and summary.",
  },
  {
    id: "save",
    label: "Saving to your library",
    hint: "Storing the item and making it searchable.",
  },
] as const;

/** Step timings are estimates — the API is one request with no streaming progress. */
const STEP_DELAYS_MS = [0, 2500, 6500] as const;

export function useSaveLinkProgress(active: boolean) {
  const [stepIndex, setStepIndex] = useState(0);

  useEffect(() => {
    if (!active) {
      setStepIndex(0);
      return;
    }

    setStepIndex(0);
    const timers = STEP_DELAYS_MS.slice(1).map((delay, offset) =>
      window.setTimeout(() => setStepIndex(offset + 1), delay),
    );

    return () => timers.forEach(clearTimeout);
  }, [active]);

  return {
    stepIndex,
    steps: SAVE_LINK_STEPS,
    currentStep: SAVE_LINK_STEPS[stepIndex],
  };
}
