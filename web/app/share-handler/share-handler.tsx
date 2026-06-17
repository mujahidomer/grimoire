"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, Circle, Globe, Link2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { previewImageUrl, saveUrl } from "@/lib/api";
import { loadLinkPreview } from "@/lib/preview-cache";
import { SAVE_LINK_STEPS, useSaveLinkProgress } from "@/lib/save-link-progress";
import type { LinkPreview } from "@/lib/types";
import { cn, truncate } from "@/lib/utils";

type Status = "saving" | "saved" | "error";

// Bare domain for the muted source line, e.g. "instagram.com".
function hostname(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return value.replace(/^https?:\/\//i, "").split("/")[0];
  }
}

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
  const [preview, setPreview] = useState<LinkPreview | null>(null);
  const [imageFailed, setImageFailed] = useState(false);
  // Guards against React Strict Mode double-invoking the save on mount.
  const startedRef = useRef(false);

  // Animated three-step progress, identical to the main app's inline save.
  const { stepIndex } = useSaveLinkProgress(status === "saving");

  // Fetch a link preview (thumbnail/title) in parallel with the save — purely
  // best-effort cosmetics, so failures fall back to the domain-only card.
  useEffect(() => {
    if (!sharedUrl) return;
    let cancelled = false;
    loadLinkPreview(sharedUrl)
      .then((p) => {
        if (!cancelled) setPreview(p);
      })
      .catch(() => {
        /* no preview — the domain fallback covers it */
      });
    return () => {
      cancelled = true;
    };
  }, [sharedUrl]);

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

  const domain = sharedUrl ? hostname(sharedUrl) : "";
  const cardTitle = saved?.title || preview?.title || null;
  const previewImage = preview?.image;
  const showImage = !!previewImage && !imageFailed;

  return (
    <main className="flex min-h-screen items-center justify-center bg-eco-main px-4 py-10">
      <div className="w-full max-w-md space-y-7">
        <div className="text-center">
          <h1 className="font-display text-2xl text-eco-heading">Grimoire</h1>
          <p className="mt-1.5 font-sans text-body-md text-eco-foreground/75">
            {status === "saved"
              ? "Saved to your library"
              : status === "error"
                ? "Couldn’t save that link"
                : "Saving to your library"}
          </p>
        </div>

        <div className="space-y-6 rounded-xl border border-eco-border-light bg-eco-surface p-7 shadow-eco-sm">
          {sharedUrl && (
            <div className="flex items-center gap-2.5 rounded-lg bg-eco-main px-3 py-2.5">
              <Link2
                className="h-4 w-4 shrink-0 text-eco-foreground/55"
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate font-sans text-body-md text-eco-on-surface">
                {prettyUrl(sharedUrl)}
              </span>
            </div>
          )}

          {/* Link preview — populates once the preview API responds; otherwise
              shows the domain with a globe glyph and skips the thumbnail. */}
          {sharedUrl && (
            <div className="flex items-center gap-3.5 rounded-xl border border-eco-border-subtle bg-eco-surface p-3.5 shadow-eco-sm">
              {showImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={previewImageUrl(previewImage!)}
                  alt=""
                  referrerPolicy="no-referrer"
                  onError={() => setImageFailed(true)}
                  className="h-16 w-16 shrink-0 rounded-lg bg-eco-border/20 object-cover"
                />
              ) : (
                <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-eco-primary/10">
                  <Globe className="h-6 w-6 text-eco-primary/65" aria-hidden />
                </span>
              )}
              <div className="min-w-0 flex-1">
                {cardTitle ? (
                  <p className="line-clamp-2 font-sans text-base font-semibold leading-snug text-eco-heading">
                    {truncate(cardTitle, 90)}
                  </p>
                ) : (
                  <p className="font-sans text-base font-semibold text-eco-heading/60">
                    Reading link…
                  </p>
                )}
                <p className="mt-1 truncate font-sans text-sm text-eco-foreground/65">
                  {domain}
                </p>
              </div>
            </div>
          )}

          {status === "saving" && (
            <div
              role="status"
              aria-live="polite"
              aria-busy="true"
              className="space-y-6"
            >
              <div>
                <p className="font-sans text-label-md font-medium text-eco-secondary">
                  {SAVE_LINK_STEPS[stepIndex].label}…
                </p>
                <p className="mt-2.5 font-sans text-label-md leading-relaxed text-eco-foreground/55">
                  {SAVE_LINK_STEPS[stepIndex].hint} This usually takes 10–30
                  seconds — you can switch away, it&apos;ll keep saving.
                </p>
              </div>

              <ol className="space-y-4">
                {SAVE_LINK_STEPS.map((step, index) => {
                  const done = index < stepIndex;
                  const active = index === stepIndex;
                  return (
                    <li
                      key={step.id}
                      className={cn(
                        "flex items-center gap-3 font-sans text-label-md",
                        done && "font-medium text-eco-on-surface",
                        active && "font-medium text-eco-secondary",
                        !done && !active && "font-normal text-eco-foreground/55",
                      )}
                    >
                      {done ? (
                        <CheckCircle2
                          className="h-5 w-5 shrink-0 text-eco-primary"
                          aria-hidden
                        />
                      ) : active ? (
                        <Loader2
                          className="h-5 w-5 shrink-0 animate-spin text-eco-primary"
                          aria-hidden
                        />
                      ) : (
                        <Circle
                          className="h-5 w-5 shrink-0 text-eco-foreground/25"
                          aria-hidden
                        />
                      )}
                      <span>{step.label}</span>
                    </li>
                  );
                })}
              </ol>
            </div>
          )}

          {status === "saved" && (
            <div className="flex flex-col items-center gap-4 py-2 text-center">
              <svg
                viewBox="0 0 56 56"
                className="h-16 w-16 text-eco-primary"
                fill="none"
                stroke="currentColor"
                xmlns="http://www.w3.org/2000/svg"
                aria-hidden
              >
                <circle
                  className="save-success-circle"
                  cx="28"
                  cy="28"
                  r="25"
                  strokeWidth="3"
                  strokeLinecap="round"
                  transform="rotate(-90 28 28)"
                />
                <path
                  className="save-success-check"
                  d="M17 28.5 L25 36 L39 20"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <div className="save-success-label space-y-1.5">
                <p className="font-display text-2xl text-eco-heading">Saved</p>
                <p className="font-sans text-[15px] text-eco-foreground/55">
                  You can close this tab
                </p>
                {saved?.id && (
                  <Link
                    href={`/item/${saved.id}`}
                    className="inline-block pt-1 font-sans text-body-md font-medium text-eco-secondary transition-colors duration-eco hover:text-eco-primary hover:underline"
                  >
                    View it
                  </Link>
                )}
              </div>
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
