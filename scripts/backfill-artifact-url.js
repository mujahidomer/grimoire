#!/usr/bin/env node
// One-time backfill: promote a primary link into artifact_url for items that
// have an artifact_type but no artifact_url, using their existing linked_resources.
//
// For every qualifying item we run the shared pickPrimaryArtifactLink ranking
// (GitHub repo > docs > homepage > any real content URL; see lib/url.js) over the
// item's linked_resources. If a winner is found we:
//   - set items.artifact_url        = winner
//   - set items.artifact_url_source = 'linked resource'
//   - delete the winning row from linked_resources (it now lives in artifact_url)
//
// Usage:
//   node scripts/backfill-artifact-url.js            # apply updates
//   node scripts/backfill-artifact-url.js --dry-run  # report only, no writes
//
// Requires: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GRIMOIRE_USER_ID.
// Re-runnable: items that already have an artifact_url are skipped on the next run.

require('dotenv').config();
const { getSupabase, defaultUserId } = require('../lib/supabase');
const { pickPrimaryArtifactLink } = require('../lib/url');

const DRY_RUN = process.argv.slice(2).includes('--dry-run');

async function main() {
  const sb = getSupabase();
  const userId = defaultUserId();

  // Candidates: artifact_type set (and not 'none') AND artifact_url still null.
  // linked_resources is a child table — pull each item's links in the same query.
  const { data: items, error } = await sb
    .from('items')
    .select('id, title, artifact_type, artifact_url, linked_resources(id, source_url)')
    .eq('user_id', userId)
    .is('artifact_url', null)
    .not('artifact_type', 'is', null)
    .neq('artifact_type', 'none');
  if (error) throw new Error(`query failed: ${error.message}`);

  console.log(`[backfill] ${DRY_RUN ? 'DRY RUN — ' : ''}scanning ${items.length} item(s) with artifact_type set and artifact_url null\n`);

  let updated = 0;
  let skipped = 0;

  for (const item of items) {
    const links = (item.linked_resources || []).map(r => r.source_url).filter(Boolean);
    if (links.length === 0) {
      skipped++;
      console.log(`  SKIP  ${item.id}  "${item.title}"  — no linked_resources`);
      continue;
    }

    const winner = pickPrimaryArtifactLink(links);
    if (!winner) {
      skipped++;
      console.log(`  SKIP  ${item.id}  "${item.title}"  — no promotable link among ${links.length}`);
      continue;
    }

    console.log(`  PROMOTE  ${item.id}  "${item.title}"  →  ${winner}`);

    if (!DRY_RUN) {
      const { error: updErr } = await sb
        .from('items')
        .update({ artifact_url: winner, artifact_url_source: 'linked resource' })
        .eq('user_id', userId)
        .eq('id', item.id);
      if (updErr) throw new Error(`update failed for ${item.id}: ${updErr.message}`);

      // Remove the promoted link from linked_resources so it isn't duplicated.
      const { error: delErr } = await sb
        .from('linked_resources')
        .delete()
        .eq('user_id', userId)
        .eq('item_id', item.id)
        .eq('source_url', winner);
      if (delErr) throw new Error(`linked_resources cleanup failed for ${item.id}: ${delErr.message}`);
    }

    updated++;
  }

  console.log(`\n[backfill] Done. ${updated} item(s) ${DRY_RUN ? 'would be ' : ''}updated, ${skipped} skipped.`);
}

main().catch(err => {
  console.error(`[backfill] FAILED: ${err.message}`);
  process.exit(1);
});
