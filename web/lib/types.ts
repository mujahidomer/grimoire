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
  title: string;
  category: string;
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
  arabic?: string | null; // dua/hadith
  translation?: string | null; // dua/hadith
  [key: string]: unknown;
}

// One unified, actionable named thing extracted from a save. Stored on
// items.entities. Replaces the old per-type skills/highlights extraction.
export interface Entity {
  type: string; // tool | skill | dua | hadith | book | workflow | resource | ...
  name: string;
  url: string | null;
  category_path: string[]; // broad → specific nesting; may be empty
  detail?: EntityDetail | null;
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
  title?: string;
  count?: number;
  items?: { id: string; title: string; category: string; type: string }[];
  error?: string;
  message?: string;
}

// The 10 fixed categories (from the backend classifier / schema).
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
