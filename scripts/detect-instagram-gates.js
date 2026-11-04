#!/usr/bin/env node
// Work out which saved Instagram reels are "comment X for the link" gates, and
// what word to leave, so the commenting step has a queue to drain.
//
// The caption is already on the item (Apify fetches it at save time), so this
// needs no browser and no Instagram API. Each candidate the pattern finds is
// then confirmed by a model, because the word ends up POSTED PUBLICLY from the
// user's account and the pattern alone mistakes the odd sentence for a gate.
//
// Writes gate_keyword (the word, or NULL for "looked at, not a gate") and
// gate_checked_at on every row it examines, so a second run only looks at
// what arrived since.
//
// Usage:
//   node scripts/detect-instagram-gates.js              # apply
//   node scripts/detect-instagram-gates.js --dry-run    # report only
//   node scripts/detect-instagram-gates.js --limit 50   # cap rows examined
//   node scripts/detect-instagram-gates.js --recheck    # re-examine checked rows
//
// Requires: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GRIMOIRE_USER_ID,
// ANTHROPIC_API_KEY.
//
// EVERY read and write is filtered by user_id. The items table is shared by a
// dozen testers; an unscoped update here would rewrite other people's rows.

require('dotenv').config();
const { getSupabase, defaultUserId } = require('../lib/supabase');
const { extractKeyword, confirmKeyword } = require('../lib/instagram/gates');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const RECHECK = args.includes('--recheck');
const limitArg = args.indexOf('--limit');
const LIMIT = limitArg !== -1 ? Number(args[limitArg + 1]) : Infinity;
const PAGE = 500;

async function main() {
  const userId = process.env.GRIMOIRE_USER_ID || defaultUserId();
  if (!userId) throw new Error('GRIMOIRE_USER_ID is required: this script must never run unscoped');
  const sb = getSupabase();

  const rows = [];
  for (let from = 0; rows.length < LIMIT; from += PAGE) {
    let query = sb.from('items')
      .select('id, source_url, source_author, caption, gate_keyword, gate_checked_at')
      .eq('user_id', userId)
      .ilike('source_url', '%instagram.com%')
      .not('caption', 'is', null)
      .order('created_at', { ascending: false })
      .range(from, from + PAGE - 1);
    if (!RECHECK) query = query.is('gate_checked_at', null);
    const { data, error } = await query;
    if (error) throw new Error(`select failed: ${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  const todo = rows.slice(0, LIMIT === Infinity ? rows.length : LIMIT);
  console.log(`examining ${todo.length} caption${todo.length === 1 ? '' : 's'}${DRY_RUN ? ' (dry run)' : ''}`);

  let gates = 0; let rejected = 0; let notAGate = 0;
  for (const row of todo) {
    const candidate = extractKeyword(row.caption);
    let keyword = null;
    if (candidate) {
      const ok = await confirmKeyword(row.caption, candidate);
      if (ok) { keyword = candidate; gates += 1; } else { rejected += 1; }
    } else {
      notAGate += 1;
    }
    const verdict = keyword ? `gate "${keyword}"` : (candidate ? `rejected "${candidate}"` : 'no gate');
    console.log(`  ${row.source_url} — ${verdict}`);
    if (DRY_RUN) continue;
    const { error } = await sb.from('items')
      .update({ gate_keyword: keyword, gate_checked_at: new Date().toISOString() })
      .eq('id', row.id)
      .eq('user_id', userId); // belt and braces: scoped on both id and owner
    if (error) throw new Error(`update ${row.id} failed: ${error.message}`);
  }

  console.log(`\ngates: ${gates} | pattern matched but model rejected: ${rejected} | not a gate: ${notAGate}`);
}

main().catch((err) => { console.error(err.message); process.exit(1); });
