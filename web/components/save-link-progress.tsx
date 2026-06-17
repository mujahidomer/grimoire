"use client";

import { CheckCircle2, Circle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { SAVE_LINK_STEPS } from "@/lib/save-link-progress";

export function SaveLinkProgress({ stepIndex }: { stepIndex: number }) {
  const currentStep = SAVE_LINK_STEPS[stepIndex];

  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="w-full border-t border-eco-border-subtle px-1 pt-3"
    >
      <p className="font-sans text-label-md font-medium text-eco-secondary">
        {currentStep.label}…
      </p>
      <p className="mt-0.5 font-sans text-label-md text-eco-foreground/75">
        {currentStep.hint} This usually takes 10–30 seconds — please keep this
        tab open.
      </p>

      <ol className="mt-3 space-y-2">
        {SAVE_LINK_STEPS.map((step, index) => {
          const done = index < stepIndex;
          const active = index === stepIndex;

          return (
            <li
              key={step.id}
              className={cn(
                "flex items-start gap-2 font-sans text-label-md",
                done && "text-eco-foreground/85",
                active && "text-eco-secondary",
                !done && !active && "text-eco-foreground/35",
              )}
            >
              {done ? (
                <CheckCircle2
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 text-eco-primary"
                  aria-hidden
                />
              ) : active ? (
                <Loader2
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-eco-primary"
                  aria-hidden
                />
              ) : (
                <Circle
                  className="mt-0.5 h-3.5 w-3.5 shrink-0"
                  aria-hidden
                />
              )}
              <span>{step.label}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
