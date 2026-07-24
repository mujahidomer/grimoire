// Fill meta_category on canonical_entities rows that still have none.
//
// The save path (lib/entityResolution.js insertNew) now sets meta_category on
// every new row, so this is only for the rows created before that landed. It
// runs the SAME lib/entityMetaCategories.resolveMetaCategory() the save path
// uses — approved table first, Haiku on a miss, null when nothing in the
// closed per-type list fits — so a row this script leaves null is a row the
// pipeline would also leave null.
//
// DRY RUN BY DEFAULT. It prints what it would set and writes nothing. Pass
// --write to actually update canonical_entities (id-scoped updates of the
// meta_category column only; nothing else is touched, and rows that resolve to
// null are skipped rather than rewritten).
//
//   node scripts/entity-meta-category-backfill.js            # dry run
//   node scripts/entity-meta-category-backfill.js --write    # apply

require('dotenv').config();
const { getSupabase } = require('../lib/supabase');
const { resolveMetaCategory } = require('../lib/entityMetaCategories');

const WRITE = process.argv.includes('--write');

async function main() {
  const sb = getSupabase();
  const { data: rows, error } = await sb
    .from('canonical_entities')
    .select('id, entity_type, canonical_name, category_path, description')
    .is('meta_category', null)
    .order('entity_type', { ascending: true })
    .order('canonical_name', { ascending: true });
  if (error) throw new Error(`select failed: ${error.message}`);

  console.log(`${WRITE ? 'WRITE' : 'DRY RUN'} — rows with meta_category = null: ${rows.length}\n`);

  let resolved = 0, stillNull = 0, written = 0;
  for (const row of rows) {
    const meta = await resolveMetaCategory(row.entity_type, {
      name: row.canonical_name,
      description: row.description,
      categoryPath: row.category_path
    });
    const path = (row.category_path || []).join(' > ') || '(none)';
    if (!meta) {
      stillNull++;
      console.log(`  [${row.entity_type}] "${row.canonical_name}" [${path}] -> (none fit, stays null)`);
      continue;
    }
    resolved++;
    console.log(`  [${row.entity_type}] "${row.canonical_name}" [${path}] -> ${meta}`);
    if (!WRITE) continue;
    const { error: updateError } = await sb
      .from('canonical_entities')
      .update({ meta_category: meta })
      .eq('id', row.id);
    if (updateError) throw new Error(`update failed for "${row.canonical_name}": ${updateError.message}`);
    written++;
  }

  console.log(`\nresolved: ${resolved}, left null: ${stillNull}, rows written: ${WRITE ? written : 0}`);
  if (!WRITE && resolved > 0) console.log('Nothing was written — re-run with --write to apply.');
}

main().catch(e => { console.error(e); process.exit(1); });
