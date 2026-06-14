"use client";

import { useEffect, useState } from "react";
import { ExternalLink, Globe, Loader2 } from "lucide-react";
import { previewImageUrl } from "@/lib/api";
import { getCachedLinkPreview, loadLinkPreview } from "@/lib/preview-cache";
import type { LinkPreview } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { formatType, truncate } from "@/lib/utils";

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function LinkPreviewCard({
  url,
  fallbackTitle,
  fallbackDescription,
  type,
}: {
  url: string;
  fallbackTitle?: string;
  fallbackDescription?: string | null;
  type?: string;
}) {
  const [preview, setPreview] = useState<LinkPreview | null>(
    () => getCachedLinkPreview(url) ?? null,
  );
  const [loading, setLoading] = useState(() => !getCachedLinkPreview(url));
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    const cached = getCachedLinkPreview(url);
    if (cached) {
      setPreview(cached);
      setLoading(false);
      setImageFailed(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setImageFailed(false);
    loadLinkPreview(url)
      .then((data) => {
        if (!cancelled) setPreview(data);
      })
      .catch(() => {
        if (!cancelled) setPreview(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  const title = preview?.title || fallbackTitle || hostname(url);
  const description = preview?.description || fallbackDescription;
  const image = preview?.image;
  const showImage = !!image && !imageFailed;
  const siteName = preview?.site_name || hostname(url);

  return (
    <section className="mb-8">
      <p className="mb-3 font-sans text-label-md font-light uppercase tracking-wide text-eco-foreground/50">
        Saved link
      </p>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="group block overflow-hidden rounded-xl border border-black/[0.06] bg-white shadow-eco-sm transition-shadow duration-eco hover:shadow-eco"
      >
        <div className="flex flex-col sm:flex-row">
          {showImage ? (
            <div className="h-44 w-full shrink-0 overflow-hidden bg-eco-border/20 sm:h-auto sm:w-48 sm:min-h-[120px]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={previewImageUrl(image!)}
                alt=""
                referrerPolicy="no-referrer"
                onError={() => setImageFailed(true)}
                className="h-full w-full object-cover"
              />
            </div>
          ) : (
            <div className="flex h-44 w-full shrink-0 items-center justify-center bg-eco-primary/10 sm:h-auto sm:w-48 sm:min-h-[120px]">
              {loading ? (
                <Loader2 className="h-5 w-5 animate-spin text-eco-foreground/40" />
              ) : (
                <Globe className="h-8 w-8 text-eco-primary/50" />
              )}
            </div>
          )}

          <div className="flex min-w-0 flex-1 flex-col justify-center gap-1.5 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-sans text-label-md text-eco-foreground/50">
                {siteName}
              </span>
              {type && (
                <Badge variant="default" className="text-[11px]">
                  {formatType(type)}
                </Badge>
              )}
              <ExternalLink className="ml-auto h-3.5 w-3.5 shrink-0 text-eco-foreground/40 transition-colors duration-eco group-hover:text-eco-primary sm:ml-0" />
            </div>

            <h2 className="font-sans text-body-md font-semibold leading-snug text-eco-heading transition-colors duration-eco group-hover:text-eco-primary">
              {title}
            </h2>

            {description && (
              <p className="prose-reading line-clamp-3 text-body-md text-eco-foreground/70">
                {truncate(description, 220)}
              </p>
            )}

            <p className="truncate font-mono text-[11px] text-eco-foreground/40">
              {url}
            </p>
          </div>
        </div>
      </a>
    </section>
  );
}
