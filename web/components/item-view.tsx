"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  ExternalLink,
} from "lucide-react";
import type { Item, LinkedResource } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { artifactEmoji, formatDate, formatType, truncate } from "@/lib/utils";
import { RawMarkdownButton } from "@/components/raw-markdown";
import { AddLinkedResource } from "@/components/add-linked-resource";

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-3 font-sans text-label-md font-light uppercase tracking-wide text-eco-foreground/50">
      {children}
    </h2>
  );
}

export function ItemView({ item }: { item: Item }) {
  const [showTranscript, setShowTranscript] = useState(false);
  const [resources, setResources] = useState<LinkedResource[]>(
    item.linked_resources ?? [],
  );

  const hasArtifact = item.artifact_type && item.artifact_type !== "none";
  const hasTranscript = !!(item.transcript && item.transcript.trim());

  return (
    <div className="mx-auto max-w-3xl px-8 py-10">
      <Link
        href="/"
        className="mb-6 inline-flex items-center gap-1.5 font-sans text-body-md text-eco-foreground/70 transition-colors duration-eco hover:text-eco-primary"
      >
        <ArrowLeft className="h-4 w-4" />
        Back
      </Link>

      <article>
        <h1 className="font-display text-[2rem] font-normal leading-tight text-eco-heading">
          {item.title}
        </h1>

        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 font-sans text-body-md text-eco-foreground/70">
          <span>{item.category}</span>
          <span aria-hidden>·</span>
          <span>{formatType(item.type)}</span>
          <span aria-hidden>·</span>
          <span>{formatDate(item.date_saved)}</span>
          {item.source_url && (
            <>
              <span aria-hidden>·</span>
              <a
                href={item.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-eco-secondary transition-colors duration-eco hover:text-eco-primary hover:underline"
              >
                Source <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </>
          )}
        </div>

        {item.tags.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {item.tags.map((tag) =>
              tag.confidence_pending ? (
                <Badge
                  key={tag.name}
                  variant="muted"
                  title="This tag is awaiting confirmation"
                >
                  {tag.name}
                  <span>?</span>
                </Badge>
              ) : (
                <Badge key={tag.name} variant="default">
                  {tag.name}
                </Badge>
              ),
            )}
          </div>
        )}

        {hasArtifact && (
          <div className="mt-5 rounded-xl bg-eco-primary/15 px-4 py-3">
            <p className="font-sans text-body-md text-eco-secondary">
              {artifactEmoji(item.artifact_type)}{" "}
              <span className="font-medium">{formatType(item.artifact_type)}</span>
              {item.artifact_name ? `: ${item.artifact_name}` : ""}
            </p>
            {item.artifact_url && (
              <a
                href={item.artifact_url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-flex items-center gap-1 font-sans text-label-md text-eco-secondary transition-colors duration-eco hover:text-eco-primary hover:underline"
              >
                Open <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
        )}

        <div className="mt-6 flex flex-wrap items-center gap-2">
          <RawMarkdownButton itemId={item.id} />
          <AddLinkedResource itemId={item.id} onAdded={setResources} />
        </div>

        <hr className="my-8 border-black/[0.06]" />

        {item.summary && (
          <section className="mb-10">
            <SectionHeading>Summary</SectionHeading>
            <p className="prose-reading whitespace-pre-wrap text-base">
              {item.summary}
            </p>
          </section>
        )}

        {item.key_takeaways.length > 0 && (
          <section className="mb-10">
            <SectionHeading>Key Takeaways</SectionHeading>
            <ul className="list-disc space-y-2 pl-5">
              {item.key_takeaways.map((t, i) => (
                <li key={i} className="prose-reading text-base">
                  {t}
                </li>
              ))}
            </ul>
          </section>
        )}

        {hasTranscript && (
          <section className="mb-10">
            <button
              onClick={() => setShowTranscript((s) => !s)}
              className="flex items-center gap-1.5 font-sans text-label-md font-light uppercase tracking-wide text-eco-foreground/50 transition-colors duration-eco hover:text-eco-foreground"
            >
              {showTranscript ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
              {showTranscript ? "Hide transcript" : "Show transcript"}
            </button>
            {showTranscript && (
              <p className="prose-reading mt-4 whitespace-pre-wrap text-base">
                {item.transcript}
              </p>
            )}
          </section>
        )}

        {item.caption && (
          <section className="mb-10">
            <SectionHeading>Caption</SectionHeading>
            <p className="prose-reading whitespace-pre-wrap text-base italic">
              {item.caption}
            </p>
          </section>
        )}

        {resources.length > 0 && (
          <section className="mb-10">
            <SectionHeading>Linked Resources</SectionHeading>
            <ul className="space-y-3">
              {resources.map((r) => (
                <li
                  key={r.id ?? r.source_url}
                  className="rounded-xl border border-black/[0.06] bg-white p-4 shadow-eco-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <a
                        href={r.source_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 font-sans text-body-md font-medium text-eco-secondary transition-colors duration-eco hover:text-eco-primary"
                      >
                        {r.title || "Linked resource"}
                        <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                      </a>
                      {r.body_content && (
                        <p className="prose-reading mt-1 text-body-md text-eco-foreground/70">
                          {truncate(r.body_content, 140)}
                        </p>
                      )}
                    </div>
                    <Badge variant="default" className="shrink-0">
                      {formatType(r.type)}
                    </Badge>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </article>
    </div>
  );
}
