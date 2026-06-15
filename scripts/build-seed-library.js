#!/usr/bin/env node
// Pre-process the starter-library catalog into MD files.
//
// For each entry in seed-library/catalog.json this runs the SAME extraction +
// classification pipeline the live save flow uses, renders the result to
// Markdown, and writes it to seed-library/<id>.md. Run it once before launch
// (and again whenever you add catalog entries). At runtime /api/seed just copies
// these finished files into a user's library — it never hits the pipeline.
//
// Usage:
//   node scripts/build-seed-library.js            # build any missing files
//   node scripts/build-seed-library.js --force    # rebuild all
//   node scripts/build-seed-library.js --only ai-karpathy-llms
//
// Requires the same env as the server: SUPADATA_API_KEY (YouTube transcripts),
// OPENAI_API_KEY / ANTHROPIC keys for classification, etc. No Supabase writes.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { extractContent } = require('../lib/extractor');
const { processContent, researchUrl } = require('../lib/classifier');
const { renderItemAsMarkdown } = require('../lib/render');

const SEED_DIR = path.join(__dirname, '..', 'seed-library');
const catalog = require(path.join(SEED_DIR, 'catalog.json')).items;

const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const ONLY = (() => {
  const i = args.indexOf('--only');
  return i !== -1 ? args[i + 1] : null;
})();

async function itemsForUrl(url) {
  let extracted = null;
  try {
    extracted = await extractContent(url);
  } catch (err) {
    console.warn(`  extraction failed (${err.message}) — falling back to research`);
  }
  if (extracted && extracted.text) {
    return processContent(extracted.text, url, extracted.hashtags, {
      caption: extracted.caption,
      transcript: extracted.transcript,
    });
  }
  return researchUrl(url);
}

async function build(entry) {
  const file = path.join(SEED_DIR, `${entry.id}.md`);
  if (!FORCE && fs.existsSync(file)) {
    console.log(`• ${entry.id} — exists, skipping`);
    return;
  }
  console.log(`• ${entry.id} — ${entry.url}`);
  const items = await itemsForUrl(entry.url);
  if (!items || !items.length) {
    console.error(`  ❌ no content extracted for ${entry.id}`);
    return;
  }
  // One catalog entry → one seed item. Take the first, stamp its source_url and
  // a sensible title fallback, then render to MD.
  const item = items[0];
  item.source_url = entry.url;
  if (!item.title) item.title = entry.title;
  fs.writeFileSync(file, renderItemAsMarkdown(item), 'utf8');
  console.log(`  ✅ wrote ${path.relative(process.cwd(), file)}`);
}

(async () => {
  const targets = ONLY ? catalog.filter((c) => c.id === ONLY) : catalog;
  if (!targets.length) {
    console.error(ONLY ? `No catalog entry with id "${ONLY}".` : 'Catalog is empty.');
    process.exit(1);
  }
  for (const entry of targets) {
    try {
      await build(entry);
    } catch (err) {
      console.error(`  ❌ ${entry.id}: ${err.message}`);
    }
  }
  console.log('\nDone. Seed files live in seed-library/.');
})();
