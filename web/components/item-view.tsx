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
    <h2 className="mb-3 font-sans text-sm font-semibold uppercase tracking-wide text-slate-400">
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
    <div className="min-h-screen">
      {/* Breadcrumb */}
      <header className="sticky top-0 z-20 border-b border-slate-100 bg-white/80 backdrop-blur">
        <div className="mx-auto max-w-3xl px-4 py-4 sm:px-6">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 font-sans text-sm text-slate-500 hover:text-indigo-600"
          >
            <ArrowLeft className="h-4 w-4" />
            Library
          </Link>
        </div>
      </header>

      <article className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        {/* Title */}
        <h1 className="font-sans text-3xl font-semibold leading-tight text-slate-900">
          {item.title}
        </h1>

        {/* Metadata row */}
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 font-sans text-sm text-slate-500">
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
                className="inline-flex items-center gap-1 text-indigo-600 hover:underline"
              >
                Source <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </>
          )}
        </div>

        {/* Tags — all shown; pending ones muted with a ? and tooltip */}
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

        {/* Artifact block — subtle */}
        {hasArtifact && (
          <div className="mt-5 rounded-lg bg-indigo-50/60 px-4 py-3">
            <p className="font-sans text-sm text-indigo-900">
              {artifactEmoji(item.artifact_type)}{" "}
              <span className="font-medium">{formatType(item.artifact_type)}</span>
              {item.artifact_name ? `: ${item.artifact_name}` : ""}
            </p>
            {item.artifact_url && (
              <a
                href={item.artifact_url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-flex items-center gap-1 font-sans text-xs text-indigo-600 hover:underline"
              >
                Open <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="mt-6 flex flex-wrap items-center gap-2">
          <RawMarkdownButton itemId={item.id} />
          <AddLinkedResource itemId={item.id} onAdded={setResources} />
        </div>

        <hr className="my-8 border-slate-100" />

        {/* Summary */}
        {item.summary && (
          <section className="mb-10">
            <SectionHeading>Summary</SectionHeading>
            <p className="prose-serif whitespace-pre-wrap text-base">
              {item.summary}
            </p>
          </section>
        )}

        {/* Key Takeaways */}
        {item.key_takeaways.length > 0 && (
          <section className="mb-10">
            <SectionHeading>Key Takeaways</SectionHeading>
            <ul className="list-disc space-y-2 pl-5">
              {item.key_takeaways.map((t, i) => (
                <li key={i} className="prose-serif text-base">
                  {t}
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Transcript — collapsible, collapsed by default */}
        {hasTranscript && (
          <section className="mb-10">
            <button
              onClick={() => setShowTranscript((s) => !s)}
              className="flex items-center gap-1.5 font-sans text-sm font-semibold uppercase tracking-wide text-slate-400 hover:text-slate-600"
            >
              {showTranscript ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
              {showTranscript ? "Hide transcript" : "Show transcript"}
            </button>
            {showTranscript && (
              <p className="prose-serif mt-4 whitespace-pre-wrap text-base">
                {item.transcript}
              </p>
            )}
          </section>
        )}

        {/* Caption — only if non-null */}
        {item.caption && (
          <section className="mb-10">
            <SectionHeading>Caption</SectionHeading>
            <p className="prose-serif whitespace-pre-wrap text-base italic">
              {item.caption}
            </p>
          </section>
        )}

        {/* Linked Resources — only if non-empty */}
        {resources.length > 0 && (
          <section className="mb-10">
            <SectionHeading>Linked Resources</SectionHeading>
            <ul className="space-y-3">
              {resources.map((r) => (
                <li
                  key={r.id ?? r.source_url}
                  className="rounded-lg border border-slate-200 p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <a
                        href={r.source_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 font-sans text-sm font-medium text-slate-900 hover:text-indigo-600"
                      >
                        {r.title || "Linked resource"}
                        <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                      </a>
                      {r.body_content && (
                        <p className="prose-serif mt-1 text-sm text-slate-500">
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
