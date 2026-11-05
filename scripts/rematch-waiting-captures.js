#!/usr/bin/env node
/**
 * Re-run the DM matcher over captures that are holding an article with nowhere
 * to put it: resolved_url set, matched_item_id null. That is what a capture
 * looks like after it parked as no_match.
 *
 * It exists because the candidate window changed (2026-11-05): it used to be
 * save date only, so a reel the gate bot commented on today but saved months
 * ago was not a candidate and the DM answering that comment parked. Widening
 * the window fixes every DM from here on; this script is for the ones already
 * parked. It is also the tool to reach for after any later change to matching.
 *
 * Dry run unless --apply. Selection is filtered by user_id: the items and
 * dm_captures tables hold twelve users.
 *
 *   node scripts/rematch-waiting-captures.js            # what would match
 *   node scripts/rematch-waiting-captures.js --apply    # attach them
 */
require('dotenv/config');
const { getSupabase } = require('../lib/supabase');
const { recentInstagramItems } = require('../lib/repository');
const { normalizeUsername } = require('../lib/instagram/captures');
const { matchItem } = require('../lib/instagram/decide');
const { rematchPendingCaptures } = require('../lib/instagram/capture');

const APPLY = process.argv.includes('--apply');

async function main() {
  const userId = process.env.GRIMOIRE_USER_ID;
  if (!userId) throw new Error('GRIMOIRE_USER_ID is not set — refusing to run across every user');
  const sb = getSupabase();

  const { data: waiting, error } = await sb
    .from('dm_captures')
    .select('id,sender_username,state,needs_user_reason,resolved_url,created_at')
    .eq('user_id', userId)
    .not('resolved_url', 'is', null)
    .is('matched_item_id', null)
    .order('created_at');
  if (error) throw new Error(`select failed: ${error.message}`);

  const candidates = await recentInstagramItems(userId, { days: 7 });
  const senders = new Set();

  console.log(`${waiting.length} capture(s) holding an unattached article; ${candidates.length} candidate reel(s)\n`);
  for (const c of waiting) {
    const item = matchItem(candidates, c.sender_username);
    const handle = (c.sender_username || '?').padEnd(24);
    if (!item) {
      console.log(`  skip  @${handle} ${c.needs_user_reason || c.state} — still no reel of theirs in the window`);
      continue;
    }
    console.log(`  MATCH @${handle} -> item ${item.id.slice(0, 8)} (commented ${(item.gate_commented_at || 'never').slice(0, 16)})`);
    console.log(`        ${c.resolved_url.slice(0, 100)}`);
    senders.add(normalizeUsername(c.sender_username));
  }

  if (senders.size === 0) { console.log('\nnothing to rematch'); return; }
  console.log(`\n${senders.size} sender(s) would be rematched`);
  if (!APPLY) { console.log('dry run — pass --apply to attach them'); return; }

  // One sender at a time: each attach extracts and classifies the article, and
  // one sender failing must not stop the rest.
  let attached = 0;
  for (const sender of senders) {
    try {
      const n = await rematchPendingCaptures(userId, sender);
      console.log(`  @${sender}: ${n} attached`);
      attached += n;
    } catch (err) {
      console.error(`  @${sender}: failed — ${err.message}`);
    }
  }
  console.log(`\nattached ${attached} article(s)`);
}

main().catch((err) => { console.error(err.message); process.exit(1); });
