"use client";

import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChatSource } from "@/lib/types";
import { linkifyCitations } from "@/lib/linkify-citations";
import { ChatCitationPill } from "@/components/chat-citation-pill";

const externalLinkClassName =
  "font-medium text-eco-secondary underline decoration-eco-secondary/50 underline-offset-2 transition-colors duration-eco hover:text-eco-primary hover:decoration-eco-primary";

export function ChatMarkdown({
  content,
  sources = [],
  onSourceNavigate,
}: {
  content: string;
  sources?: ChatSource[];
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
    <div className="chat-md prose-reading space-y-2 text-body-md [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="leading-relaxed">{children}</p>,
          strong: ({ children }) => (
            <strong className="font-semibold text-eco-secondary">
              {children}
            </strong>
          ),
          em: ({ children }) => <em className="italic">{children}</em>,
          ol: ({ children }) => (
            <ol className="list-decimal space-y-2 pl-5">{children}</ol>
          ),
          ul: ({ children }) => (
            <ul className="list-disc space-y-2 pl-5">{children}</ul>
          ),
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
          a: ({ href, children }) => {
            // Inline source citation emitted as [Title](cite:item_id). Resolve
            // the id to the saved source so the chip carries the real title/URL.
            if (href?.startsWith("cite:")) {
              const id = href.slice("cite:".length);
              const source = sourceById.get(id);
              if (source) {
                return (
                  <ChatCitationPill
                    href={`/item/${source.id}`}
                    onNavigate={onSourceNavigate}
                  >
                    {source.title}
                  </ChatCitationPill>
                );
              }
              return (
                <ChatCitationPill pending onNavigate={onSourceNavigate}>
                  {children}
                </ChatCitationPill>
              );
            }

            if (href?.startsWith("#cite-")) {
              return (
                <ChatCitationPill pending onNavigate={onSourceNavigate}>
                  {children}
                </ChatCitationPill>
              );
            }

            if (href?.startsWith("/item/")) {
              return (
                <ChatCitationPill href={href} onNavigate={onSourceNavigate}>
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
