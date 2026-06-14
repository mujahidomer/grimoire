import Link from "next/link";
import type { Item } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  artifactEmoji,
  formatDate,
  formatType,
  truncate,
} from "@/lib/utils";

export function ItemCard({ item }: { item: Item }) {
  const visibleTags = item.tags.slice(0, 3);
  const extraTags = item.tags.length - visibleTags.length;
  const hasArtifact = item.artifact_type && item.artifact_type !== "none";

  return (
    <Link href={`/item/${item.id}`} className="group block">
      <Card className="h-full p-6 group-hover:border-indigo-300 group-hover:shadow-sm">
        <div className="flex flex-col gap-3">
          {/* Category · Type + date */}
          <div className="flex items-center justify-between gap-3 text-xs text-slate-400">
            <span className="font-sans">
              {item.category} · {formatType(item.type)}
            </span>
            <span className="font-sans whitespace-nowrap">
              {formatDate(item.date_saved)}
            </span>
          </div>

          {/* Title */}
          <h3 className="font-sans text-lg font-semibold leading-snug text-slate-900 group-hover:text-indigo-700">
            {item.title}
          </h3>

          {/* Summary — first 120 chars, serif */}
          {item.summary && (
            <p className="prose-serif text-sm">
              {truncate(item.summary, 120)}
            </p>
          )}

          {/* Artifact badge */}
          {hasArtifact && (
            <div>
              <Badge variant="indigo">
                {artifactEmoji(item.artifact_type)} {formatType(item.artifact_type)}
                {item.artifact_name ? `: ${item.artifact_name}` : ""}
              </Badge>
            </div>
          )}

          {/* Tags — first 3, +N more */}
          {item.tags.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              {visibleTags.map((tag) => (
                <Badge key={tag.name} variant="default">
                  {tag.name}
                  {tag.confidence_pending && (
                    <span className="text-slate-400">?</span>
                  )}
                </Badge>
              ))}
              {extraTags > 0 && (
                <span className="font-sans text-xs text-slate-400">
                  +{extraTags} more
                </span>
              )}
            </div>
          )}
        </div>
      </Card>
    </Link>
  );
}
