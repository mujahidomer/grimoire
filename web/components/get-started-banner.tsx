"use client";

import { Check, Circle } from "lucide-react";
import { useOnboarding } from "@/lib/onboarding";

// Read-only "Get started" checklist shown on the dashboard until both beats —
// asking a question and saving a link — are complete. The items self-complete;
// they are not tappable.
export function GetStartedBanner() {
  const { show, queryDone, saveDone } = useOnboarding();
  if (!show) return null;

  const both = queryDone && saveDone;

  return (
    <div
      className={`mb-6 overflow-hidden rounded-2xl border border-stone-200 bg-white transition-opacity duration-500 ${
        both ? "opacity-0" : "opacity-100"
      }`}
    >
      <div className="px-5 py-4">
        <h2 className="font-display text-lg tracking-tight text-eco-heading">
          Get started with Grimoire
        </h2>
        <ul className="mt-3 space-y-2">
          <ChecklistItem done={queryDone} label="Ask Grimoire a question" />
          <ChecklistItem done={saveDone} label="Save a link of your own" />
        </ul>
      </div>
    </div>
  );
}

function ChecklistItem({ done, label }: { done: boolean; label: string }) {
  return (
    <li className="flex items-center gap-2.5">
      {done ? (
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#2D4B2D] text-white">
          <Check className="h-3 w-3" strokeWidth={3} />
        </span>
      ) : (
        <Circle className="h-5 w-5 text-stone-300" />
      )}
      <span
        className={`font-sans text-body-md ${
          done ? "text-eco-foreground/50 line-through" : "text-eco-on-surface"
        }`}
      >
        {label}
      </span>
    </li>
  );
}
