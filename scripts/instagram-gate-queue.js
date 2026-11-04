#!/usr/bin/env node
// The queue: saved Instagram reels that ask for a keyword comment and have not
// been commented yet, newest first. Printed for whoever (or whatever) is
// driving the browser, since no API can comment on someone else's post.
//
// Also the place to mark one done, and to record the creator's handle learned
// from the reel page while we were there — without a handle on the item, the
// creator's DM reaches us and matches nothing.
//
// Usage:
//   node scripts/instagram-gate-queue.js                    # list pending
//   node scripts/instagram-gate-queue.js --limit 10
//   node scripts/instagram-gate-queue.js --json
//   node scripts/instagram-gate-queue.js --done <id> [--author <handle>]
//   node scripts/instagram-gate-queue.js --skip <id>        # never comment this one
//
// Requires: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GRIMOIRE_USER_ID.
// Every read and write is scoped to that user: the items table is shared.

require('dotenv').config();
const { getSupabase, defaultUserId } = require('../lib/supabase');

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i === -1 ? null : args[i + 1]; };
const LIMIT = Number(flag('--limit') || 25);
const JSON_OUT = args.includes('--json');
const DONE = flag('--done');
const SKIP = flag('--skip');
const AUTHOR = flag('--author');

async function main() {
  const userId = process.env.GRIMOIRE_USER_ID || defaultUserId();
  if (!userId) throw new Error('GRIMOIRE_USER_ID is required: this script must never run unscoped');
  const sb = getSupabase();

  if (DONE || SKIP) {
    const id = DONE || SKIP;
    // Marking commented and marking skipped are the same write: the queue is
    // "has a keyword and has no gate_commented_at", so a timestamp removes it
    // either way. A skip additionally clears the keyword, which says "looked
    // at, deliberately not a gate to post" rather than "posted".
    const patch = { gate_commented_at: new Date().toISOString() };
    if (SKIP) patch.gate_keyword = null;
    if (AUTHOR) patch.source_author = String(AUTHOR).replace(/^@/, '').trim().toLowerCase();
    const { data, error } = await sb.from('items')
      .update(patch).eq('id', id).eq('user_id', userId).select('id, source_url, source_author');
    if (error) throw new Error(`update failed: ${error.message}`);
    if (!data || !data.length) throw new Error(`no item ${id} belonging to this user`);
    console.log(`${SKIP ? 'skipped' : 'marked commented'}: ${data[0].source_url}`
      + (AUTHOR ? ` (author ${data[0].source_author})` : ''));
    return;
  }

  const { data, error } = await sb.from('items')
    .select('id, source_url, source_author, gate_keyword, created_at')
    .eq('user_id', userId)
    .not('gate_keyword', 'is', null)
    .is('gate_commented_at', null)
    .order('created_at', { ascending: false })
    .limit(LIMIT);
  if (error) throw new Error(`select failed: ${error.message}`);

  if (JSON_OUT) { console.log(JSON.stringify(data, null, 2)); return; }
  console.log(`${data.length} pending gate${data.length === 1 ? '' : 's'} (newest first)\n`);
  for (const row of data) {
    console.log(`  ${String(row.gate_keyword).padEnd(14)} ${row.source_url}`
      + `  ${row.source_author ? '@' + row.source_author : '(no handle yet)'}`);
    console.log(`  ${' '.repeat(14)} id=${row.id}`);
  }
}

main().catch((err) => { console.error(err.message); process.exit(1); });
