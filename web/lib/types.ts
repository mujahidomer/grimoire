// Shapes mirror the verified backend (Doc A). Do not invent fields here.

export interface Tag {
  name: string;
  confidence_pending: boolean;
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
  source: string;
  summary: string | null;
  key_takeaways: string[];
  transcript: string | null;
  caption: string | null;
  artifact_type: string; // skill | tool | resource | person | concept | none
  artifact_name: string | null;
  artifact_url: string | null;
  tags: Tag[];
  linked_resources?: LinkedResource[];
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
