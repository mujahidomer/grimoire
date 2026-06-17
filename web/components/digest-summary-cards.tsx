"use client";

import type { LucideIcon } from "lucide-react";
import {
  BookOpen,
  GitBranch,
  Layers,
  Library,
  Lightbulb,
  UtensilsCrossed,
  Wrench,
  Zap,
} from "lucide-react";

export type DigestSummaryCard = {
  type: string;
  label: string;
  rowCount: number;
  lastSavedLabel: string;
};

const ICON_BY_TYPE: Record<string, LucideIcon> = {
  skill: Zap,
  tool: Wrench,
  concept: Lightbulb,
  workflow: GitBranch,
  islamic: BookOpen,
  recipe: UtensilsCrossed,
  resource: Library,
};

function iconForType(type: string): LucideIcon {
  return ICON_BY_TYPE[type] ?? Layers;
}

function scrollToGroup(type: string) {
  document.getElementById(type)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export function DigestSummaryCards({ cards }: { cards: DigestSummaryCard[] }) {
  if (cards.length === 0) return null;

  return (
    <div className="-mx-4 mb-8 overflow-x-auto px-4 scrollbar-thin">
      <div className="flex w-max gap-3">
        {cards.map((card) => {
          const Icon = iconForType(card.type);
          return (
            <button
              key={card.type}
              type="button"
              onClick={() => scrollToGroup(card.type)}
              className="flex w-[140px] shrink-0 flex-col gap-1 rounded-xl border border-eco-border-light bg-eco-surface p-3 text-left transition-colors duration-eco hover:bg-eco-hover"
            >
              <Icon className="h-4 w-4 text-eco-foreground/55" aria-hidden />
              <span className="font-sans text-2xl font-medium leading-none text-eco-on-surface">
                {card.rowCount}
              </span>
              <span className="font-sans text-label-md text-eco-foreground/55">{card.label}</span>
              {card.lastSavedLabel ? (
                <span className="font-sans text-label-md text-eco-foreground/45">
                  {card.lastSavedLabel}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
