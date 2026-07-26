// One-off cleanup for the citation entities that predate the cited-source guard
// (classifier.js dropCitationEntities, 2026-07-26).
//
// The "Graph Engineering vs Loop Engineering" save had a linked resource whose
// "Sources" section was mined as three `resource` entities — an X post, an X
// article, and a Medium essay. They are citations, not things to go use, and
// because social links are never valid canonical URLs they could never have
// resolved a link either: permanently bare Digest rows.
//
// Backs up every row it touches before writing, mirroring the 2026-07-24 URL
// batch. Idempotent: re-running after a successful pass finds nothing to do.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { getSupabase } = require('../lib/supabase');

const TARGETS = [
  { entity_type: 'resource', canonical_name: "Steinberger's loops-or-graphs post" },
  { entity_type: 'resource', canonical_name: 'Hamel Husain: Loop Engineering Is Dead' },
  { entity_type: 'resource', canonical_name: 'Carlos E. Perez: From Loop to Graph Engineering essay' },
];

const nameKey = (t, n) => `${t}::${n.toLowerCase().trim()}`;
const TARGET_KEYS = new Set(TARGETS.map(t => nameKey(t.entity_type, t.canonical_name)));

const APPLY = process.argv.includes('--apply');

(async () => {
  const sb = getSupabase();
  const backup = { at: new Date().toISOString(), items: [], canonical_entities: [] };

  // 1. Every item whose entities blob still carries one of the targets.
  const { data: items, error: itemsErr } = await sb
    .from('items').select('id, user_id, title, entities').not('entities', 'is', null);
  if (itemsErr) throw new Error(`items read failed: ${itemsErr.message}`);

  const edits = [];
  for (const item of items || []) {
    const entities = Array.isArray(item.entities) ? item.entities : [];
    const kept = entities.filter(e => !(e && TARGET_KEYS.has(nameKey(e.type, String(e.name || '')))));
    if (kept.length === entities.length) continue;
    backup.items.push({ id: item.id, user_id: item.user_id, title: item.title, entities });
    edits.push({ item, kept, removed: entities.length - kept.length });
  }

  // 2. The canonical rows themselves.
  const { data: rows, error: rowsErr } = await sb
    .from('canonical_entities')
    .select('*')
    .in('canonical_name', TARGETS.map(t => t.canonical_name));
  if (rowsErr) throw new Error(`canonical read failed: ${rowsErr.message}`);
  const doomed = (rows || []).filter(r => TARGET_KEYS.has(nameKey(r.entity_type, r.canonical_name)));
  backup.canonical_entities = doomed.map(({ embedding, ...rest }) => rest); // embedding is huge and re-derivable

  console.log(`items to edit: ${edits.length}`);
  for (const e of edits) console.log(`  ${e.item.id}  -${e.removed}  ${e.item.title}`);
  console.log(`canonical rows to delete: ${doomed.length}`);
  for (const r of doomed) console.log(`  [${r.entity_type}] ${r.canonical_name}  (mentions=${r.mention_count})`);

  if (!APPLY) {
    console.log('\nDRY RUN — re-run with --apply to write.');
    return;
  }

  const backupPath = path.join(__dirname, 'backups', `citation-entities-${Date.now()}.json`);
  fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2));
  console.log(`\nbackup → ${backupPath}`);

  for (const { item, kept } of edits) {
    const { error } = await sb.from('items').update({ entities: kept }).eq('id', item.id);
    if (error) throw new Error(`item ${item.id} update failed: ${error.message}`);
  }
  for (const r of doomed) {
    const { error } = await sb.from('canonical_entities').delete().eq('id', r.id);
    if (error) throw new Error(`canonical ${r.id} delete failed: ${error.message}`);
  }

  // 3. Verify on a fresh read.
  const { data: after } = await sb
    .from('canonical_entities').select('id').in('canonical_name', TARGETS.map(t => t.canonical_name));
  const { data: itemsAfter } = await sb
    .from('items').select('id, entities').in('id', edits.map(e => e.item.id));
  const stragglers = (itemsAfter || []).flatMap(i =>
    (i.entities || []).filter(e => e && TARGET_KEYS.has(nameKey(e.type, String(e.name || '')))));

  console.log(`\nverified: ${(after || []).length} canonical rows remain (want 0), ${stragglers.length} item references remain (want 0)`);
  if ((after || []).length || stragglers.length) process.exitCode = 1;
})().catch(err => { console.error('FAILED:', err.message); process.exit(1); });
