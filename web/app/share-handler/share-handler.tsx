"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { saveUrl } from "@/lib/api";

type Status = "saving" | "saved" | "error";

// URLSearchParams already percent-decodes once, but some share intents
// double-encode the value, so decode again — defensively, since a stray "%"
// makes decodeURIComponent throw.
function safeDecode(value: string | null): string {
  if (!value) return "";
  try {
    return decodeURIComponent(value).trim();
  } catch {
    return value.trim();
  }
}

// Return the value if it's already a URL, else the first http(s) URL embedded
// in it (some apps share a link wrapped in surrounding text).
function firstUrlIn(value: string): string | null {
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  const match = value.match(/https?:\/\/\S+/i);
  return match ? match[0] : null;
}

// Last-ditch fallback: some share targets append the shared URL straight onto
// our path with no param key, e.g. /share-handler?https://example.com or
// /share-handler/https://example.com — dig the URL back out of the raw href.
function urlFromRawHref(href: string): string | null {
  const afterHandler = href.split(/share-handler[/?]?/i)[1];
  if (!afterHandler) return null;
  const match = afterHandler.match(/https?:\/\/\S+/i);
  return match ? safeDecode(match[0]) : null;
}

// Pull a usable link out of whatever the share sheet handed us. Android often
// puts the URL in `url`; some apps only fill `text`; a few append it to the URL
// with no key at all.
function resolveSharedUrl(
  url: string | null,
  text: string | null,
  rawHref: string,
): string | null {
  return (
    firstUrlIn(safeDecode(url)) ??
    firstUrlIn(safeDecode(text)) ??
    urlFromRawHref(rawHref)
  );
}

export function ShareHandler() {
  const searchParams = useSearchParams();
  const urlParam = searchParams.get("url");
  const textParam = searchParams.get("text");
  const rawHref = typeof window !== "undefined" ? window.location.href : "";
  const sharedUrl = resolveSharedUrl(urlParam, textParam, rawHref);

  // Surface exactly what the share sheet handed us so failures are debuggable.
  useEffect(() => {
    console.info("[share-handler] received params", {
      url: urlParam,
      text: textParam,
      title: searchParams.get("title"),
      rawHref,
      resolved: sharedUrl,
    });
    // Log once on mount with the values captured at that time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
