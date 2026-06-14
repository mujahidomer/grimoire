#!/usr/bin/env node
/**
 * Repair a saved item whose YouTube source_url lost its ?v= video id.
 * Usage: node scripts/repair-youtube-url.js <item-id> <full-youtube-url>
 */
require('dotenv').config();
const { getSupabase } = require('../lib/supabase');
const { normalizeUrl } = require('../lib/url');
const { getYouTubeVideoId } = require('../lib/youtube');

async function main() {
  const [, , itemId, rawUrl] = process.argv;
  const userId = process.env.GRIMOIRE_USER_ID;
  if (!itemId || !rawUrl) {
    console.error('Usage: node scripts/repair-youtube-url.js <item-id> <full-youtube-url>');
    process.exit(1);
  }
  if (!userId) {
    console.error('GRIMOIRE_USER_ID is not configured.');
    process.exit(1);
  }

  const sourceUrl = normalizeUrl(rawUrl);
  if (!sourceUrl || !getYouTubeVideoId(sourceUrl)) {
    console.error('That does not look like a valid YouTube URL with a video id.');
    process.exit(1);
  }

  const sb = getSupabase();
  const { data, error } = await sb
    .from('items')
    .update({ source_url: sourceUrl })
    .eq('id', itemId)
    .eq('user_id', userId)
    .select('id, title, source_url')
    .single();

  if (error) {
    console.error('Update failed:', error.message);
    process.exit(1);
  }

  console.log('Repaired item:');
  console.log(`  ${data.title}`);
  console.log(`  ${data.source_url}`);
}

main();
