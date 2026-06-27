"use client";

import { useState } from "react";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import type { ChatSource } from "@/lib/types";

const MAX_LABEL = 20;

function truncateLabel(title: string): string {
  const t = title.trim();
  if (t.length <= MAX_LABEL) return t;
  return `${t.slice(0, MAX_LABEL - 1)}…`;
}

function childText(children: React.ReactNode): string {
  if (typeof children === "string") return children;
  if (typeof children === "number") return String(children);
  if (Array.isArray(children)) return children.map(childText).join("");
  if (children && typeof children === "object" && "props" in children) {
    return childText((children as React.ReactElement).props.children);
  }
  return "";
}

const pillClassName =
  "mx-0.5 inline-flex max-w-[calc(20ch+1.25rem)] items-center gap-1 rounded-full border border-eco-border-subtle bg-[var(--eco-badge-bg)] px-2 py-0.5 align-middle font-sans text-label-md leading-none text-eco-secondary no-underline ring-1 ring-inset ring-[var(--eco-badge-border)] transition-colors duration-eco hover:border-eco-primary/30 hover:bg-eco-surface hover:text-eco-primary dark:hover:bg-eco-hover-strong";

export function ChatCitationPill({
  itemId,
  href,
  children,
  onOpenItem,
  onNavigate,
}: {
  itemId?: string;
  href?: string;
  children: React.ReactNode;
  onOpenItem?: (itemId: string) => void;
  onNavigate?: () => void;
}) {
  const title = childText(children);
  const label = truncateLabel(title);

  const inner = (
    <>
      <span className="truncate">{label}</span>
      <ExternalLink className="h-3 w-3 shrink-0 opacity-60" aria-hidden />
    </>
  );

  if (!itemId) {
    return (
      <span
        className={`${pillClassName} cursor-default opacity-70`}
        title={title}
      >
        {inner}
      </span>
    );
  }

  const targetHref = href ?? `/item/${itemId}`;

  return (
    <Link
      href={targetHref}
      onClick={(e) => {
        if (onOpenItem) {
          e.preventDefault();
          onOpenItem(itemId);
        }
        onNavigate?.();
      }}
      title={title}
      className={pillClassName}
    >
      {inner}
    </Link>
  );
}

// How many sources show before collapsing into a "+N more" toggle.
const FROM_VISIBLE = 2;

const refClassName =
  "rounded font-sans text-label-md text-eco-secondary underline decoration-eco-secondary/40 underline-offset-2 transition-colors duration-eco hover:text-eco-primary hover:decoration-eco-primary";

function CitationRef({
  source,
  onOpenItem,
  onNavigate,
}: {
  source: ChatSource;
  onOpenItem?: (itemId: string) => void;
  onNavigate?: () => void;
}) {
  const label = truncateLabel(source.title);

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
      title={source.title}
      className={refClassName}
    >
      {label}
    </Link>
  );
}

// Per-claim attribution line rendered ABOVE the paragraph or bullet it sources.
// Shows the first FROM_VISIBLE titles, then a tappable "+N more" that expands
// the rest inline. Replaces the old mid-prose citation chips.
export function ChatCitationLine({
  sources,
  onOpenItem,
  onNavigate,
}: {
  sources: ChatSource[];
  onOpenItem?: (itemId: string) => void;
  onNavigate?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  if (sources.length === 0) return null;

  const visible = expanded ? sources : sources.slice(0, FROM_VISIBLE);
  const hidden = sources.length - visible.length;

  return (
    <div className="mb-1 flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 leading-snug">
      <span className="font-sans text-label-md font-light uppercase tracking-wide text-eco-foreground/65">
        From:
      </span>
      {visible.map((s, i) => (
        <span key={s.id} className="inline-flex items-baseline">
          <CitationRef source={s} onOpenItem={onOpenItem} onNavigate={onNavigate} />
          {i < visible.length - 1 ? (
            <span className="text-eco-foreground/45">,</span>
          ) : null}
        </span>
      ))}
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="rounded font-sans text-label-md text-eco-foreground/55 underline decoration-dotted underline-offset-2 transition-colors duration-eco hover:text-eco-primary"
        >
          +{hidden} more
        </button>
      )}
    </div>
  );
}
