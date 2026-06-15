#!/usr/bin/env node
// Copy finished MD from the account library (Postgres) into seed-library/<id>.md.
// Matches catalog URLs against saved items via normalized source_url.
//
// Usage:
//   node scripts/sync-seed-from-library.js           # copy matches only
//   node scripts/sync-seed-from-library.js --rebuild-missing  # also run pipeline for gaps

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { defaultUserId } = require('../lib/supabase');
const { findItemBySourceUrl, getItemById } = require('../lib/repository');
const { renderItemAsMarkdown } = require('../lib/render');
const { isEmptyTakeaways } = require('../lib/takeaways');

const SEED_DIR = path.join(__dirname, '..', 'seed-library');
const catalog = require(path.join(SEED_DIR, 'catalog.json')).items;
const REBUILD_MISSING = process.argv.includes('--rebuild-missing');

async function main() {
  const userId = defaultUserId();
  const copied = [];
  const missing = [];
  const emptyTakeaways = [];

  for (const entry of catalog) {
    const hit = await findItemBySourceUrl(userId, entry.url);
    if (!hit) {
      missing.push(entry);
      continue;
    }
    const item = await getItemById(hit.id, userId);
    if (!item) {
      missing.push(entry);
      continue;
    }
    const file = path.join(SEED_DIR, `${entry.id}.md`);
    fs.writeFileSync(file, renderItemAsMarkdown(item), 'utf8');
    copied.push(entry.id);
    if (isEmptyTakeaways(item.key_takeaways)) {
      emptyTakeaways.push(entry.id);
    }
  }

  console.log(`Copied ${copied.length}/${catalog.length} from account library.`);
  if (copied.length) console.log('  ' + copied.join(', '));
  if (missing.length) {
    console.log(`\nMissing in library (${missing.length}):`);
    for (const e of missing) console.log(`  • ${e.id} — ${e.url}`);
  }
  if (emptyTakeaways.length) {
    console.log(`\nCopied but empty key_takeaways (${emptyTakeaways.length}):`);
    console.log('  ' + emptyTakeaways.join(', '));
  }

  if (REBUILD_MISSING && missing.length) {
    console.log('\nRebuilding missing via build-seed-library.js...');
    const { spawnSync } = require('child_process');
    for (const e of missing) {
      const r = spawnSync('node', ['scripts/build-seed-library.js', '--force', '--only', e.id], {
        cwd: path.join(__dirname, '..'),
        stdio: 'inherit',
        env: process.env,
      });
      if (r.status !== 0) console.error(`  ❌ rebuild failed for ${e.id}`);
    }
  }

  return { missing, emptyTakeaways };
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
