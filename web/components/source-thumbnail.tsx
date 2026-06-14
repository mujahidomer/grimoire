"use client";

import { useEffect, useState } from "react";
import { FileText, Loader2 } from "lucide-react";
import { previewImageUrl } from "@/lib/api";
import { getCachedThumbnail, loadThumbnail } from "@/lib/preview-cache";
import { getYouTubeThumbnail } from "@/lib/youtube";
import { cn } from "@/lib/utils";

function initialImage(url: string): string | null {
  const cached = getCachedThumbnail(url);
  if (cached !== undefined) return cached;
  return getYouTubeThumbnail(url);
}

function initiallyLoading(url: string): boolean {
  return getCachedThumbnail(url) === undefined && !getYouTubeThumbnail(url);
}

export function SourceThumbnail({
  url,
  className,
  iconClassName,
}: {
  url: string;
  className?: string;
  iconClassName?: string;
}) {
  const [image, setImage] = useState<string | null>(() => initialImage(url));
  const [loading, setLoading] = useState(() => initiallyLoading(url));
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    const cached = getCachedThumbnail(url);
    if (cached !== undefined) {
      setImage(cached);
      setLoading(false);
      setImageFailed(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setImageFailed(false);
    loadThumbnail(url)
      .then((next) => {
        if (!cancelled) setImage(next);
      })
      .catch(() => {
        if (!cancelled) setImage(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  const showImage = !!image && !imageFailed;

  return (
    <div className={cn("overflow-hidden bg-eco-border/20", className)}>
      {showImage ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={previewImageUrl(image!)}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => setImageFailed(true)}
          className="h-full w-full object-cover"
        />
      ) : loading ? (
        <div className="flex h-full w-full items-center justify-center">
          <Loader2 className="h-4 w-4 animate-spin text-eco-foreground/30" />
        </div>
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-eco-primary/10">
          <FileText className={cn("h-5 w-5 text-eco-primary/50", iconClassName)} />
        </div>
      )}
    </div>
  );
}
