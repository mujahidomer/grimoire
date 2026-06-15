"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { saveUrl } from "@/lib/api";

type Status = "saving" | "saved" | "error";

// Pull a usable link out of whatever the share sheet handed us. Android often
// puts the URL in `url`, but some apps only share `text` (sometimes with the
// link embedded in surrounding words), so fall back to the first URL in there.
function resolveSharedUrl(
  url: string | null,
  text: string | null,
): string | null {
  const direct = url?.trim();
  if (direct) return direct;

  const fromText = text?.trim();
  if (!fromText) return null;

  if (/^https?:\/\//i.test(fromText)) return fromText;
  const match = fromText.match(/https?:\/\/\S+/i);
  return match ? match[0] : fromText;
}

export function ShareHandler() {
  const searchParams = useSearchParams();
  const sharedUrl = resolveSharedUrl(
    searchParams.get("url"),
    searchParams.get("text"),
  );

  const [status, setStatus] = useState<Status>("saving");
  const [error, setError] = useState<string | null>(null);
  // Guards against React Strict Mode double-invoking the save on mount.
  const startedRef = useRef(false);

  const save = useCallback(async () => {
    if (!sharedUrl) {
      setStatus("error");
      setError("No link was shared.");
      return;
    }

    setStatus("saving");
    setError(null);
    try {
      await saveUrl(sharedUrl);
      setStatus("saved");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Couldn't save that link.");
    }
  }, [sharedUrl]);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void save();
  }, [save]);

  // After a successful save, briefly show confirmation then get out of the way:
  // close the share-sheet tab if the browser allows it, else go home.
  useEffect(() => {
    if (status !== "saved") return;
    const timer = setTimeout(() => {
      window.close();
      // window.close() is a no-op for tabs the script didn't open (Android's
      // share sheet, iOS Safari), so redirect home as the fallback.
      window.location.href = "/";
    }, 1500);
    return () => clearTimeout(timer);
  }, [status]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-eco-main px-4">
      <div className="w-full max-w-sm space-y-4 text-center">
        {status === "saving" && (
          <>
            <div
              className="mx-auto h-6 w-6 animate-spin rounded-full border-2 border-eco-border border-t-eco-primary"
              aria-hidden
            />
            <p className="font-sans text-body-md text-eco-foreground/70">
              Saving to Grimoire…
            </p>
          </>
        )}

        {status === "saved" && (
          <p className="font-sans text-body-lg font-medium text-eco-heading">
            Saved to Grimoire ✓
          </p>
        )}

        {status === "error" && (
          <>
            <p className="font-sans text-body-md text-red-600">
              {error ?? "Couldn't save that link."}
            </p>
            <Button
              type="button"
              variant="secondary"
              onClick={() => void save()}
            >
              Try again
            </Button>
          </>
        )}
      </div>
    </main>
  );
}
