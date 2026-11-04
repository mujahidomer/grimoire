#!/usr/bin/env node
// Fill in items.source_author for saved Instagram posts that do not have one.
//
// Without a handle on the item, a creator's DM arrives and matches nothing:
// the capture parks as no_match and the article never reaches the reel that
// prompted it. Saves made before source_author existed have no handle, which
// is most of the library.
//
// One Apify run covers a whole batch of URLs, so this is a handful of runs
// rather than one per post. Results come back normalised to /p/<shortcode>/,
// so they are matched on the shortcode, not the URL.
//
// Usage:
//   node scripts/backfill-instagram-authors.js                # gated posts only
//   node scripts/backfill-instagram-authors.js --all          # every post missing a handle
//   node scripts/backfill-instagram-authors.js --limit 40
//   node scripts/backfill-instagram-authors.js --dry-run
//
// Requires: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GRIMOIRE_USER_ID,
// APIFY_API_KEY.
//
// Scoped to one user on every read and write: the items table is shared.

require('dotenv').config();
const { getSupabase, defaultUserId } = require('../lib/supabase');
const { shortcodeOf } = require('../lib/instagram/reels');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const ALL = args.includes('--all');
const limitArg = args.indexOf('--limit');
const LIMIT = limitArg !== -1 ? Number(args[limitArg + 1]) : Infinity;
const BATCH = 40;
const APIFY = 'https://api.apify.com/v2';

async function scrape(urls) {
  const token = process.env.APIFY_API_KEY;
  if (!token) throw new Error('APIFY_API_KEY is required');
  const start = await fetch(`${APIFY}/acts/apify~instagram-scraper/runs?token=${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ directUrls: urls, resultsType: 'posts', addParentData: false }),
  });
  if (!start.ok) throw new Error(`apify start failed (${start.status}): ${await start.text()}`);
  const { data: run } = await start.json();

  let status = run.status;
  for (let i = 0; i < 90 && !['SUCCEEDED', 'FAILED', 'ABORTED'].includes(status); i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const poll = await fetch(`${APIFY}/actor-runs/${run.id}?token=${token}`);
    if (!poll.ok) continue; // a blip in polling is not a failed run
    status = (await poll.json()).data.status;
  }
  if (status !== 'SUCCEEDED') throw new Error(`apify run ${run.id} ended ${status}`);

  const items = await (await fetch(`${APIFY}/actor-runs/${run.id}/dataset/items?token=${token}`)).json();
  const byShortcode = new Map();
  for (const item of items) {
    const code = shortcodeOf(item.url || item.inputUrl || '') || item.shortCode;
    const handle = item.ownerUsername;
    if (code && handle) byShortcode.set(code, String(handle).replace(/^@/, '').trim().toLowerCase());
  }
  return byShortcode;
}

async function main() {
  const userId = process.env.GRIMOIRE_USER_ID || defaultUserId();
  if (!userId) throw new Error('GRIMOIRE_USER_ID is required: this script must never run unscoped');
  const sb = getSupabase();

  let query = sb.from('items')
    .select('id, source_url, gate_keyword')
    .eq('user_id', userId)
    .ilike('source_url', '%instagram.com%')
    .is('source_author', null)
    .order('created_at', { ascending: false });
  if (!ALL) query = query.not('gate_keyword', 'is', null);
  const { data, error } = await query;
  if (error) throw new Error(`select failed: ${error.message}`);

  const rows = (data || []).filter((r) => shortcodeOf(r.source_url))
    .slice(0, LIMIT === Infinity ? undefined : LIMIT);
  console.log(`${rows.length} post${rows.length === 1 ? '' : 's'} missing a handle`
    + `${ALL ? '' : ' (gated only)'}${DRY_RUN ? ' — dry run' : ''}`);
  if (!rows.length || DRY_RUN) return;

  let filled = 0; let missed = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    console.log(`\nbatch ${Math.floor(i / BATCH) + 1}: ${chunk.length} urls`);
    let found;
    try {
      found = await scrape(chunk.map((r) => r.source_url));
    } catch (err) {
      // One bad batch should not lose the batches after it.
      console.error(`  batch failed: ${err.message}`);
      missed += chunk.length;
      continue;
    }
    for (const row of chunk) {
      const handle = found.get(shortcodeOf(row.source_url));
      if (!handle) { missed += 1; console.log(`  ${row.source_url} — no handle returned`); continue; }
      const { error: updateError } = await sb.from('items')
        .update({ source_author: handle })
        .eq('id', row.id)
        .eq('user_id', userId);
      if (updateError) throw new Error(`update ${row.id} failed: ${updateError.message}`);
      filled += 1;
      console.log(`  ${row.source_url} — @${handle}`);
    }
  }
  console.log(`\nfilled: ${filled} | still missing: ${missed}`);
}

main().catch((err) => { console.error(err.message); process.exit(1); });
