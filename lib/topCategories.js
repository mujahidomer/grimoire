// The closed list of 13 top-level categories. This is the single source of
// truth — the classifier prompt, the save pipeline, the recategorize endpoint,
// the consolidation pass, and the backfill script all validate against it.
// The LLM never invents new top-level categories; anything outside this list
// clamps to 'Other'.
const TOP_CATEGORIES = [
  'Technology & AI',
  'Business & Finance',
  'Health & Wellness',
  'Personal Development',
  'Relationships & Family',
  'Religion & Spirituality',
  'Food & Cooking',
  'Travel',
  'Home & Lifestyle',
  'Arts & Entertainment',
  'Education & Learning',
  'News & Politics',
  'Other'
];

// Where a manually-moved item lands within its new top_category (created on
// first use by convention — subcategories are free-text on items, so "creating"
// General is just writing the string).
const DEFAULT_SUBCATEGORY = 'General';

const CANONICAL_BY_LOWER = new Map(TOP_CATEGORIES.map(c => [c.toLowerCase(), c]));

// Clamp a raw value to the closed list (case-insensitive, tolerant of
// surrounding whitespace and "and" vs "&"). Returns the canonical spelling,
// or null when the value doesn't match — callers decide the fallback
// ('Other' after classification, null for not-yet-classified rows).
function normalizeTopCategory(value) {
  if (typeof value !== 'string') return null;
  const cleaned = value.trim().replace(/\s+/g, ' ');
  if (!cleaned) return null;
  return (
    CANONICAL_BY_LOWER.get(cleaned.toLowerCase()) ||
    CANONICAL_BY_LOWER.get(cleaned.toLowerCase().replace(/\band\b/g, '&').replace(/\s+/g, ' ')) ||
    null
  );
}

// Normalize a free-text topic subcategory label for storage/display:
// collapse whitespace, Title Case each word (preserving existing all-caps
// acronyms like "AI"), cap the length. Returns null for empty/garbage input.
function normalizeSubcategoryLabel(value) {
  if (typeof value !== 'string') return null;
  const cleaned = value.trim().replace(/\s+/g, ' ').slice(0, 40);
  if (!cleaned) return null;
  return cleaned
    .split(' ')
    .map(w => (w === w.toUpperCase() && w.length > 1 ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

module.exports = { TOP_CATEGORIES, DEFAULT_SUBCATEGORY, normalizeTopCategory, normalizeSubcategoryLabel };
