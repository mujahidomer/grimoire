#!/usr/bin/env node
/**
 * The sweep for the defect that `linkedResourceCreatorConflict` now prevents:
 * one URL attached to saves by different creators. Several creators hand out
 * the same tracker domain, and a tracker answers whoever asks with whatever it
 * points at today — so one CAPTCHA-walled page ended up attached to sixteen
 * reels by fifteen different creators (found 2026-11-05).
 *
 * Grouping is structural, not textual: a URL is suspect because two creators'
 * saves hold it, never because its summary reads like a failure. Then each
 * suspect URL is read again now, which decides what goes:
 *
 *   blocked  → every copy goes. There is no page to attach to anything.
 *   readable → the oldest copy stays (the first creator keeps it, which is
 *              what the guard would have done) and the rest go.
 *
 * Every row it would delete is written to a backup file first. Dry-run unless
 * --apply. Selection is filtered by user_id: the items table holds twelve
 * users and a script that forgets the filter moves a tester's data.
 *
 *   node scripts/drop-cross-creator-resources.js              # dry run
 *   node scripts/drop-cross-creator-resources.js --apply
 */
require('dotenv/config');
const fs = require('node:fs');
const path = require('node:path');
const { getSupabase } = require('../lib/supabase');
const { normalizeUsername } = require('../lib/instagram/captures');

const APPLY = process.argv.includes('--apply');
const BACKUP = path.join(__dirname, '..', 'dropped-cross-creator-resources.json');

async function main() {
  const userId = process.env.GRIMOIRE_USER_ID;
  if (!userId) throw new Error('GRIMOIRE_USER_ID is not set — refusing to run across every user');
  const sb = getSupabase();

  const { data: resources, error } = await sb
    .from('linked_resources')
    .select('id,item_id,source_url,title,type,body_content,created_at')
    .eq('user_id', userId)
    .order('created_at');
  if (error) throw new Error(`select failed: ${error.message}`);

  const itemIds = [...new Set(resources.map((r) => r.item_id))];
  const authors = new Map();
  for (let i = 0; i < itemIds.length; i += 100) {
    const { data: items, error: itemErr } = await sb
      .from('items')
      .select('id,source_author,title')
      .eq('user_id', userId)
      .in('id', itemIds.slice(i, i + 100));
    if (itemErr) throw new Error(`items select failed: ${itemErr.message}`);
    for (const item of items) authors.set(item.id, item);
  }

  const byUrl = new Map();
  for (const r of resources) {
    if (!byUrl.has(r.source_url)) byUrl.set(r.source_url, []);
    byUrl.get(r.source_url).push(r);
  }

  const suspects = [...byUrl.entries()].filter(([, rows]) => {
    const handles = new Set(rows
      .map((r) => normalizeUsername(authors.get(r.item_id) && authors.get(r.item_id).source_author))
      .filter(Boolean));
    return handles.size > 1;
  });

  console.log(`${resources.length} resources, ${byUrl.size} distinct URLs, ${suspects.length} on more than one creator`);
  if (suspects.length === 0) return;

  // extractArticle is ESM; this script is CJS.
  const { extractArticle, detectBlockedPage } = await import('../lib/extractor.js');
  const doomed = [];

  for (const [url, rows] of suspects) {
    let verdict;
    try {
      await extractArticle(url);
      verdict = 'readable';
    } catch (err) {
      verdict = err.blocked ? 'blocked' : `unreadable (${err.message})`;
    }

    const ordered = [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at));
    const keep = verdict === 'blocked' ? null : ordered[0];
    const drop = ordered.filter((r) => r !== keep);

    console.log(`\n${url}\n  ${rows.length} rows · ${verdict}`);
    if (keep) {
      const handle = (authors.get(keep.item_id) || {}).source_author || '(no creator)';
      console.log(`  keep  @${handle} — ${keep.title}`);
    }
    for (const r of drop) {
      const item = authors.get(r.item_id) || {};
      console.log(`  drop  @${item.source_author || '(no creator)'} — ${item.title || r.item_id}`);
      doomed.push({ ...r, item_title: item.title, item_author: item.source_author });
    }
  }

  if (doomed.length === 0) { console.log('\nnothing to drop'); return; }

  fs.writeFileSync(BACKUP, JSON.stringify(doomed, null, 2));
  console.log(`\n${doomed.length} row(s) to drop; backed up to ${BACKUP}`);
  if (!APPLY) { console.log('dry run — pass --apply to delete them'); return; }

  const ids = doomed.map((r) => r.id);
  for (let i = 0; i < ids.length; i += 50) {
    const { error: delErr } = await sb
      .from('linked_resources')
      .delete()
      .eq('user_id', userId)
      .in('id', ids.slice(i, i + 50));
    if (delErr) throw new Error(`delete failed: ${delErr.message}`);
  }
  console.log(`deleted ${ids.length} row(s)`);
}

main().catch((err) => { console.error(err.message); process.exit(1); });
