"use client";

import { useMemo } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChatSource } from "@/lib/types";
import { linkifyCitations } from "@/lib/linkify-citations";
import { ChatCitationPill } from "@/components/chat-citation-pill";

const externalLinkClassName =
  "font-medium text-eco-secondary underline decoration-eco-secondary/50 underline-offset-2 transition-colors duration-eco hover:text-eco-primary hover:decoration-eco-primary";

function chatUrlTransform(url: string): string {
  if (
    url.startsWith("/item/") ||
    url.startsWith("#cite-") ||
    url.startsWith("cite:")
  ) {
    return url;
  }
  return defaultUrlTransform(url);
}

function sourceIndexFromHref(href: string): number | null {
  if (!href.startsWith("#cite-")) return null;
  const n = parseInt(href.slice("#cite-".length), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function ChatMarkdown({
  content,
  sources = [],
  onOpenItem,
  onSourceNavigate,
}: {
  content: string;
  sources?: ChatSource[];
  onOpenItem?: (itemId: string) => void;
  onSourceNavigate?: () => void;
}) {
  const linked = useMemo(
    () => linkifyCitations(content, sources),
    [content, sources],
  );

  const sourceById = useMemo(() => {
    const map = new Map<string, ChatSource>();
    for (const s of sources) map.set(s.id, s);
    return map;
  }, [sources]);

  return (
    <div className="chat-md prose-reading space-y-3 text-body-md [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={chatUrlTransform}
        components={{
          p: ({ children }) => <p className="leading-relaxed">{children}</p>,
          strong: ({ children }) => (
            <strong className="font-extrabold text-eco-heading">{children}</strong>
          ),
          em: ({ children }) => <em className="italic">{children}</em>,
          ol: ({ children }) => (
            <ol className="mb-1 list-decimal space-y-2.5 pl-5">{children}</ol>
          ),
          ul: ({ children }) => (
            <ul className="mb-1 list-disc space-y-2.5 pl-5">{children}</ul>
          ),
          li: ({ children }) => (
            <li className="leading-relaxed [&>p]:mb-0 [&>p:first-child>strong:first-child:not(:has(a,button))]:mb-0.5 [&>p:first-child>strong:first-child:not(:has(a,button))]:block [&>p:first-child>strong:first-child:not(:has(a,button))]:font-extrabold [&>p:first-child>strong:first-child:not(:has(a,button))]:text-eco-heading [&>strong:first-child:not(:has(a,button))]:mb-0.5 [&>strong:first-child:not(:has(a,button))]:block [&>strong:first-child:not(:has(a,button))]:font-extrabold [&>strong:first-child:not(:has(a,button))]:text-eco-heading">
              {children}
            </li>
          ),
          a: ({ href, children }) => {
            // Inline source citation emitted as [Title](cite:item_id). Resolve
            // the id to the saved source so the chip carries the real title/URL.
            if (href?.startsWith("cite:")) {
              const id = href.slice("cite:".length);
              const source = sourceById.get(id);
              return (
                <ChatCitationPill
                  itemId={id}
                  onOpenItem={onOpenItem}
                  onNavigate={onSourceNavigate}
                >
                  {source?.title ?? children}
                </ChatCitationPill>
              );
            }

            if (href?.startsWith("#cite-")) {
              const index = sourceIndexFromHref(href);
              const source =
                index != null ? sources[index - 1] : undefined;
              return (
                <ChatCitationPill
                  itemId={source?.id}
                  onOpenItem={onOpenItem}
                  onNavigate={onSourceNavigate}
                >
                  {source?.title ?? children}
                </ChatCitationPill>
              );
            }

            if (href?.startsWith("/item/")) {
              const itemId = href.slice("/item/".length);
              return (
                <ChatCitationPill
                  itemId={itemId}
                  onOpenItem={onOpenItem}
                  onNavigate={onSourceNavigate}
                >
                  {children}
                </ChatCitationPill>
              );
            }

            return (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className={externalLinkClassName}
              >
                {children}
              </a>
            );
          },
        }}
      >
        {linked}
      </ReactMarkdown>
    </div>
  );
}
