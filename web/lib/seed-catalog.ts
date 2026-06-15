// Shared catalog for the pre-auth onboarding funnel: the six segments shown on
// /landing and /seed-picker, and the starter-library items a user can pre-load.
//
// NOTE: only URLs verified live (HTTP 200) at build time are listed here. Many
// originally-spec'd seed URLs 404'd and were dropped; Recipes currently has no
// live items (its tab renders an empty state) and Islamic has one. Backfill by
// adding entries here AND dropping the matching pre-processed MD file into
// `seed-library/<id>.md` on the backend (see seed-library/README.md).

export type SegmentId =
  | "ai"
  | "recipes"
  | "islamic"
  | "finance"
  | "fitness"
  | "research";

export interface Segment {
  id: SegmentId;
  label: string;
  // Example query pre-filled into the chat bar to drive the first-query beat.
  query: string;
  // Landing-page problem statement — each written with its own rhythm.
  problem: string;
}

export interface SeedItem {
  id: string; // stable slug; the backend reads seed-library/<id>.md
  segment: SegmentId;
  title: string;
  summary: string;
  url: string;
  platform: "youtube" | "article";
}

export const SEGMENTS: Segment[] = [
  {
    id: "ai",
    label: "AI tools & workflows",
    query: "What have I saved about building AI agents?",
    problem:
      "You're saving things constantly — a prompt that worked, a workflow someone shared, a tool you want to try later. But when you're actually mid-project and need that thing? You're scrolling through bookmarks from three months ago hoping you recognise it. Ask Grimoire: what have I saved about building AI agents?",
  },
  {
    id: "recipes",
    label: "Recipes & cooking",
    query: "Show me quick dinner recipes I've saved",
    problem:
      "The recipe was perfect for what you needed — quick, the right ingredients, the right cuisine. You saved it thinking you'd come back. Now you're standing in the kitchen and you can't remember if it was YouTube, Instagram, or that blog. Ask Grimoire: show me pasta recipes I can make in under 30 minutes.",
  },
  {
    id: "islamic",
    label: "Islamic content & duas",
    query: "What have I saved about patience and sabr?",
    problem:
      "A scholar said something that stayed with you. You saved the lecture. Now a conversation comes up and you want to reference it properly — but was it the YouTube video, the podcast, or somewhere else entirely? Ask Grimoire: what have I saved about the virtues of patience?",
  },
  {
    id: "finance",
    label: "Finance & investing",
    query: "What have I saved about dollar-cost averaging?",
    problem:
      "You read the analysis when it came out and it shaped how you were thinking. Now you're making an actual decision and you want to go back to it — but it's buried under weeks of other things you saved. Ask Grimoire: what have I saved about dollar-cost averaging into ETFs?",
  },
  {
    id: "fitness",
    label: "Fitness & health",
    query: "What upper body workouts have I saved?",
    problem:
      "You found a routine that looked right for your goals. Saved it. Then another one. Then a few more. Now you want to train and you have no idea which one you actually decided to follow. Ask Grimoire: show me the upper body workouts I've saved.",
  },
  {
    id: "research",
    label: "Research & articles",
    query: "Summarise everything I've saved this week",
    problem:
      "Your reading list is a graveyard. You saved it because it mattered, and now it's just a number — 47 unread. Grimoire doesn't just save the link. It reads it, structures it, and lets you ask questions across everything you've ever saved.",
  },
];

export const SEGMENT_BY_ID: Record<SegmentId, Segment> = SEGMENTS.reduce(
  (acc, s) => ({ ...acc, [s.id]: s }),
  {} as Record<SegmentId, Segment>,
);

export const DEFAULT_SEGMENT: SegmentId = "ai";

export const SEED_ITEMS: SeedItem[] = [
  // ── AI tools & workflows ──────────────────────────────────────────────
  {
    id: "ai-altman-agents",
    segment: "ai",
    title: "Sam Altman on the future of AI agents",
    summary: "Where autonomous agents are headed and what changes when they work.",
    url: "https://www.youtube.com/watch?v=sal78ACtGTc",
    platform: "youtube",
  },
  {
    id: "ai-karpathy-llms",
    segment: "ai",
    title: "Andrej Karpathy: How LLMs work",
    summary: "A clear mental model of what large language models actually do.",
    url: "https://www.youtube.com/watch?v=zjkBMFhNj_g",
    platform: "youtube",
  },
  {
    id: "ai-dual-llm-pattern",
    segment: "ai",
    title: "The dual LLM pattern for building AI products",
    summary: "Simon Willison on safely separating trusted and untrusted prompts.",
    url: "https://simonwillison.net/2023/Apr/25/dual-llm-pattern/",
    platform: "article",
  },
  {
    id: "ai-first-agent",
    segment: "ai",
    title: "Building your first AI agent from scratch",
    summary: "A hands-on walkthrough of wiring up a working agent loop.",
    url: "https://www.youtube.com/watch?v=fqVLjtvWgq8",
    platform: "youtube",
  },
  {
    id: "ai-prompt-guide",
    segment: "ai",
    title: "Prompt engineering full guide",
    summary: "The techniques that reliably improve model output, end to end.",
    url: "https://www.youtube.com/watch?v=c3b-JASoPi0",
    platform: "youtube",
  },

  // ── Islamic content & duas ────────────────────────────────────────────
  {
    id: "islamic-dua-language",
    segment: "islamic",
    title: "Making dua in your own language — ruling and guidance",
    summary: "IslamQA on whether and how to supplicate in your native tongue.",
    url: "https://islamqa.info/en/answers/9577",
    platform: "article",
  },

  // ── Finance & investing ───────────────────────────────────────────────
  {
    id: "finance-psychology-of-money",
    segment: "finance",
    title: "Morgan Housel: The psychology of money",
    summary: "Why behaviour, not spreadsheets, drives long-term financial outcomes.",
    url: "https://www.collaborativefund.com/blog/the-psychology-of-money/",
    platform: "article",
  },
  {
    id: "finance-simple-portfolio",
    segment: "finance",
    title: "How to build a simple investment portfolio",
    summary: "A low-effort, diversified starting point for long-term investing.",
    url: "https://www.youtube.com/watch?v=gFQNPmLKj1k",
    platform: "youtube",
  },
  {
    id: "finance-just-keep-buying",
    segment: "finance",
    title: "Just keep buying — Nick Maggiulli",
    summary: "The data-backed case for consistent, automatic investing.",
    url: "https://ofdollarsanddata.com/just-keep-buying/",
    platform: "article",
  },

  // ── Fitness & health ──────────────────────────────────────────────────
  {
    id: "fitness-huberman-morning",
    segment: "fitness",
    title: "Andrew Huberman: Morning routine for peak performance",
    summary: "A science-based protocol for energy, focus, and better sleep.",
    url: "https://www.youtube.com/watch?v=IODxDxX7oi4",
    platform: "youtube",
  },
  {
    id: "fitness-israetel-hypertrophy",
    segment: "fitness",
    title: "Mike Israetel: Complete hypertrophy guide",
    summary: "How to actually train for muscle growth, from volume to recovery.",
    url: "https://www.youtube.com/watch?v=vcBig73ojpE",
    platform: "youtube",
  },
  {
    id: "fitness-build-routine",
    segment: "fitness",
    title: "How to build a workout routine from scratch",
    summary: "Turn scattered exercises into a plan you'll actually follow.",
    url: "https://www.youtube.com/watch?v=2tM1LFFxeKg",
    platform: "youtube",
  },

  // ── Research & articles ───────────────────────────────────────────────
  {
    id: "research-pg-think",
    segment: "research",
    title: "Paul Graham: Thinking for yourself",
    summary: "How to find the questions worth thinking independently about.",
    url: "https://www.paulgraham.com/think.html",
    platform: "article",
  },
  {
    id: "research-fs-mental-models",
    segment: "research",
    title: "Farnam Street: The biggest list of mental models",
    summary: "A reference set of frameworks for clearer decision-making.",
    url: "https://fs.blog/mental-models/",
    platform: "article",
  },
  {
    id: "research-pg-writing",
    segment: "research",
    title: "Paul Graham: Writing simply",
    summary: "Why plain writing is clear thinking — and how to get there.",
    url: "https://www.paulgraham.com/writing44.html",
    platform: "article",
  },
  {
    id: "research-ness-notes",
    segment: "research",
    title: "How to take notes that actually help you think",
    summary: "Ness Labs on note systems that compound instead of pile up.",
    url: "https://nesslabs.com/note-taking",
    platform: "article",
  },
  {
    id: "research-second-brain",
    segment: "research",
    title: "How to build a second brain",
    summary: "A method for capturing and resurfacing what you learn.",
    url: "https://www.youtube.com/watch?v=ukLnPbIffxE",
    platform: "youtube",
  },
];

export function seedItemsForSegment(segment: SegmentId): SeedItem[] {
  return SEED_ITEMS.filter((item) => item.segment === segment);
}

// Minimum starter items required to leave the seed-picker. Lowered from 3 to 2
// while Recipes/Islamic tabs are thin (see note at top of file).
export const MIN_SEED_SELECTIONS = 2;

export const SEGMENTS_STORAGE_KEY = "grimoire_segments";
export const SEED_SELECTIONS_STORAGE_KEY = "grimoire_seed_selections";

// Best-effort YouTube thumbnail from a watch URL (no API call needed).
export function youtubeThumb(url: string): string | null {
  const m = url.match(/[?&]v=([\w-]+)/);
  return m ? `https://i.ytimg.com/vi/${m[1]}/hqdefault.jpg` : null;
}
