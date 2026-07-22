require('dotenv').config();
const { getSupabase } = require('../lib/supabase');

const CANONICAL = { dua: 'dua', hadith: 'hadith', quranic_verse: 'quran' };
const TYPES = Object.keys(CANONICAL);

async function main() {
  const sb = getSupabase();
  const { data: items, error } = await sb.from('items').select('id, entities').not('entities', 'is', null);
  if (error) throw error;

  let itemsUpdated = 0, entitiesRewritten = 0;
  for (const item of items) {
    let changed = false;
    const updated = (item.entities || []).map(e => {
      if (!e || !TYPES.includes(e.type)) return e;
      const canonical = CANONICAL[e.type];
      const current = Array.isArray(e.category_path) ? e.category_path : [];
      if (current.length === 1 && current[0] === canonical) return e; // already clean
      changed = true;
      entitiesRewritten++;
      return { ...e, category_path: [canonical] };
    });
    if (!changed) continue;
    const { error: updErr } = await sb.from('items').update({ entities: updated }).eq('id', item.id);
    if (updErr) throw new Error(`update failed for item ${item.id}: ${updErr.message}`);
    itemsUpdated++;
  }
  console.log(`items updated: ${itemsUpdated}, entities rewritten: ${entitiesRewritten}`);
}
main().catch(e => { console.error(e); process.exit(1); });
