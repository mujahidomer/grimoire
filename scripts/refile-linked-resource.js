#!/usr/bin/env node
// Move a linked resource from the reel it landed on to the one it belongs to.
//
// Matching a DM to a reel is a guess made from timing: the creator's newest
// reel saved in the fortnight before the DM arrived. When a creator answers
// several comments from one thread, or a reel of theirs was never saved, that
// guess puts the article under the wrong reel of theirs — visible, and until
// now only fixable by hand in the database.
//
// Usage:
//   node scripts/refile-linked-resource.js --list <item-id>
//   node scripts/refile-linked-resource.js --resource <id> --to <item-id>
//   node scripts/refile-linked-resource.js --resource <id> --to <item-id> --dry-run
//
// Requires: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GRIMOIRE_USER_ID.
//
// EVERY read and write is filtered by user_id, and the destination item is
// checked to belong to that user before anything moves. The items table is
// shared by a dozen testers.

require('dotenv').config();
const { getSupabase, defaultUserId } = require('../lib/supabase');

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i === -1 ? null : args[i + 1]; };
const DRY_RUN = args.includes('--dry-run');

async function main() {
  const userId = process.env.GRIMOIRE_USER_ID || defaultUserId();
  if (!userId) throw new Error('GRIMOIRE_USER_ID is required: this script must never run unscoped');
  const sb = getSupabase();

  const listing = flag('--list');
  if (listing) {
    const { data, error } = await sb.from('linked_resources')
      .select('id,title,source_url').eq('user_id', userId).eq('item_id', listing);
    if (error) throw new Error(`select failed: ${error.message}`);
    for (const r of data) console.log(`${r.id}  ${r.source_url}\n    ${r.title}`);
    if (!data.length) console.log('no linked resources on that item');
    return;
  }

  const resourceId = flag('--resource');
  const target = flag('--to');
  if (!resourceId || !target) throw new Error('need --resource <id> --to <item-id>, or --list <item-id>');

  const { data: rows, error } = await sb.from('linked_resources')
    .select('id,item_id,title,source_url').eq('user_id', userId).eq('id', resourceId);
  if (error) throw new Error(`select failed: ${error.message}`);
  const resource = rows && rows[0];
  if (!resource) throw new Error('no such resource for this user');

  const { data: items, error: itemErr } = await sb.from('items')
    .select('id,title').eq('user_id', userId).eq('id', target);
  if (itemErr) throw new Error(`item lookup failed: ${itemErr.message}`);
  if (!items || !items.length) throw new Error('no such item for this user');

  // The destination may already hold this URL, in which case moving the row
  // would put the same article on one reel twice. Say so and change nothing;
  // the right answer there is to drop one, which the user decides.
  const { data: clash } = await sb.from('linked_resources')
    .select('id').eq('user_id', userId).eq('item_id', target).eq('source_url', resource.source_url);
  if (clash && clash.length) {
    console.log(`${items[0].title} already holds ${resource.source_url} (resource ${clash[0].id}) — nothing moved`);
    return;
  }

  console.log(`${resource.source_url}\n  from item ${resource.item_id}\n  to   ${items[0].title}`);
  if (DRY_RUN) return;

  const { error: updateErr } = await sb.from('linked_resources')
    .update({ item_id: target, updated_at: new Date().toISOString() })
    .eq('user_id', userId).eq('id', resourceId);
  if (updateErr) throw new Error(`update failed: ${updateErr.message}`);
  console.log('moved');
}

main().catch((err) => { console.error(err.message); process.exit(1); });
