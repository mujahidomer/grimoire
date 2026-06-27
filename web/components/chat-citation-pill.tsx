"use client";

import Link from "next/link";
import { ExternalLink } from "lucide-react";

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
