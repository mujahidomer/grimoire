"use client";

import { useEffect, useState } from "react";
import { ExternalLink, Globe, Loader2 } from "lucide-react";
import { previewImageUrl } from "@/lib/api";
import { getCachedLinkPreview, loadLinkPreview } from "@/lib/preview-cache";
import { SourceBadge } from "@/lib/source-platform";
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
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <p className="font-sans text-label-md font-light uppercase tracking-wide text-eco-foreground/50">
          Saved link
        </p>
        <SourceBadge url={url} />
      </div>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="group block overflow-hidden rounded-xl border border-black/[0.06] bg-white shadow-eco-sm transition-shadow duration-eco hover:shadow-eco"
      >
        <div className="flex flex-col sm:flex-row">
          {showImage ? (
            <div className="h-[200px] w-full shrink-0 self-start overflow-hidden bg-eco-border/20 sm:w-48">
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
            <div className="flex h-[200px] w-full shrink-0 self-start items-center justify-center bg-eco-primary/10 sm:w-48">
              {loading ? (
                <Loader2 className="h-5 w-5 animate-spin text-eco-foreground/40" />
              ) : (
                <Globe className="h-8 w-8 text-eco-primary/50" />
              )}
            </div>
          )}

          <div className="flex min-w-0 flex-1 flex-col justify-center gap-1.5 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate font-sans text-label-md text-eco-foreground/50">
                {siteName}
              </span>
              {type && (
                <Badge variant="default" className="text-[11px]">
                  {formatType(type)}
                </Badge>
              )}
              <ExternalLink className="ml-auto h-3.5 w-3.5 shrink-0 text-eco-foreground/40 transition-colors duration-eco group-hover:text-eco-primary sm:ml-0" />
            </div>

            <h2 className="line-clamp-2 font-sans text-body-md font-semibold leading-snug text-eco-heading transition-colors duration-eco group-hover:text-eco-primary">
              {truncate(title, 120)}
            </h2>

            {description && (
              <p className="prose-reading line-clamp-2 text-body-md text-eco-foreground/70">
                {truncate(description, 140)}
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
