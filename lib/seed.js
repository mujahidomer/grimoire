const fs = require('fs');
const path = require('path');
const { parseMarkdown } = require('./md-parse');
const { upsertItem, upsertItemTags, upsertLinkedResource } = require('./repository');
const { embedAndStoreItem } = require('./embeddings');

// Starter-library seeding. Pre-processed MD files live in seed-library/<id>.md
// (one file per catalog item — see seed-library/README.md). On signup we copy
// the user's chosen items straight into their library by parsing each MD file
// and upserting it, exactly like the Drive→Postgres migration. We deliberately
// do NOT run the extraction/classification pipeline here — the files already
// hold finished, structured content.

const SEED_DIR = path.join(__dirname, '..', 'seed-library');

// Catalog item ids are stable kebab-case slugs and become filenames, so reject
// anything that could escape SEED_DIR.
const VALID_ID = /^[a-z0-9-]+$/;

function seedFilePath(id) {
  if (!VALID_ID.test(id)) return null;
  const p = path.join(SEED_DIR, `${id}.md`);
  // Defensive: the resolved path must stay inside SEED_DIR.
  if (!p.startsWith(SEED_DIR + path.sep)) return null;
  return p;
}

// Copy one pre-processed seed item into a user's library. Returns true on
// success, false when the file is missing or unusable (never throws for a
// single bad item — one missing file shouldn't sink the whole batch).
async function seedOneItem(id, userId, { embed = true } = {}) {
  const file = seedFilePath(id);
  if (!file || !fs.existsSync(file)) {
    console.warn(`[seed] no seed file for "${id}" — skipping`);
    return false;
  }

  const parsed = parseMarkdown(fs.readFileSync(file, 'utf8'));
  const fm = parsed.frontMatter || {};
  if (!fm.source_url) {
    console.warn(`[seed] "${id}" has no source_url in front-matter — skipping`);
    return false;
  }

  const input = {
    title: fm.title || 'Untitled',
    category: fm.category || 'Other',
    type: fm.type || 'article',
    source_url: fm.source_url,
    date_saved: fm.date_saved || null,
    summary: parsed.summary || null,
    key_takeaways: parsed.keyTakeaways,
    transcript: parsed.transcript || null,
    caption: parsed.caption || null,
    artifact_type: fm.artifact_type || 'none',
    artifact_name: fm.artifact_name || null,
    artifact_url: fm.artifact_url || null,
    artifact_url_source: fm.artifact_url_source || null,
    source: 'seed',
  };

  const tags = Array.isArray(fm.tags) ? fm.tags.map(String) : [];

  const itemId = await upsertItem(input, { userId, source: 'seed' });
  await upsertItemTags(itemId, userId, tags);
  for (const lr of parsed.linkedResources) {
    await upsertLinkedResource(itemId, userId, lr);
  }
  if (embed) {
    try {
      await embedAndStoreItem(input, itemId, userId);
    } catch (err) {
      console.error(`[seed] embedding failed for "${id}" (item still saved):`, err.message);
    }
  }
  return true;
}

// Seed a batch of items for a user. Runs sequentially to stay gentle on the
// embeddings API. Resolves with a {seeded, skipped} count.
async function seedUserLibrary(userId, selectedItemIds = []) {
  let seeded = 0;
  let skipped = 0;
  for (const id of Array.isArray(selectedItemIds) ? selectedItemIds : []) {
    try {
      const ok = await seedOneItem(String(id), userId);
      ok ? seeded++ : skipped++;
    } catch (err) {
      skipped++;
      console.error(`[seed] failed to seed "${id}":`, err.message);
    }
  }
  console.log(`[seed] user=${userId} seeded=${seeded} skipped=${skipped}`);
  return { seeded, skipped };
}

module.exports = { seedUserLibrary, seedOneItem, SEED_DIR };
