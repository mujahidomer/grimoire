"use client";

import Link from "next/link";
import type { ChatSource } from "@/lib/types";
import { SourceThumbnail } from "@/components/source-thumbnail";

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function ChatSourceLink({
  source,
  onNavigate,
}: {
  source: ChatSource;
  onNavigate?: () => void;
}) {
  const site = hostname(source.source_url);

  return (
    <Link
      href={`/item/${source.id}`}
      onClick={onNavigate}
      className="group flex items-center gap-3 rounded-lg border border-black/[0.06] bg-white/60 p-2 transition-colors duration-eco hover:border-eco-primary/30 hover:bg-white"
    >
      <SourceThumbnail
        url={source.source_url}
        className="h-12 w-16 shrink-0 rounded-md"
        iconClassName="h-4 w-4"
      />

      <div className="min-w-0 flex-1">
        <p className="truncate font-sans text-body-md font-medium text-eco-secondary transition-colors duration-eco group-hover:text-eco-primary">
          {source.title}
        </p>
        {site && (
          <p className="truncate font-sans text-label-md text-eco-foreground/75">
            {site}
          </p>
        )}
      </div>
    </Link>
  );
}
