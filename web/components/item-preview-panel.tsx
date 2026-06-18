"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ExternalLink, Loader2, X } from "lucide-react";
import { fetchItem } from "@/lib/api";
import type { Item } from "@/lib/types";
import { ItemView } from "@/components/item-view";
import { Button } from "@/components/ui/button";

export function ItemPreviewPanel({
  itemId,
  onClose,
}: {
  itemId: string;
  onClose: () => void;
}) {
  const [item, setItem] = useState<Item | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    setItem(null);

    fetchItem(itemId)
      .then((next) => {
        if (!cancelled) setItem(next);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [itemId]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-eco-overlay/80"
        onClick={onClose}
        aria-hidden
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Saved item preview"
        className="fixed bottom-0 right-0 z-50 flex h-[min(92dvh,100%)] w-full max-w-xl flex-col rounded-t-2xl border-t border-eco-border-subtle bg-eco-surface shadow-2xl sm:rounded-none sm:border-l sm:border-t-0 lg:h-full lg:max-h-none"
      >
        <div className="flex justify-center pt-2 lg:hidden" aria-hidden>
          <div className="h-1 w-10 rounded-full bg-black/10" />
        </div>

        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-eco-border-light px-4 py-3">
          <span className="font-display text-lg text-eco-heading">Saved item</span>
          <div className="flex items-center gap-1">
            <Link
              href={`/item/${itemId}`}
              className="inline-flex h-8 items-center gap-1.5 rounded-surface px-3 font-sans text-body-md font-medium text-eco-foreground transition-colors duration-eco hover:bg-eco-primary/10"
            >
              Open full page
              <ExternalLink className="h-3.5 w-3.5" />
            </Link>
            <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close preview">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
          {loading ? (
            <div className="flex items-center justify-center gap-2 px-4 py-16 text-eco-foreground/65">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="font-sans text-body-md">Loading…</span>
            </div>
          ) : error ? (
            <p className="px-4 py-16 font-sans text-body-md text-eco-foreground/65">
              Couldn&apos;t load this item.{" "}
              <Link
                href={`/item/${itemId}`}
                className="text-eco-primary underline-offset-2 hover:underline"
              >
                Open full page
              </Link>
            </p>
          ) : item ? (
            <ItemView item={item} embedded />
          ) : null}
        </div>
      </aside>
    </>
  );
}
