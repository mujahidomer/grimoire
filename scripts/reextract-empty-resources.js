#!/usr/bin/env node
// Re-read linked resources that were attached with no content.
//
// A resource whose page could not be read is still attached — deliberately, so
// the link is not lost — but it is stored with a placeholder title and an empty
// body, which opens in the app as a row that says nothing. Those rows are the
// trace of a transient refusal: the overnight DM backfill attached 41 links in
// a few minutes, and Jina answered nine of them with 403 purely on pace.
// Extraction now retries and reads GitHub repos from the API instead, so
// re-running those nine fills them in.
//
// Idempotent: the upsert is keyed on (item, source_url), so a row that reads
// fine is rewritten with the same content, and one that still cannot be read
// stays as it is.
//
// Usage:
//   node scripts/reextract-empty-resources.js            # apply
//   node scripts/reextract-empty-resources.js --dry-run  # list only
//
// Requires: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GRIMOIRE_USER_ID,
// ANTHROPIC_API_KEY.
//
// EVERY read and write is filtered by user_id. The items table is shared by a
// dozen testers; an unscoped update here would rewrite other people's rows.

require('dotenv').config();
const { getSupabase, defaultUserId } = require('../lib/supabase');
const { attachLinkedResource } = require('../lib/linkedResources');

const DRY_RUN = process.argv.slice(2).includes('--dry-run');

// A body this short is a placeholder, not a page: the classifier's "unreadable"
// output runs to a couple of lines.
const MIN_BODY_CHARS = 200;

async function main() {
  const userId = process.env.GRIMOIRE_USER_ID || defaultUserId();
  if (!userId) throw new Error('GRIMOIRE_USER_ID is required: this script must never run unscoped');
  const sb = getSupabase();

  const { data, error } = await sb
    .from('linked_resources')
    .select('id,item_id,title,source_url,body_content')
    .eq('user_id', userId);
  if (error) throw new Error(`select failed: ${error.message}`);

  const empty = (data || []).filter((row) =>
    !row.body_content || String(row.body_content).trim().length < MIN_BODY_CHARS);

  console.log(`${data.length} linked resource(s); ${empty.length} with no readable content`);
  if (!empty.length) return;

  let filled = 0;
  let stillEmpty = 0;
  for (const row of empty) {
    if (DRY_RUN) { console.log(`  would re-read ${row.source_url}`); continue; }
    try {
      const result = await attachLinkedResource(row.item_id, userId, row.source_url);
      if (result.content_extracted) { filled++; console.log(`  read  ${row.source_url}`); }
      else { stillEmpty++; console.log(`  still unreadable  ${row.source_url}`); }
    } catch (err) {
      stillEmpty++;
      console.error(`  failed  ${row.source_url}: ${err.message}`);
    }
  }

  if (!DRY_RUN) console.log(`\nfilled in: ${filled}; still unreadable: ${stillEmpty}`);
}

main().catch((err) => { console.error(err.message); process.exit(1); });
