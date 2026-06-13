const { getSupabase } = require('./supabase');
const { normalizeUrl } = require('./url');

// The structured data-access service for items + tags + linked_resources.
// Everything that reads or writes the core tables goes through here so the
// capture pipeline, the migration script, the retrieval API, and the future MCP
// server all share one code path (Doc A item 5). Every function is user-scoped
// explicitly because the server uses the service-role key (RLS is bypassed).

const VALID_TYPES = ['video', 'article'];
const VALID_ARTIFACT_TYPES = ['skill', 'tool', 'resource', 'person', 'concept', 'none'];
const VALID_RESOURCE_TYPES = ['product', 'article', 'resource'];

function pick(obj, ...keys) {
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null) return obj[k];
  }
  return undefined;
}

// Normalize a heterogeneous input (classifier item OR migration-parsed object)
// into the exact items-table column shape.
function toItemRow(input, userId, source) {
  const typeRaw = String(pick(input, 'type') || '').toLowerCase().trim();
  const type = VALID_TYPES.includes(typeRaw) ? typeRaw : (typeRaw.startsWith('vid') ? 'video' : 'article');

  let artifactType = String(pick(input, 'artifact_type') || 'none').toLowerCase().trim();
  if (!VALID_ARTIFACT_TYPES.includes(artifactType)) artifactType = 'none';

  const takeaways = pick(input, 'key_takeaways', 'keyTakeaways');
  const sourceUrl = normalizeUrl(pick(input, 'source_url', 'sourceUrl'));

  const row = {
    user_id: userId,
    title: pick(input, 'title') || 'Untitled',
    category: pick(input, 'category') || 'Other',
    type,
    source_url: sourceUrl,
    date_saved: pick(input, 'date_saved') || new Date().toISOString().split('T')[0],
    source: source || pick(input, 'source') || 'telegram',
    summary: pick(input, 'summary') || null,
    key_takeaways: Array.isArray(takeaways) ? takeaways : [],
    transcript: pick(input, 'transcript') || null,
    caption: pick(input, 'caption') || null,
    artifact_type: artifactType,
    artifact_name: artifactType !== 'none' ? (pick(input, 'artifact_name') || null) : null,
    artifact_url: artifactType !== 'none' ? normalizeUrl(pick(input, 'artifact_url')) : null,
    artifact_url_source: null,
    drive_file_id: pick(input, 'drive_file_id') || null,
    drive_file_link: pick(input, 'drive_file_link') || null,
    telegram_message_id: pick(input, 'telegram_message_id') || null
  };
  if (row.artifact_url) {
    row.artifact_url_source = pick(input, 'artifact_url_source') || 'content';
  }
  return row;
}

// Upsert one item, keyed on (user_id, source_url). Re-sending the same URL
// updates the row in place rather than duplicating. Returns the row's id.
async function upsertItem(input, { userId, source } = {}) {
  const sb = getSupabase();
  const row = toItemRow(input, userId, source);
  if (!row.source_url) throw new Error('Cannot save an item without a source_url.');

  const { data, error } = await sb
    .from('items')
    .upsert(row, { onConflict: 'user_id,source_url' })
    .select('id')
    .single();
  if (error) throw new Error(`upsertItem failed: ${error.message}`);
  return data.id;
}

// Link tags to an item. Each input tag may carry a trailing '?' low-confidence
// marker → confidence_pending = true (the marker is stripped from the stored
// name). Creates tags rows as needed (Doc A item 2).
async function upsertItemTags(itemId, userId, tagStrings) {
  const sb = getSupabase();
  const tags = (Array.isArray(tagStrings) ? tagStrings : [])
    .map(t => String(t || '').trim())
    .filter(Boolean)
    .map(t => {
      const pending = t.endsWith('?');
      return { name: pending ? t.slice(0, -1).trim() : t, pending };
    })
    .filter(t => t.name);

  if (tags.length === 0) return;

  // Upsert the canonical tag rows, then read back their ids.
  const uniqueNames = [...new Set(tags.map(t => t.name))];
  const { error: tagErr } = await sb
    .from('tags')
    .upsert(uniqueNames.map(name => ({ user_id: userId, name })), {
      onConflict: 'user_id,name',
      ignoreDuplicates: true
    });
  if (tagErr) throw new Error(`tag upsert failed: ${tagErr.message}`);

  const { data: tagRows, error: readErr } = await sb
    .from('tags')
    .select('id, name')
    .eq('user_id', userId)
    .in('name', uniqueNames);
  if (readErr) throw new Error(`tag read failed: ${readErr.message}`);

  const idByName = new Map(tagRows.map(r => [r.name, r.id]));
  const joinRows = tags
    .map(t => ({
      user_id: userId,
      item_id: itemId,
      tag_id: idByName.get(t.name),
      confidence_pending: t.pending
    }))
    .filter(r => r.tag_id);

  if (joinRows.length === 0) return;
  const { error: joinErr } = await sb
    .from('item_tags')
    .upsert(joinRows, { onConflict: 'item_id,tag_id' });
  if (joinErr) throw new Error(`item_tags upsert failed: ${joinErr.message}`);
}

// Upsert linked resources for an item, keyed on (item_id, source_url) — re-sending
// the same URL replaces it, never duplicates (Doc A §linked_resources).
async function upsertLinkedResource(itemId, userId, resource) {
  const sb = getSupabase();
  const sourceUrl = normalizeUrl(pick(resource, 'source_url', 'sourceUrl', 'url'));
  if (!sourceUrl) return null;

  let type = String(pick(resource, 'type', 'resource_type') || 'resource').toLowerCase().trim();
  if (!VALID_RESOURCE_TYPES.includes(type)) type = 'resource';

  const row = {
    user_id: userId,
    item_id: itemId,
    title: pick(resource, 'title') || 'Linked Resource',
    type,
    source_url: sourceUrl,
    added_date: pick(resource, 'added_date') || new Date().toISOString().split('T')[0],
    body_content: pick(resource, 'body_content', 'content') || null
  };

  const { data, error } = await sb
    .from('linked_resources')
    .upsert(row, { onConflict: 'item_id,source_url' })
    .select('id')
    .single();
  if (error) throw new Error(`upsertLinkedResource failed: ${error.message}`);
  return data.id;
}

// ─── Reads (retrieval API + future MCP server) ────────────────────────────────

// List/filter items for a user. Filters: category (exact), tag (exact tag name),
// q (Postgres full-text search over title/summary/transcript/caption). Returns
// structured items with their tag names attached.
async function getItems({ userId, category, tag, q, ids, limit = 100 } = {}) {
  const sb = getSupabase();
  let query = sb
    .from('items')
    .select('*, item_tags(confidence_pending, tags(name))')
    .eq('user_id', userId)
    .order('date_saved', { ascending: false })
    .limit(limit);

  if (category) query = query.eq('category', category);
  if (Array.isArray(ids)) query = query.in('id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']);
  if (q) query = query.textSearch('search_vector', q, { type: 'websearch', config: 'english' });

  const { data, error } = await query;
  if (error) throw new Error(`getItems failed: ${error.message}`);

  let items = (data || []).map(shapeItem);

  // Tag filter is applied in-process: an item matches if it carries the tag.
  if (tag) {
    const t = tag.toLowerCase();
    items = items.filter(it => it.tags.some(x => x.name.toLowerCase() === t));
  }
  return items;
}

// Full single item including tags + linked_resources.
async function getItemById(id, userId) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('items')
    .select('*, item_tags(confidence_pending, tags(name)), linked_resources(*)')
    .eq('user_id', userId)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`getItemById failed: ${error.message}`);
  if (!data) return null;
  return shapeItem(data);
}

// Flatten the nested item_tags/tags join into a clean tags array, and keep
// linked_resources if present.
function shapeItem(row) {
  const tags = (row.item_tags || [])
    .filter(it => it.tags)
    .map(it => ({ name: it.tags.name, confidence_pending: it.confidence_pending }));
  const out = { ...row, tags };
  delete out.item_tags;
  if (row.linked_resources) out.linked_resources = row.linked_resources;
  return out;
}

// Find an item by its (normalized) source_url — used by the Telegram append flow
// to attach a follow-up linked resource to the right existing item.
async function findItemBySourceUrl(userId, url) {
  const sb = getSupabase();
  const sourceUrl = normalizeUrl(url);
  if (!sourceUrl) return null;
  const { data, error } = await sb
    .from('items')
    .select('id, title')
    .eq('user_id', userId)
    .eq('source_url', sourceUrl)
    .maybeSingle();
  if (error) throw new Error(`findItemBySourceUrl failed: ${error.message}`);
  return data || null;
}

// Existing canonical tag names for a user — used by the tag-normalization pass.
async function getTagNames(userId) {
  const sb = getSupabase();
  const { data, error } = await sb.from('tags').select('name').eq('user_id', userId);
  if (error) throw new Error(`getTagNames failed: ${error.message}`);
  return (data || []).map(r => r.name);
}

module.exports = {
  upsertItem,
  upsertItemTags,
  upsertLinkedResource,
  getItems,
  getItemById,
  getTagNames,
  findItemBySourceUrl
};
