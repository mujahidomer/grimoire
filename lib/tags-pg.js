const { scoreTags, REPLACE_THRESHOLD, FLAG_THRESHOLD } = require('./tags');
const { getTagNames } = require('./repository');

// Postgres-backed tag normalization for the rewired pipeline. The `tags` table
// is now the canonical vocabulary (replacing the Google Sheet Tag Registry), so
// we score freshly-generated tags against the user's existing tag names and
// apply the same thresholds the Sheets path used:
//   - score >= REPLACE_THRESHOLD → adopt the existing canonical tag
//   - FLAG_THRESHOLD <= score    → keep the new tag but append '?' (low-confidence;
//                                   becomes item_tags.confidence_pending downstream)
//   - otherwise                  → brand-new tag, kept verbatim
//
// Returns an array of final tag strings (some ending in '?'), ready to hand to
// repository.upsertItemTags. Resilient: any failure returns the original tags so
// the save still proceeds.
async function normalizeTagsPg(newTags, userId) {
  const tags = (Array.isArray(newTags) ? newTags : [])
    .map(t => (typeof t === 'string' ? t.trim() : ''))
    .filter(Boolean);
  if (tags.length === 0) return [];

  try {
    const existing = await getTagNames(userId);
    if (existing.length === 0) return tags; // empty vocabulary → all new, verbatim

    const scores = await scoreTags(tags, existing);
    return tags.map(tag => {
      const { closest = null, score = 0 } = scores.get(tag.toLowerCase()) || {};
      if (closest && score >= REPLACE_THRESHOLD) return closest;
      if (closest && score >= FLAG_THRESHOLD) return `${tag}?`;
      return tag;
    });
  } catch (err) {
    console.error('Tag normalization (pg) failed:', err.message);
    return tags;
  }
}

module.exports = { normalizeTagsPg };
