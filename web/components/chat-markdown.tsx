"use client";

import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
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

  return (
    <div className="prose-reading space-y-2 text-body-md [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
      <ReactMarkdown
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
