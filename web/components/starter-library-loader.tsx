"use client";

import { Loader2 } from "lucide-react";

export function StarterLibraryLoader({
  loaded,
  expected,
  phase,
}: {
  loaded: number;
  expected: number;
  phase: "seeding" | "syncing";
}) {
  const progress =
    expected > 0 ? Math.min(100, Math.round((loaded / expected) * 100)) : 0;

  return (
    <div className="py-20 text-center">
      <Loader2
        className="mx-auto h-8 w-8 animate-spin text-eco-tertiary"
        aria-hidden
      />
      <h2 className="mt-6 font-display text-xl tracking-tight text-eco-heading">
        Building your starter library
      </h2>
      <p className="mx-auto mt-2 max-w-sm font-sans text-body-md text-eco-foreground/75">
        {phase === "seeding"
          ? "Your selected items are being prepared — this usually takes a few seconds."
          : "Almost there — loading your items into the library."}
      </p>

      {expected > 0 && (
        <div className="mx-auto mt-8 max-w-xs">
          <div className="h-1.5 overflow-hidden rounded-full bg-eco-border-subtle">
            <div
              className="h-full rounded-full bg-eco-tertiary transition-all duration-500 ease-out"
              style={{ width: `${Math.max(progress, phase === "seeding" ? 8 : 15)}%` }}
            />
          </div>
          <p className="mt-3 font-sans text-label-md text-eco-foreground/55">
            {loaded > 0
              ? `${Math.min(loaded, expected)} of ${expected} items ready`
              : `Preparing ${expected} item${expected === 1 ? "" : "s"}…`}
          </p>
        </div>
      )}
    </div>
  );
}
