// Shared catalog for the pre-auth onboarding funnel: the six segments shown on
// /landing and /seed-picker, and the starter-library items a user can pre-load.
//
// NOTE: only URLs verified live (HTTP 200) at build time are listed here.
// Keep ids in sync with seed-library/catalog.json and the matching
// pre-processed MD files in seed-library/<id>.md (see seed-library/README.md).

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
    id: "ai-charlie-hills-website-workflow",
    segment: "ai",
    title: "Claude Code built my website (9 steps)",
    summary:
      "Charlie Hills' workflow for building a custom site with CONTEXT.md, COPY.md, and DESIGN.md — no AI slop.",
    url: "https://open.substack.com/pub/charliehills/p/claude-code-is-terrible-at-design",
    platform: "article",
  },
  {
    id: "ai-first-agent-reddit-guide",
    segment: "ai",
    title: "Building your first AI agent — a clear path",
    summary:
      "A step-by-step Reddit guide: pick a small problem, wire up the agent loop, add memory, ship an interface.",
    url: "https://oerswwpgrrqcldnqdmff.supabase.co/storage/v1/object/public/uploads/af137d4a-958d-43dd-b88d-0d6dcce8b3f3/1781520027880-feb880de-6da1-483a-b785-4352c507dfb5.jpeg",
    platform: "article",
  },
  {
    id: "ai-instagram-reel-dzpyae8",
    segment: "ai",
    title: "AI tools & workflows (Instagram reel)",
    summary: "Saved AI workflow tip from Instagram.",
    url: "https://instagram.com/reel/DZPyAe8CD5c",
    platform: "article",
  },
  {
    id: "ai-instagram-reel-dzffn",
    segment: "ai",
    title: "AI tools & workflows (Instagram reel)",
    summary: "Saved AI workflow tip from Instagram.",
    url: "https://instagram.com/reel/DZfFn_XuQtw",
    platform: "article",
  },
  {
    id: "ai-instagram-reel-dx9mxyb",
    segment: "ai",
    title: "AI tools & workflows (Instagram reel)",
    summary: "Saved AI workflow tip from Instagram.",
    url: "https://instagram.com/reel/DX9mxYbAXug",
    platform: "article",
  },
  {
    id: "ai-instagram-post-dzmaemc",
    segment: "ai",
    title: "AI tools & workflows (Instagram post)",
    summary: "Saved AI workflow tip from Instagram.",
    url: "https://instagram.com/p/DZMAemcia7Y",
    platform: "article",
  },
  {
    id: "ai-instagram-reel-dwwd3",
    segment: "ai",
    title: "AI tools & workflows (Instagram reel)",
    summary: "Saved AI workflow tip from Instagram.",
    url: "https://instagram.com/reel/DWwD3-3jY-2",
    platform: "article",
  },

  // ── Recipes & cooking ─────────────────────────────────────────────────
  {
    id: "recipes-scrambled-eggs",
    segment: "recipes",
    title: "Gordon Ramsay scrambled eggs technique",
    summary: "The classic technique for creamy, restaurant-quality scrambled eggs.",
    url: "https://www.recipetineats.com/scrambled-eggs/",
    platform: "article",
  },
  {
    id: "recipes-meal-prep",
    segment: "recipes",
    title: "How to meal prep a full week",
    summary: "A practical system for batch-cooking meals that stay fresh all week.",
    url: "https://www.budgetbytes.com/meal-prep-101/",
    platform: "article",
  },
  {
    id: "recipes-carbonara",
    segment: "recipes",
    title: "Binging with Babish: Perfect carbonara",
    summary: "Authentic Roman carbonara — technique, ingredients, and common mistakes.",
    url: "https://www.youtube.com/watch?v=3AAdKl1UYZs",
    platform: "youtube",
  },
  {
    id: "recipes-youtube-3ye8d-rsy8",
    segment: "recipes",
    title: "Three easy ground meat recipes",
    summary:
      "Three simple ground-meat dishes: tortilla casserole, pan-fried chicken with ginger-soy glaze, and a baked meat-and-tortilla bake.",
    url: "https://www.youtube.com/watch?v=3yYE8D_rsy8",
    platform: "youtube",
  },
  {
    id: "recipes-youtube-rm-9cpxrv4a",
    segment: "recipes",
    title: "Baked potato and chicken fillet recipe",
    summary:
      "Seasoned potato-and-egg bake with a cheesy chicken fillet and a quick sour-cream garlic sauce.",
    url: "https://www.youtube.com/watch?v=rm_9cPXrv4A",
    platform: "youtube",
  },
  {
    id: "recipes-instagram-reel-dxb4lhb",
    segment: "recipes",
    title: "Biryani butter — Makhan Market episode 5",
    summary:
      "Compound butter with caramelized onions, garlic, mint, saffron, and biryani masala — for parathas or chicken wraps.",
    url: "https://instagram.com/reel/DXb4lhbBEmN",
    platform: "article",
  },
  {
    id: "recipes-instagram-reel-dzc50u",
    segment: "recipes",
    title: "Science-based Pakistani chicken karahi",
    summary:
      "A technique-first karahi walkthrough: toasting spices, the boonah stage, and yogurt emulsification.",
    url: "https://instagram.com/reel/DZc50UHIW4o",
    platform: "article",
  },

  // ── Islamic content & duas ────────────────────────────────────────────
  {
    id: "islamic-hadith-shaban-forgiveness",
    segment: "islamic",
    title: "Hadith on the Night of Forgiveness (Laylat al-Barā'ah)",
    summary:
      "Allah forgives all creation on the 15th of Sha'bān except the mushrik and mushāhin.",
    url: "https://oerswwpgrrqcldnqdmff.supabase.co/storage/v1/object/public/uploads/af137d4a-958d-43dd-b88d-0d6dcce8b3f3/1781472556385-496b8f14-ef3d-4f01-9aec-365d65a81654.jpeg",
    platform: "article",
  },
  {
    id: "islamic-dua-reference-pdf",
    segment: "islamic",
    title: "The Month of Shaʿbān: A Friday Khutba on Preparation, Fasting, and Forgiveness",
    summary:
      "Khutba on fasting, Qurʾān recitation, and forgiveness in the month before Ramaḍān.",
    url: "https://oerswwpgrrqcldnqdmff.supabase.co/storage/v1/object/public/uploads/af137d4a-958d-43dd-b88d-0d6dcce8b3f3/1781473070682-083c49a0-d36a-4f62-b8cf-1c21ca44600a.pdf",
    platform: "article",
  },
  {
    id: "islamic-forgiveness-repentance",
    segment: "islamic",
    title: "Quranic Description of Jahannam on the Day of Judgment",
    summary: "A reminder on Jahannam and the urgency of repentance before it is too late.",
    url: "https://youtube.com/shorts/P7PXG16ORzE",
    platform: "youtube",
  },
  {
    id: "islamic-protection-laziness-debt",
    segment: "islamic",
    title: "Morning Protection Dua Against Sadness, Grief, and Hardship",
    summary: "A dua seeking protection from sadness, laziness, cowardice, debt, and oppression.",
    url: "https://youtube.com/shorts/tpTyewA0uGM",
    platform: "youtube",
  },
  {
    id: "islamic-surah-qasas-zulm",
    segment: "islamic",
    title: "Quranic Verse on Forgiveness and Repentance",
    summary: "Recitation of the du'a of Prophet Yunus — \"Indeed I have wronged myself, so forgive me.\"",
    url: "https://youtube.com/shorts/l-fxNH8FywM",
    platform: "youtube",
  },
  {
    id: "islamic-parenting-young-children",
    segment: "islamic",
    title: "Teaching Children Allah's Fear Over Parental Fear",
    summary: "Why scaring children with parental threats fails — teach taqwa of Allah instead.",
    url: "https://youtube.com/shorts/otfhS88ULb4",
    platform: "youtube",
  },
  {
    id: "islamic-dawah-speakers-corner",
    segment: "islamic",
    title: "Buddhist vs. Islamic Perspectives on Self-Defense and Harm",
    summary: "A Speakers' Corner exchange on non-harm, self-defense, and protecting family.",
    url: "https://youtube.com/shorts/ClqusiXOxxM",
    platform: "youtube",
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
    url: "https://www.youtube.com/watch?v=nm1TxQj9IsQ",
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
    url: "https://www.youtube.com/watch?v=U0bhE67HuDY",
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
    url: "https://www.youtube.com/watch?v=OP3dA2GcAh8",
    platform: "youtube",
  },
];

export function seedItemsForSegment(segment: SegmentId): SeedItem[] {
  return SEED_ITEMS.filter((item) => item.segment === segment);
}

export const MIN_SEED_SELECTIONS = 2;

export const SEGMENTS_STORAGE_KEY = "grimoire_segments";
export const SEED_SELECTIONS_STORAGE_KEY = "grimoire_seed_selections";

// Best-effort YouTube thumbnail from a watch URL (no API call needed).
export function youtubeThumb(url: string): string | null {
  const m = url.match(/[?&]v=([\w-]+)/);
  return m ? `https://i.ytimg.com/vi/${m[1]}/hqdefault.jpg` : null;
}
