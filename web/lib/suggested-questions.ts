import type { Item } from "@/lib/types";
import { truncate } from "@/lib/utils";

const DEFAULT_QUESTIONS = [
  "Save a link, then ask me to turn it into next steps",
  "What should I try from my recent saves?",
  "Give me a quick action plan from my library",
] as const;

const TITLE_MAX = 40;
const TAKEAWAY_MAX = 50;
const MAX_QUESTIONS = 18;

function shortTitle(title: string) {
  return truncate(title, TITLE_MAX);
}

function shuffle<T>(arr: T[]): T[] {
  const next = [...arr];
  for (let i = next.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
}

function unique(items: string[]) {
  return Array.from(new Set(items));
}

function sortByRecent(items: Item[]) {
  return [...items].sort(
    (a, b) =>
      new Date(b.date_saved).getTime() - new Date(a.date_saved).getTime(),
  );
}

function bestTag(item: Item) {
  return item.tags.find((t) => !t.confidence_pending)?.name ?? item.tags[0]?.name;
}

function artifactQuestions(item: Item, title: string): string[] {
  const name = item.artifact_name;
  if (!name || item.artifact_type === "none") return [];

  switch (item.artifact_type) {
    case "tool":
      return [
        `How do I get started with ${name}?`,
        `Is ${name} worth trying based on "${title}"?`,
      ];
    case "skill":
      return [`How do I set up the ${name} skill from my save?`];
    case "concept":
      return [
        `Break down ${name} into steps I can try today`,
        `What's the simplest way to apply ${name}?`,
      ];
    case "person":
      return [`What practical advice did ${name} share in "${title}"?`];
    case "resource":
      return [`Where can I access ${name} from what I saved?`];
    default:
      return [];
  }
}

function categoryQuestions(item: Item, title: string, tag?: string): string[] {
  switch (item.category) {
    case "Food & Cooking":
      return [`What's the recipe or technique in "${title}"?`];
    case "Technology":
      return tag
        ? [`What's my saved workflow for ${tag}?`]
        : [`What's the setup process in "${title}"?`];
    case "Health & Fitness":
      return [`What routine from "${title}" should I try this week?`];
    case "Finance":
      return [`What money move does "${title}" suggest?`];
    case "Learning & Education":
      return tag
        ? [`What should I practice next for ${tag}?`]
        : [`Turn "${title}" into a short study checklist`];
    case "Business & Career":
      return [`What can I apply at work from "${title}"?`];
    case "Travel":
      return [`What trip tips from "${title}" are worth using?`];
    case "Personal Development":
      return [`What one habit from "${title}" should I start?`];
    case "Entertainment":
      return [`What stood out as worth remembering in "${title}"?`];
    default:
      return tag ? [`Give me a quick playbook for ${tag}`] : [];
  }
}

function takeawayQuestion(item: Item): string | null {
  const takeaway = item.key_takeaways.find((t) => t.trim().length > 12);
  if (!takeaway) return null;
  return `How do I actually do this: ${truncate(takeaway, TAKEAWAY_MAX)}`;
}

function formatQuestions(item: Item): string[] {
  const title = shortTitle(item.title);
  const tag = bestTag(item);
  const out: string[] = [];

  out.push(...artifactQuestions(item, title));
  out.push(...categoryQuestions(item, title, tag));

  const takeaway = takeawayQuestion(item);
  if (takeaway) out.push(takeaway);

  if (item.type === "video") {
    out.push(`What steps does the "${title}" video walk through?`);
  } else {
    out.push(`Pull the action items from "${title}"`);
  }

  if (item.linked_resources && item.linked_resources.length > 0) {
    out.push(`What useful links were attached to "${title}"?`);
  }

  return unique(out);
}

function pickBestForItem(item: Item): string[] {
  const ranked = formatQuestions(item);
  return ranked.slice(0, 2);
}

function topTags(items: Item[], limit = 3) {
  const counts = new Map<string, number>();
  for (const item of items) {
    for (const tag of item.tags) {
      if (tag.confidence_pending) continue;
      counts.set(tag.name, (counts.get(tag.name) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name]) => name);
}

function savedThisWeek(items: Item[]) {
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  return items.filter((item) => new Date(item.date_saved).getTime() >= weekAgo);
}

function libraryQuestions(items: Item[]): string[] {
  const recent = sortByRecent(items);
  const thisWeek = savedThisWeek(items);
  const out: string[] = [];

  if (thisWeek.length > 0) {
    out.push("What are 3 things from this week I should actually try?");
    if (thisWeek.length >= 2) {
      out.push("Which of my recent saves is most worth acting on?");
    }
  }

  for (const tag of topTags(items)) {
    const tagged = items.filter((item) =>
      item.tags.some((t) => t.name === tag && !t.confidence_pending),
    );
    if (tagged.length >= 2) {
      out.push(`Give me a playbook from everything I saved on ${tag}`);
    } else {
      out.push(`What's the one thing to try from my ${tag} saves?`);
    }
  }

  const tools = unique(
    items
      .filter((item) => item.artifact_type === "tool" && item.artifact_name)
      .map((item) => item.artifact_name as string),
  );
  if (tools.length >= 2) {
    out.push(`Should I use ${tools[0]} or ${tools[1]} for my next project?`);
  } else if (tools.length === 1) {
    out.push(`How do I put ${tools[0]} to work from my saves?`);
  }

  const categories = unique(recent.slice(0, 6).map((item) => item.category));
  for (const category of categories.slice(0, 2)) {
    const inCategory = items.filter((item) => item.category === category);
    if (inCategory.length >= 2) {
      out.push(`What are the top things to try from my ${category} saves?`);
    }
  }

  const paired = recent.slice(0, 4);
  for (let i = 0; i < paired.length - 1; i++) {
    if (paired[i].category !== paired[i + 1].category) continue;
    const a = shortTitle(paired[i].title);
    const b = shortTitle(paired[i + 1].title);
    out.push(`Which should I try first: "${a}" or "${b}"?`);
  }

  return unique(out);
}

export function buildSuggestedQuestions(items: Item[]): string[] {
  if (items.length === 0) return [...DEFAULT_QUESTIONS];

  const recent = sortByRecent(items).slice(0, 6);
  const perItem = recent.flatMap(pickBestForItem);
  const library = libraryQuestions(items);

  const generated = unique([...perItem, ...library]);
  if (generated.length === 0) return [...DEFAULT_QUESTIONS];

  return shuffle(generated).slice(0, MAX_QUESTIONS);
}
