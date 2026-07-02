"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  ExternalLink,
} from "lucide-react";
import type { Item, LinkedResource, TakeawayValue } from "@/lib/types";
import {
  isArabicTextKey,
  isPassagesKey,
  isRecipeStepsKey,
  isRecipeTakeaways,
  isSacredPassage,
  isSacredTextTakeaways,
  orderRecipeEntries,
  orderSacredTextEntries,
} from "@/lib/takeaway-formats";
import { Badge } from "@/components/ui/badge";
import { artifactEmoji, formatDate, formatType, truncate } from "@/lib/utils";
import { RawMarkdownButton } from "@/components/raw-markdown";
import { AddLinkedResource } from "@/components/add-linked-resource";
import { DeleteItemButton } from "@/components/delete-item-button";
import { LinkPreviewCard } from "@/components/link-preview-card";
import { ItemDigestRefs } from "@/components/item-digest-refs";
import { MoveCategoryMenu } from "@/components/move-category-menu";

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-3 font-sans text-label-md font-light uppercase tracking-wide text-eco-foreground/65">
      {children}
    </h2>
  );
}

// Safety cap so malformed/deeply-recursive data can never blow the stack.
const MAX_TAKEAWAY_DEPTH = 4;

// Key names that imply order → render their string arrays as numbered lists.
const ORDERED_KEY = /step|process|method|workflow|instruction|how|recipe|sequence/i;

type Primitive = string | number | boolean;
type PlainObject = { [key: string]: TakeawayValue };

function isEmptyTakeaways(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value).length === 0;
  return false;
}

function isPrimitive(v: unknown): v is Primitive {
  return (
    typeof v === "string" || typeof v === "number" || typeof v === "boolean"
  );
}

function isPlainObject(v: unknown): v is PlainObject {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

function prettyKey(key: string): string {
  return key.replace(/[_-]/g, " ");
}

// True when every element is a plain object — render as cards or a table.
function isArrayOfObjects(arr: TakeawayValue[]): arr is PlainObject[] {
  return arr.length > 0 && arr.every(isPlainObject);
}

// True when every object in the array exposes the exact same set of keys —
// uniform shape → a table reads better than cards.
function sharesColumns(arr: PlainObject[]): boolean {
  const cols = Object.keys(arr[0]);
  if (cols.length === 0) return false;
  const sig = cols.slice().sort().join("");
  return arr.every((o) => {
    const k = Object.keys(o);
    return k.length === cols.length && k.slice().sort().join("") === sig;
  });
}

function cellText(v: TakeawayValue): string {
  if (isPrimitive(v)) return String(v);
  if (Array.isArray(v)) return v.map(cellText).join(", ");
  return Object.entries(v)
    .map(([k, val]) => `${prettyKey(k)}: ${cellText(val)}`)
    .join("; ");
}

function formatSacredType(type: unknown): string | null {
  if (typeof type !== "string" || !type.trim()) return null;
  return type.replace(/[_-]/g, " ");
}

function SacredPassageCard({ passage }: { passage: PlainObject }) {
  const arabic = passage.arabic ?? passage.arabic_text;
  const typeLabel = formatSacredType(passage.type);
  const translation = passage.translation;
  const transliteration = passage.transliteration;
  const source = passage.source;

  return (
    <div className="rounded-xl border border-eco-border-subtle bg-eco-surface p-5 shadow-eco-sm">
      {typeLabel && (
        <p className="mb-3 font-sans text-label-md font-medium uppercase tracking-wide text-eco-foreground/65">
          {typeLabel}
        </p>
      )}
      {typeof arabic === "string" && arabic.trim() && (
        <p dir="rtl" lang="ar" className="prose-arabic">
          {arabic.trim()}
        </p>
      )}
      {typeof transliteration === "string" && transliteration.trim() && (
        <p className="mt-3 font-sans text-body-md italic text-eco-foreground/85">
          {transliteration.trim()}
        </p>
      )}
      {typeof translation === "string" && translation.trim() && (
        <p className="mt-3 prose-reading text-base">
          {translation.trim()}
        </p>
      )}
      {typeof source === "string" && source.trim() && (
        <p className="mt-2 font-sans text-label-md text-eco-foreground/65">
          {source.trim()}
        </p>
      )}
    </div>
  );
}

function SacredPassageList({ items }: { items: PlainObject[] }) {
  return (
    <div className="space-y-4">
      {items.map((passage, i) => (
        <SacredPassageCard key={i} passage={passage} />
      ))}
    </div>
  );
}

// Rule 4: array of uniform objects → table (column headers = keys).
function TakeawayTable({ rows }: { rows: PlainObject[] }) {
  const cols = Object.keys(rows[0]);
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-base">
        <thead>
          <tr>
            {cols.map((c) => (
              <th
                key={c}
                className="border-b border-eco-border-emphasis py-2 pr-4 font-sans text-label-md font-medium uppercase tracking-wide text-eco-foreground/65"
              >
                {prettyKey(c)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="align-top">
              {cols.map((c) => (
                <td
                  key={c}
                  className="border-b border-eco-border-subtle py-2 pr-4 prose-reading"
                >
                  {cellText(row[c])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Rule 4: array of non-uniform objects → one card per object.
function TakeawayCards({ items, depth }: { items: PlainObject[]; depth: number }) {
  return (
    <div className="space-y-3">
      {items.map((obj, i) => (
        <div
          key={i}
          className="rounded-xl border border-eco-border-subtle bg-eco-surface p-4 shadow-eco-sm"
        >
          {renderObject(obj, depth + 1)}
        </div>
      ))}
    </div>
  );
}

// Render an array value. Rule 3: array of objects → cards/table. Rule 2: array
// of strings → numbered when the key implies order, bulleted otherwise.
function renderArray(
  arr: TakeawayValue[],
  keyName: string,
  depth: number,
): React.ReactNode {
  const items = arr.filter((v) => !isEmptyTakeaways(v));
  if (items.length === 0) return null;

  if (isArrayOfObjects(items)) {
    if (isPassagesKey(keyName) && items.every(isSacredPassage)) {
      return <SacredPassageList items={items} />;
    }
    return sharesColumns(items) ? (
      <TakeawayTable rows={items} />
    ) : (
      <TakeawayCards items={items} depth={depth} />
    );
  }

  const ordered = ORDERED_KEY.test(keyName) || isRecipeStepsKey(keyName);
  const ListTag = ordered ? "ol" : "ul";
  return (
    <ListTag
      className={`${ordered ? "list-decimal" : "list-disc"} space-y-1.5 pl-5`}
    >
      {items.map((v, i) => (
        <li key={i} className="prose-reading text-base">
          {isPrimitive(v) ? String(v) : renderValue(v, "", depth + 1)}
        </li>
      ))}
    </ListTag>
  );
}

// Render a single value under a known key (or no key, inside a list/card).
function renderValue(
  value: TakeawayValue,
  keyName: string,
  depth: number,
): React.ReactNode {
  if (value == null) return null;
  if (isPrimitive(value)) {
    const text = String(value).trim();
    if (!text) return null;
    if (isArabicTextKey(keyName)) {
      return (
        <p dir="rtl" lang="ar" className="prose-arabic">
          {text}
        </p>
      );
    }
    return <p className="prose-reading text-base">{text}</p>;
  }
  if (depth >= MAX_TAKEAWAY_DEPTH) {
    return <p className="prose-reading text-base">{cellText(value)}</p>;
  }
  if (Array.isArray(value)) return renderArray(value, keyName, depth);
  return renderObject(value, depth);
}

// Rule 5: nested object → keys as smaller, lighter subheadings, block indented.
function renderObject(
  obj: PlainObject,
  depth: number,
  recipeMode = false,
  sacredMode = false,
): React.ReactNode {
  const entries =
    recipeMode && depth === 0
      ? orderRecipeEntries(obj)
      : sacredMode && depth === 0
        ? orderSacredTextEntries(obj)
        : Object.entries(obj).filter(([, v]) => !isEmptyTakeaways(v));
  if (entries.length === 0) return null;

  const topLevel = depth === 0;
  const headingClass = topLevel
    ? "font-sans text-base font-semibold capitalize text-eco-heading"
    : "font-sans text-body-md font-medium capitalize text-eco-foreground/85";

  return (
    <div className={topLevel ? "space-y-6" : "space-y-3 border-l border-eco-border-subtle pl-4"}>
      {entries.map(([key, v]) => (
        <div
          key={key}
          className={
            topLevel
              ? "space-y-2 border-t border-eco-border-subtle pt-4 first:border-t-0 first:pt-0"
              : "space-y-1.5"
          }
        >
          <h3 className={headingClass}>{prettyKey(key)}</h3>
          {renderValue(v, key, depth + 1)}
        </div>
      ))}
    </div>
  );
}

// Entry point. Rule 6: a legacy array (old saves) renders as a plain bulleted
// list. A string renders as a paragraph. Otherwise it's the object form.
function renderTakeaways(
  value: TakeawayValue,
  category?: string,
): React.ReactNode {
  if (isEmptyTakeaways(value)) return null;
  if (typeof value === "string") {
    return <p className="prose-reading text-base">{value.trim()}</p>;
  }
  if (Array.isArray(value)) return renderArray(value, "", 0);
  const recipeMode = isRecipeTakeaways(value, category);
  const sacredMode = !recipeMode && isSacredTextTakeaways(value);
  return renderObject(value, 0, recipeMode, sacredMode);
}

export function ItemView({
  item,
  embedded = false,
}: {
  item: Item;
  embedded?: boolean;
}) {
  // For articles the transcript field holds the full article body (e.g. a
  // Twitter Article pulled in via Jina), so show it expanded and label it
  // accordingly. For video/tweet items it's a supplementary transcript that
  // stays collapsed behind a "Show transcript" toggle.
  const isArticle = item.type?.toLowerCase() === "article";
  const [showTranscript, setShowTranscript] = useState(isArticle);
  const [resources, setResources] = useState<LinkedResource[]>(
    item.linked_resources ?? [],
  );
  const [current, setCurrent] = useState(item);

  const hasArtifact = current.artifact_type && current.artifact_type !== "none";
  const hasTranscript = !!(current.transcript && current.transcript.trim());

  return (
    <div
      className={
        embedded
          ? "px-4 py-5 lg:px-6"
          : "mx-auto max-w-3xl px-4 py-6 lg:px-8 lg:py-10"
      }
    >
      {!embedded ? (
        <Link
          href="/"
          className="mb-6 inline-flex items-center gap-1.5 font-sans text-body-md text-eco-foreground/85 transition-colors duration-eco hover:text-eco-primary"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Link>
      ) : null}

      <article>
        {current.source_url && (
          <LinkPreviewCard
            url={current.source_url}
            fallbackTitle={current.title}
            fallbackDescription={current.summary}
            type={current.type}
          />
        )}

        <h1 className="font-display text-[2rem] font-normal leading-tight text-eco-heading">
          {current.title}
        </h1>

        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 font-sans text-body-md text-eco-foreground/85">
          <span>
            {current.top_category
              ? `${current.top_category} › ${current.category}`
              : current.category}
          </span>
          <span aria-hidden>·</span>
          <span>{formatType(current.type)}</span>
          <span aria-hidden>·</span>
          <span>{formatDate(current.date_saved)}</span>
        </div>

        <div className="mt-2">
          <MoveCategoryMenu item={current} onMoved={setCurrent} />
        </div>

        {current.tags.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {current.tags.map((tag) =>
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
              {artifactEmoji(current.artifact_type)}{" "}
              <span className="font-medium">{formatType(current.artifact_type)}</span>
              {current.artifact_name ? `: ${current.artifact_name}` : ""}
            </p>
            {current.artifact_url && (
              <a
                href={current.artifact_url}
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
          <RawMarkdownButton itemId={current.id} />
          <AddLinkedResource itemId={current.id} onAdded={setResources} />
          <DeleteItemButton itemId={current.id} itemTitle={current.title} />
        </div>

        <hr className="my-8 border-eco-border-subtle" />

        {current.summary && (
          <section className="mb-10">
            <SectionHeading>Summary</SectionHeading>
            <p className="prose-reading whitespace-pre-wrap text-base">
              {current.summary}
            </p>
          </section>
        )}

        {!isEmptyTakeaways(current.key_takeaways) && (
          <section className="mb-10">
            <SectionHeading>Key Takeaways</SectionHeading>
            {renderTakeaways(current.key_takeaways, current.category)}
          </section>
        )}

        {hasTranscript && (
          <section className="mb-10">
            <button
              onClick={() => setShowTranscript((s) => !s)}
              className="flex items-center gap-1.5 font-sans text-label-md font-light uppercase tracking-wide text-eco-foreground/65 transition-colors duration-eco hover:text-eco-foreground"
            >
              {showTranscript ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
              {isArticle
                ? showTranscript
                  ? "Hide full article"
                  : "Full article"
                : showTranscript
                  ? "Hide transcript"
                  : "Show transcript"}
            </button>
            {showTranscript && (
              <p className="prose-reading mt-4 whitespace-pre-wrap text-base">
                {current.transcript}
              </p>
            )}
          </section>
        )}

        {current.caption && (
          <section className="mb-10">
            <SectionHeading>Caption</SectionHeading>
            <p className="prose-reading whitespace-pre-wrap text-base italic">
              {current.caption}
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
                  className="rounded-xl border border-eco-border-subtle bg-eco-surface p-4 shadow-eco-sm"
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
                        <p className="prose-reading mt-1 text-body-md text-eco-foreground/85">
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

        {current.entities && current.entities.length > 0 ? (
          <ItemDigestRefs entities={current.entities} />
        ) : null}
      </article>
    </div>
  );
}
