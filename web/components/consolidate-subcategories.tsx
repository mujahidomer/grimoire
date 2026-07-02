"use client";

import { useState } from "react";
import { Loader2, Sparkles, X } from "lucide-react";
import { consolidateSubcategories } from "@/lib/api";
import type { SubcategoryMergeGroup } from "@/lib/types";
import { Button } from "@/components/ui/button";

type Step = "idle" | "loading" | "preview" | "applying" | "done";

export function ConsolidateSubcategories({
  topCategory,
  onApplied,
}: {
  topCategory: string;
  onApplied: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("idle");
  const [groups, setGroups] = useState<SubcategoryMergeGroup[]>([]);
  const [totalUpdated, setTotalUpdated] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const merges = groups.flatMap((g) => g.merges);

  async function openPreview() {
    setOpen(true);
    setStep("loading");
    setError(null);
    try {
      const result = await consolidateSubcategories({
        topCategory,
        apply: false,
      });
      setGroups(result.groups ?? []);
      setStep("preview");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Couldn't load a preview. Try again.",
      );
      setStep("preview");
    }
  }

  async function confirmApply() {
    setStep("applying");
    setError(null);
    try {
      const result = await consolidateSubcategories({
        topCategory,
        apply: true,
        // Send the previewed groups back so the server applies exactly what
        // the user is looking at, not a fresh proposal.
        groups,
      });
      setTotalUpdated(result.totalUpdated ?? 0);
      setStep("done");
      onApplied();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Couldn't apply those merges. Try again.",
      );
      setStep("preview");
    }
  }

  function close() {
    setOpen(false);
    setStep("idle");
    setGroups([]);
    setError(null);
  }

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={openPreview}
        className="text-eco-foreground/65"
      >
        <Sparkles className="h-3.5 w-3.5" />
        Tidy up subcategories
      </Button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-eco-secondary/30 p-4"
          onClick={() => step !== "applying" && close()}
        >
          <div
            className="w-full max-w-lg rounded-card border border-eco-border bg-eco-surface-raised p-5 shadow-eco-lg backdrop-blur-eco"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-sans text-body-md font-semibold text-eco-secondary">
                  Tidy up subcategories
                </h3>
                <p className="mt-1 font-sans text-label-md text-eco-foreground/65">
                  Merge near-duplicate subcategory labels within this
                  category.
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={close}
                disabled={step === "applying"}
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="mt-4 max-h-80 space-y-3 overflow-y-auto scrollbar-thin">
              {step === "loading" ? (
                <div className="flex items-center justify-center py-10 text-eco-foreground/65">
                  <Loader2 className="h-5 w-5 animate-spin" />
                </div>
              ) : error ? (
                <p className="font-sans text-body-md text-rose-600">
                  {error}
                </p>
              ) : step === "done" ? (
                <p className="font-sans text-body-md text-eco-foreground/85">
                  {totalUpdated > 0
                    ? `Done — updated ${totalUpdated} item${totalUpdated === 1 ? "" : "s"}.`
                    : "Nothing to merge."}
                </p>
              ) : merges.length === 0 ? (
                <p className="font-sans text-body-md text-eco-foreground/65">
                  Nothing to merge.
                </p>
              ) : (
                merges.map((merge, i) => (
                  <div
                    key={i}
                    className="rounded-xl border border-eco-border-subtle bg-eco-surface p-3"
                  >
                    <div className="flex flex-wrap items-center gap-1.5 font-sans text-body-md">
                      <span className="text-eco-foreground/75">
                        {merge.from.join(", ")}
                      </span>
                      <span className="text-eco-foreground/45">→</span>
                      <span className="font-medium text-eco-heading">
                        {merge.to}
                      </span>
                    </div>
                    <p className="mt-1 font-sans text-label-md text-eco-foreground/55">
                      {merge.itemCount} item{merge.itemCount === 1 ? "" : "s"}
                    </p>
                  </div>
                ))
              )}
            </div>

            <div className="mt-5 flex justify-end gap-2">
              {step === "done" ? (
                <Button variant="secondary" size="sm" onClick={close}>
                  Close
                </Button>
              ) : (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={close}
                    disabled={step === "applying"}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={confirmApply}
                    disabled={
                      step === "applying" ||
                      step === "loading" ||
                      merges.length === 0 ||
                      !!error
                    }
                  >
                    {step === "applying" ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Applying…
                      </>
                    ) : (
                      "Confirm"
                    )}
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
