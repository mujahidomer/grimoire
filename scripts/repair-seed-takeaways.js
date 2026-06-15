#!/usr/bin/env node
// Re-parse seed-library MD files and fix key_takeaways on all seeded items in
// Postgres. Needed after md-parse learned to recover structured takeaways from
// nested markdown bullets (previously stored as flat string arrays).
//
// Usage:
//   node scripts/repair-seed-takeaways.js
//   node scripts/repair-seed-takeaways.js --dry-run

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { getSupabase } = require('../lib/supabase');
const { parseMarkdown } = require('../lib/md-parse');
const { isEmptyTakeaways } = require('../lib/takeaways');
const { normalizeUrl } = require('../lib/url');
const { SEED_DIR } = require('../lib/seed');

const DRY_RUN = process.argv.includes('--dry-run');
const catalog = require(path.join(SEED_DIR, 'catalog.json')).items;

async function main() {
  const sb = getSupabase();
  let updated = 0;
  let skipped = 0;

  for (const entry of catalog) {
    const file = path.join(SEED_DIR, `${entry.id}.md`);
    if (!fs.existsSync(file)) {
      console.warn(`• ${entry.id} — no file, skipping`);
      skipped++;
      continue;
    }

    const parsed = parseMarkdown(fs.readFileSync(file, 'utf8'));
    const sourceUrl = normalizeUrl(parsed.frontMatter?.source_url);
    if (!sourceUrl || isEmptyTakeaways(parsed.keyTakeaways)) {
      console.warn(`• ${entry.id} — no source_url or empty takeaways, skipping`);
      skipped++;
      continue;
    }

    const { data: rows, error } = await sb
      .from('items')
      .select('id, user_id, title')
      .eq('source_url', sourceUrl)
      .eq('source', 'seed');
    if (error) throw new Error(error.message);

    for (const row of rows || []) {
      if (DRY_RUN) {
        console.log(`  would update ${row.title} (${row.id})`);
        updated++;
        continue;
      }
      const { error: upErr } = await sb
        .from('items')
        .update({ key_takeaways: parsed.keyTakeaways })
        .eq('id', row.id);
      if (upErr) throw new Error(upErr.message);
      console.log(`  ✅ ${row.title}`);
      updated++;
    }
  }

  console.log(`\nDone. ${updated} item(s) ${DRY_RUN ? 'would be ' : ''}updated, ${skipped} catalog entry(ies) skipped.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
