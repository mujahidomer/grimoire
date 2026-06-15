"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Check, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SaveLinkProgress } from "@/components/save-link-progress";
import { saveUrl } from "@/lib/api";
import { useSaveLinkProgress } from "@/lib/save-link-progress";
import { truncate } from "@/lib/utils";

type Status = "saving" | "saved" | "error";

// Render a shared link cleanly: drop the protocol/"www." and trailing slash,
// then truncate so long Instagram/YouTube URLs don't overflow the card.
function prettyUrl(value: string): string {
  let display = value;
  try {
    const u = new URL(value);
    display = u.hostname.replace(/^www\./, "") + u.pathname + u.search;
  } catch {
    display = value.replace(/^https?:\/\//i, "");
  }
  return truncate(display.replace(/\/$/, ""), 52);
}

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

// The iOS Shortcut hands us shared links whose own query strings contain `&`,
// which URLSearchParams truncates at the first `&` — so the saved URL loses its
// trailing params. Read the raw query string and take everything after `url=`
// verbatim to keep the link whole. This deliberately bypasses URLSearchParams.
function urlFromRawParam(search: string): string | null {
  // Match `url=` only at a real param boundary (?/&) so we don't trip on a
  // lookalike like `redirect_url=`.
  const marker = search.match(/[?&]url=/);
  if (!marker || marker.index === undefined) return null;
  let raw = search.slice(marker.index + marker[0].length);
  // The share_target also appends &text= and &title= after url=. Cut those off
  // so they aren't glued onto the link — the shared URL's own `&` params (which
  // come before these) are preserved.
  for (const sibling of ["&text=", "&title="]) {
    const i = raw.indexOf(sibling);
    if (i !== -1) raw = raw.slice(0, i);
  }
  return raw ? safeDecode(raw) : null;
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

// Pull a usable link out of whatever the share sheet handed us. Prefer the raw
// `?url=` slice (survives `&` in the shared link); then Android's `url`/`text`
// params; then a URL appended to the path with no key at all.
function resolveSharedUrl(
  url: string | null,
  text: string | null,
  rawHref: string,
  rawSearch: string,
): string | null {
  return (
    urlFromRawParam(rawSearch) ??
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
  const rawSearch = typeof window !== "undefined" ? window.location.search : "";
  const sharedUrl = resolveSharedUrl(urlParam, textParam, rawHref, rawSearch);

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
  const [saved, setSaved] = useState<{ id?: string; title?: string } | null>(
    null,
  );
  // Guards against React Strict Mode double-invoking the save on mount.
  const startedRef = useRef(false);

  // Animated three-step progress, identical to the main app's inline save.
  const { stepIndex } = useSaveLinkProgress(status === "saving");

  const save = useCallback(async () => {
    if (!sharedUrl) {
      setStatus("error");
      setError("No link was shared.");
      return;
    }

    setStatus("saving");
    setError(null);
    try {
      // keepalive keeps the POST in flight even if iOS bounces back to the
      // source app or the tab is backgrounded mid-save.
      const res = await saveUrl(sharedUrl, { keepalive: true });
      setSaved({ id: res.id, title: res.title });
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

  // The save must survive the tab being hidden — observe visibility only to log
  // it. We deliberately do NOT abort the request here; keepalive sees it home.
  useEffect(() => {
    function onVisibilityChange() {
      console.info(
        "[share-handler] visibilitychange:",
        document.visibilityState,
      );
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  // After a successful save, let the confirmation land, then get out of the way:
  // close the share-sheet tab if the browser allows it, else go home.
  useEffect(() => {
    if (status !== "saved") return;
    const timer = setTimeout(() => {
      window.close();
      // window.close() is a no-op for tabs the script didn't open (Android's
      // share sheet, iOS Safari), so redirect home as the fallback.
      window.location.href = "/";
    }, 2200);
    return () => clearTimeout(timer);
  }, [status]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-eco-main px-4 py-10">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <h1 className="font-display text-2xl text-eco-heading">Grimoire</h1>
          <p className="mt-1 font-sans text-body-md text-eco-foreground/60">
            Saving to your library
          </p>
        </div>

        <div className="space-y-5 rounded-xl border border-eco-border-light bg-eco-surface p-6 shadow-eco-sm">
          {sharedUrl && (
            <div className="flex items-center gap-2.5 rounded-lg bg-eco-main px-3 py-2.5">
              <Link2
                className="h-4 w-4 shrink-0 text-eco-foreground/40"
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate font-sans text-body-md text-eco-on-surface">
                {prettyUrl(sharedUrl)}
              </span>
            </div>
          )}

          {status === "saving" && <SaveLinkProgress stepIndex={stepIndex} />}

          {status === "saved" && (
            <div className="space-y-3 py-2 text-center">
              <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-eco-primary/15">
                <Check className="h-5 w-5 text-eco-primary" aria-hidden />
              </span>
              <p className="font-sans text-body-lg font-medium text-eco-heading">
                Saved to Grimoire ✓
              </p>
              {saved?.title &&
                (saved.id ? (
                  <Link
                    href={`/item/${saved.id}`}
                    className="block font-sans text-body-md text-eco-secondary transition-colors duration-eco hover:text-eco-primary hover:underline"
                  >
                    {saved.title}
                  </Link>
                ) : (
                  <p className="font-sans text-body-md text-eco-foreground/60">
                    {saved.title}
                  </p>
                ))}
            </div>
          )}

          {status === "error" && (
            <div className="space-y-4 py-2 text-center">
              <p className="font-sans text-body-md text-rose-600">
                {error ?? "Couldn't save that link."}
              </p>
              <Button
                type="button"
                variant="secondary"
                onClick={() => void save()}
                className="w-full"
              >
                Try again
              </Button>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
