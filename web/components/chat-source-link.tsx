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

const sourceLinkClassName =
  "group flex w-full items-center gap-3 rounded-lg border border-eco-border-subtle bg-eco-input p-2 text-left transition-colors duration-eco hover:border-eco-primary/30 hover:bg-eco-surface dark:hover:bg-eco-hover-strong";

export function ChatSourceLink({
  source,
  onOpenItem,
  onNavigate,
}: {
  source: ChatSource;
  onOpenItem?: (itemId: string) => void;
  onNavigate?: () => void;
}) {
  const site = hostname(source.source_url);

  const inner = (
    <>
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
    </>
  );

  return (
    <Link
      href={`/item/${source.id}`}
      onClick={(e) => {
        if (onOpenItem) {
          e.preventDefault();
          onOpenItem(source.id);
        }
        onNavigate?.();
      }}
      className={sourceLinkClassName}
    >
      {inner}
    </Link>
  );
}
