require('dotenv').config();
const { getSupabase } = require('../lib/supabase');

// ── Fix 1: stray un-rewritten duplicates found in full-scope audit ──
// { type, rawName, canonicalName, categoryPath }
const STRAY_FIXES = [
  { type: 'tool', rawName: 'Higgsfield', canonicalName: 'Higgs Field MCP and CLI', categoryPath: ['video generation'] },
  { type: 'tool', rawName: 'gstack', canonicalName: 'G-Stack', categoryPath: ['coding assistant'] },
  { type: 'tool', rawName: 'Whisper', canonicalName: 'Faster Whisper', categoryPath: ['audio tools'] },
  { type: 'skill', rawName: 'frontend-design', canonicalName: 'Anthropic Front-End Design Skill', categoryPath: ['ui/frontend design skills'] },
  { type: 'skill', rawName: 'taste-skill', canonicalName: 'taste-skill-v1', categoryPath: ['ui/frontend design skills'] },
];

async function main() {
  const sb = getSupabase();

  // ── Fix 2: taste-skill v2 mis-merge — move it out of "Anthropic Front-End
  // Design Skill" and into "taste-skill-v1" where it belongs. ──
  const { data: anthropicRow, error: e1 } = await sb.from('canonical_entities')
    .select('*').eq('entity_type', 'skill').eq('canonical_name', 'Anthropic Front-End Design Skill').single();
  if (e1) throw e1;
  const { data: tasteRow, error: e2 } = await sb.from('canonical_entities')
    .select('*').eq('entity_type', 'skill').eq('canonical_name', 'taste-skill-v1').single();
  if (e2) throw e2;

  if (anthropicRow.aliases.includes('taste-skill v2')) {
    const newAnthropicAliases = anthropicRow.aliases.filter(a => a !== 'taste-skill v2');
    const { error } = await sb.from('canonical_entities').update({
      aliases: newAnthropicAliases,
      mention_count: anthropicRow.mention_count - 1,
    }).eq('id', anthropicRow.id);
    if (error) throw error;
    console.log(`Fixed cluster "Anthropic Front-End Design Skill": removed "taste-skill v2", mention_count ${anthropicRow.mention_count} -> ${anthropicRow.mention_count - 1}`);

    const newTasteAliases = [...tasteRow.aliases, 'taste-skill v2'];
    const { error: e3 } = await sb.from('canonical_entities').update({
      aliases: newTasteAliases,
      mention_count: tasteRow.mention_count + 1,
    }).eq('id', tasteRow.id);
    if (e3) throw e3;
    console.log(`Fixed cluster "taste-skill-v1": added "taste-skill v2", mention_count ${tasteRow.mention_count} -> ${tasteRow.mention_count + 1}`);
  } else {
    console.log('taste-skill v2 mis-merge already fixed or not present — skipping.');
  }

  // ── Rewrite the item whose entity currently reads name="Anthropic Front-End
  // Design Skill", raw_name="taste-skill v2" — point it at the correct cluster. ──
  const { data: allItems, error: e4 } = await sb.from('items').select('id, entities').not('entities', 'is', null);
  if (e4) throw e4;

  // itemId -> [{ type, matchName (current name to find), newName, newCategoryPath, isRawNameMatch }]
  const rewrites = new Map();
  function record(itemId, entry) {
    if (!rewrites.has(itemId)) rewrites.set(itemId, []);
    rewrites.get(itemId).push(entry);
  }

  for (const item of allItems) {
    for (const e of item.entities || []) {
      if (!e) continue;
      if (e.type === 'skill' && e.name === 'Anthropic Front-End Design Skill' && e.raw_name === 'taste-skill v2') {
        record(item.id, { type: 'skill', matchOn: 'raw_name', matchValue: 'taste-skill v2', newName: 'taste-skill-v1', newCategoryPath: ['ui/frontend design skills'] });
      }
    }
  }

  // ── Fix 1: stray un-rewritten duplicates — find every remaining live
  // occurrence of each raw alias name and rewrite it too. ──
  for (const fix of STRAY_FIXES) {
    for (const item of allItems) {
      for (const e of item.entities || []) {
        if (e && e.type === fix.type && e.name === fix.rawName) {
          record(item.id, { type: fix.type, matchOn: 'name', matchValue: fix.rawName, newName: fix.canonicalName, newCategoryPath: fix.categoryPath, rawNameToSet: fix.rawName });
        }
      }
    }
  }

  console.log(`\nItems needing rewrite: ${rewrites.size}`);
  let itemsUpdated = 0;
  const mentionBumps = new Map(); // "type::canonicalName" -> count of newly-added mentions

  for (const [itemId, itemRewrites] of rewrites.entries()) {
    const { data: itemRow, error: fetchErr } = await sb.from('items').select('entities').eq('id', itemId).single();
    if (fetchErr) throw fetchErr;
    const current = Array.isArray(itemRow.entities) ? itemRow.entities : [];
    let changed = false;
    const updated = current.map(e => {
      if (!e) return e;
      const match = itemRewrites.find(rw =>
        rw.type === e.type && (rw.matchOn === 'raw_name' ? e.raw_name === rw.matchValue : e.name === rw.matchValue)
      );
      if (!match) return e;
      changed = true;
      const next = { ...e, name: match.newName, category_path: match.newCategoryPath };
      if (match.rawNameToSet) next.raw_name = match.rawNameToSet;
      const key = `${match.type}::${match.newName}`;
      mentionBumps.set(key, (mentionBumps.get(key) || 0) + (match.matchOn === 'name' ? 1 : 0)); // taste-skill-v1 bump already applied above, don't double count
      return next;
    });
    if (!changed) continue;
    const { error: updateErr } = await sb.from('items').update({ entities: updated }).eq('id', itemId);
    if (updateErr) throw new Error(`update failed for item ${itemId}: ${updateErr.message}`);
    itemsUpdated++;
  }
  console.log(`items updated: ${itemsUpdated}`);

  // Bump mention_count on the target canonical rows for the newly-swept-in stray instances.
  for (const [key, count] of mentionBumps.entries()) {
    if (count === 0) continue;
    const [type, canonicalName] = key.split('::');
    const { data: row, error } = await sb.from('canonical_entities').select('id, mention_count')
      .eq('entity_type', type).eq('canonical_name', canonicalName).single();
    if (error) throw error;
    const { error: updErr } = await sb.from('canonical_entities').update({ mention_count: row.mention_count + count }).eq('id', row.id);
    if (updErr) throw updErr;
    console.log(`"${canonicalName}" (${type}) mention_count ${row.mention_count} -> ${row.mention_count + count} (+${count} newly-swept stray instances)`);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
