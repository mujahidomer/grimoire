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
      <Card className="h-full p-8 shadow-eco-lg transition-shadow duration-eco group-hover:shadow-eco">
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3 text-label-md text-eco-primary/60">
            <span className="font-sans">
              {item.category} · {formatType(item.type)}
            </span>
            <span className="whitespace-nowrap font-sans">
              {formatDate(item.date_saved)}
            </span>
          </div>

          <h3 className="font-display text-xl font-light leading-snug text-eco-inverse transition-colors duration-eco group-hover:text-eco-primary">
            {item.title}
          </h3>

          {item.summary && (
            <p className="prose-reading text-body-md text-eco-primary/70">
              {truncate(item.summary, 120)}
            </p>
          )}

          {hasArtifact && (
            <div>
              <Badge variant="accent">
                {artifactEmoji(item.artifact_type)} {formatType(item.artifact_type)}
                {item.artifact_name ? `: ${item.artifact_name}` : ""}
              </Badge>
            </div>
          )}

          {item.tags.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              {visibleTags.map((tag) => (
                <Badge key={tag.name} variant="default" className="bg-eco-secondary/15">
                  {tag.name}
                  {tag.confidence_pending && (
                    <span className="text-eco-primary/50">?</span>
                  )}
                </Badge>
              ))}
              {extraTags > 0 && (
                <span className="font-sans text-label-md text-eco-primary/50">
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
