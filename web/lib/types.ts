// Shapes mirror the verified backend (Doc A). Do not invent fields here.

// keyTakeaways is a free-form JSON value the classifier invents per item:
// a string, an array, or a nested object. Legacy items hold a string[].
export type TakeawayValue =
  | string
  | TakeawayValue[]
  | { [key: string]: TakeawayValue };

export interface Tag {
  name: string;
  confidence_pending: boolean;
}

export interface LinkPreview {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  site_name: string | null;
}

export interface LinkedResource {
  id: string;
  title: string;
  type: string; // product | article | resource ...
  source_url: string;
  added_date?: string;
  body_content?: string | null;
}

export interface Item {
  id: string;
  // Background save pipeline: pending → processing → completed | failed.
  // Absent on legacy rows — treat as completed.
  status?: "pending" | "processing" | "completed" | "failed";
  title: string;
  // Free-text topic subcategory under top_category (e.g. "Prompt Engineering").
  // Historically this held the item's whole category; it is now the specific
  // subcategory label, scoped by top_category below.
  category: string;
  // One of the 13 fixed TOP_CATEGORIES, or null for items not yet
  // backfilled/classified into the new hierarchy.
  top_category: string | null;
  // True once a user has explicitly moved this item to a top_category
  // (via the recategorize endpoint), overriding the classifier's pick.
  category_manually_set?: boolean;
  type: string; // 'video' | 'article'
  source_url: string;
  date_saved: string;
  created_at: string;
  updated_at?: string;
  source: string;
  summary: string | null;
  key_takeaways: TakeawayValue;
  transcript: string | null;
  caption: string | null;
  artifact_type: string; // skill | tool | resource | person | concept | none
  artifact_name: string | null;
  artifact_url: string | null;
  tags: Tag[];
  linked_resources?: LinkedResource[];
  entities?: Entity[] | null;
}

// One artifact row in the Library Digest. A trimmed projection of Item — only
// the columns the digest table renders, plus tags for the "What it is" column.
// One extracted skill/tool from a skill-type save. Populated by the classifier
// and stored on items.skills; present only for artifact_type === "skill".
export interface Skill {
  name: string;
  what_it_does: string | null;
  install_command: string | null;
  source_url: string | null;
}

// One at-a-glance highlight distilled by the classifier. Stored inside
// items.key_takeaways.highlights; present on non-skill artifact types only.
export interface Highlight {
  label: string;
  value: string;
}

// Type-specific extras on an entity. Open-ended (the classifier may invent
// types), but the fields the dashboard reads are named explicitly.
export interface EntityDetail {
  command?: string | null; // skill: the / command
  what_it_does?: string | null; // skill/tool: one-liner
  arabic?: string | null; // dua/hadith/quranic_verse
  translation?: string | null; // dua/hadith/quranic_verse
  source?: string | null; // dua/hadith/quranic_verse: reference
  transliteration?: string | null; // quranic_verse: romanized pronunciation
  when_to_use?: string | null; // dua: when to recite
  [key: string]: unknown;
}

// One unified, actionable named thing extracted from a save. Stored on
// items.entities. Replaces the old per-type skills/highlights extraction.
export interface Entity {
  type: string; // tool | skill | dua | hadith | quranic_verse | book | workflow | resource | ...
  name: string;
  url: string | null;
  category_path: string[]; // broad → specific nesting; may be empty
  detail?: EntityDetail | null;
  hidden?: boolean; // when true, hidden from the digest view (reversible)
}

export interface DigestItem {
  id: string;
  title: string;
  artifact_type: string;
  artifact_name: string | null;
  artifact_url: string | null;
  skills?: Skill[] | null;
  entities?: Entity[] | null;
  key_takeaways?: TakeawayValue;
  source_url: string;
  date_saved: string;
  category: string;
  data_version?: string | null;
  subcategory?: string | null;
  tags: Tag[];
}

// The digest is now a flat list of items carrying entities; the dashboard
// flattens, dedupes, and groups by entity.type client-side.
export interface DigestResponse {
  items: DigestItem[];
}

export interface ChatSource {
  id: string;
  title: string;
  source_url: string;
}

export interface ChatResponse {
  answer: string;
  sources: ChatSource[];
  empty: boolean;
}

export interface SaveResponse {
  success: boolean;
  id?: string;
  // Present on the fast /api/save ack: 'pending' while extraction/classification
  // are still running in the background. title/count/items reflect the older
  // synchronous shape and are absent from that ack (unknown until processing
  // finishes) — callers should treat them as optional.
  status?: "pending" | "processing" | "completed" | "failed";
  title?: string;
  count?: number;
  items?: { id: string; title: string; category: string; type: string }[];
  error?: string;
  message?: string;
}

// Legacy: the 10 fixed categories from the old flat classifier/schema. Kept
// untouched — some code still imports this — but new code should use
// TOP_CATEGORIES, the 13-value hierarchical top-level list, instead.
export const CATEGORIES = [
  "Food & Cooking",
  "Technology",
  "Health & Fitness",
  "Finance",
  "Learning & Education",
  "Entertainment",
  "Travel",
  "Business & Career",
  "Personal Development",
  "Other",
] as const;

// The 13 fixed top-level categories in the new hierarchical category model.
// Closed list — exact order and spelling matter, they mirror the backend.
// Item.category is now a free-text topic subcategory nested under one of these.
export const TOP_CATEGORIES = [
  "Technology & AI",
  "Business & Finance",
  "Health & Wellness",
  "Personal Development",
  "Relationships & Family",
  "Religion & Spirituality",
  "Food & Cooking",
  "Travel",
  "Home & Lifestyle",
  "Arts & Entertainment",
  "Education & Learning",
  "News & Politics",
  "Other",
] as const;

export type TopCategory = (typeof TOP_CATEGORIES)[number];

// "Technology & AI" -> "technology-ai". Lowercase, '&' dropped, any run of
// non-alphanumeric characters collapsed to a single hyphen, trimmed.
export function slugifyTopCategory(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const SLUG_TO_TOP_CATEGORY = new Map<string, TopCategory>(
  TOP_CATEGORIES.map((name) => [slugifyTopCategory(name), name]),
);

// Reverse lookup for /home/[categorySlug] routes against the BUILT-IN list.
// Returns null for an unrecognized slug. This is now the static fallback used
// when the live (DB-driven) list can't be fetched; prefer resolving against
// fetchTopCategories() so DB-added categories resolve too.
export function topCategoryFromSlug(slug: string): TopCategory | null {
  return SLUG_TO_TOP_CATEGORY.get(slug) ?? null;
}

// One row from GET /api/top-categories — the data-driven top-level category
// list. name is canonical, slug matches slugifyTopCategory(name).
export interface TopCategoryRecord {
  name: string;
  slug: string;
  emoji: string;
  sort_order: number;
}

// One row in GET /api/dashboard's categories array — one per top_category,
// always all 13 in TOP_CATEGORIES order.
export interface DashboardCategorySummary {
  top_category: string;
  count: number;
  latest: { id: string; title: string; created_at: string } | null;
}

export interface DashboardResponse {
  categories: DashboardCategorySummary[];
  recent: Item[];
}

// One row in GET /api/subcategories?top_category=... — topic subcategories
// within a top_category, sorted by count desc.
export interface SubcategorySummary {
  name: string;
  count: number;
  latest_created_at: string;
}

export interface SubcategoriesResponse {
  top_category: string;
  subcategories: SubcategorySummary[];
}

// One proposed/applied merge group from POST /api/subcategories/consolidate.
export interface SubcategoryMerge {
  from: string[];
  to: string;
  itemCount: number;
}

export interface SubcategoryMergeGroup {
  top_category: string;
  merges: SubcategoryMerge[];
}

export interface ConsolidateSubcategoriesResponse {
  applied: boolean;
  groups: SubcategoryMergeGroup[];
  totalUpdated: number;
  warnings: string[];
}
