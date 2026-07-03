// The closed list of top-level categories. Historically hardcoded here; it is
// now DB-driven (table: top_categories) with the list below kept as the SEED +
// FALLBACK. Callers read the live list through getTopCategories() /
// getTopCategoryRecords(); the seed guarantees classification, validation, and
// the dashboard keep working when the DB is unreachable or the migration has
// not been applied yet. The LLM never invents new top-level categories; anything
// outside the current list clamps to 'Other'.
//
// To add a category (e.g. "Automotive"): insert a row into top_categories and
// call refreshTopCategories() (the server warms this at startup). No code change
// and no redeploy required once the table exists.

const SEED_TOP_CATEGORIES = [
  { name: 'Technology & AI', emoji: '💻' },
  { name: 'Business & Finance', emoji: '💰' },
  { name: 'Health & Wellness', emoji: '💪' },
  { name: 'Personal Development', emoji: '🌱' },
  { name: 'Relationships & Family', emoji: '👨‍👩‍👧' },
  { name: 'Religion & Spirituality', emoji: '🕌' },
  { name: 'Food & Cooking', emoji: '🍳' },
  { name: 'Travel', emoji: '✈️' },
  { name: 'Home & Lifestyle', emoji: '🏠' },
  { name: 'Arts & Entertainment', emoji: '🎬' },
  { name: 'Education & Learning', emoji: '📚' },
  { name: 'News & Politics', emoji: '📰' },
  { name: 'Other', emoji: '📁' },
];

// Where a manually-moved item lands within its new top_category (created on
// first use by convention — subcategories are free-text on items, so "creating"
// General is just writing the string).
const DEFAULT_SUBCATEGORY = 'General';

// "Technology & AI" -> "technology-ai". Mirror of slugifyTopCategory in the
// web frontend (web/lib/types.ts) — keep the two in sync.
function slugifyTopCategory(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/&/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Coerce a seed entry or DB row into a full, display-ready record.
function toRecord(row, index) {
  return {
    name: row.name,
    slug: row.slug || slugifyTopCategory(row.name),
    emoji: row.emoji || '📁',
    sort_order: row.sort_order != null ? row.sort_order : index,
  };
}

// In-memory cache, seeded so synchronous callers (normalizeTopCategory, prompt
// building) work before — and independently of — any DB load.
let cache = [];
let cacheByLower = new Map();

function setCache(records) {
  cache = records;
  cacheByLower = new Map();
  for (const r of records) cacheByLower.set(r.name.toLowerCase(), r.name);
}

setCache(SEED_TOP_CATEGORIES.map(toRecord));

// Full records (name, slug, emoji, sort_order) in display order. Sync — returns
// whatever is currently cached (seed until refreshTopCategories() succeeds).
function getTopCategoryRecords() {
  return cache;
}

// Just the canonical names, in display order.
function getTopCategories() {
  return cache.map(r => r.name);
}

// Back-compat: some modules imported TOP_CATEGORIES as a static array of names.
// It reflects the SEED order and never changes at runtime; prefer
// getTopCategories() anywhere the live (DB) list matters.
const TOP_CATEGORIES = SEED_TOP_CATEGORIES.map(r => r.name);

// Reload the cache from the top_categories table. Never throws: on any failure
// (table missing, DB down, empty table) the last-known/seed cache is retained,
// so the caller always has a usable list. Returns the resulting records.
async function refreshTopCategories() {
  try {
    const { getSupabase } = require('./supabase');
    const sb = getSupabase();
    const { data, error } = await sb
      .from('top_categories')
      .select('name, slug, emoji, sort_order, is_active')
      .eq('is_active', true)
      .order('sort_order', { ascending: true });
    if (error) throw error;
    if (Array.isArray(data) && data.length > 0) {
      setCache(data.map(toRecord));
    }
    return cache;
  } catch (_err) {
    // Keep the current cache (seed or last successful load).
    return cache;
  }
}

// Clamp a raw value to the current closed list (case-insensitive, tolerant of
// surrounding whitespace and "and" vs "&"). Returns the canonical spelling, or
// null when the value doesn't match — callers decide the fallback ('Other'
// after classification, null for not-yet-classified rows).
function normalizeTopCategory(value) {
  if (typeof value !== 'string') return null;
  const cleaned = value.trim().replace(/\s+/g, ' ');
  if (!cleaned) return null;
  return (
    cacheByLower.get(cleaned.toLowerCase()) ||
    cacheByLower.get(cleaned.toLowerCase().replace(/\band\b/g, '&').replace(/\s+/g, ' ')) ||
    null
  );
}

// Normalize a free-text topic subcategory label for storage/display: collapse
// whitespace, Title Case each word (preserving existing all-caps acronyms like
// "AI"), cap the length. Returns null for empty/garbage input.
function normalizeSubcategoryLabel(value) {
  if (typeof value !== 'string') return null;
  const cleaned = value.trim().replace(/\s+/g, ' ').slice(0, 40);
  if (!cleaned) return null;
  return cleaned
    .split(' ')
    .map(w => (w === w.toUpperCase() && w.length > 1 ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

module.exports = {
  TOP_CATEGORIES,
  SEED_TOP_CATEGORIES,
  DEFAULT_SUBCATEGORY,
  slugifyTopCategory,
  getTopCategories,
  getTopCategoryRecords,
  refreshTopCategories,
  normalizeTopCategory,
  normalizeSubcategoryLabel,
};
