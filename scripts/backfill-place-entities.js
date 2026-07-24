// Backfill: extract "place" entities from already-saved items.
//
// Saves made before the place entity type existed never produced place
// entities — the UAE travel reels sit in the library with their venues locked
// inside summaries/transcripts. This script runs a focused Haiku pass over
// travel-looking items (title/summary/transcript), appends any newly found
// place entities to items.entities, registers them through the standard sweep
// (canonical rows + meta_category), and geocodes them.
//
//   node scripts/backfill-place-entities.js               → dry run, prints what it would add
//   node scripts/backfill-place-entities.js --write       → appends + sweeps + geocodes
//   node scripts/backfill-place-entities.js --only <item_id>  → limit to one item
//   node scripts/backfill-place-entities.js --all         → skip the travel-keyword prefilter
require('dotenv').config();
const { getSupabase } = require('../lib/supabase');
const { getAnthropicClient } = require('../lib/anthropicClient');

const MODEL = 'claude-haiku-4-5-20251001';

// Cheap prefilter so the model only reads items that could plausibly contain
// places. --all bypasses it (costs more, misses nothing).
const TRAVEL_HINTS = /\b(travel|trip|visit|place|places|spot|spots|itinerary|hidden gem|destination|weekend|staycation|restaurant|cafe|café|brunch|beach|resort|hotel|desert|hike|hiking|explore|things to do|uae|dubai|abu dhabi|sharjah|ras al khaimah|fujairah|oman|saudi)\b/i;

const SYSTEM_PROMPT = `You extract real-world PLACES from saved social-media content (reels, posts, articles).

A place is a specific named venue or spot someone can physically go to: restaurants, cafés, beaches, parks, landmarks, attractions, hotels, museums, neighborhoods. A named city, district, or island being recommended as a destination counts. NOT places: whole countries, "the mountains" generically, and organizations without a fixed venue — communities, clubs, meetup groups, brands, and online groups are not places even when they gather somewhere.

Extract EACH named place as its own entity — a "5 hidden gems in the UAE" reel produces 5 entities. NEVER emit a country as an entity: for a country-level trip or itinerary, extract its named stops (lakes, towns, valleys, viewpoints) if the content names them; if it names none, return []. If the content contains no real-world places, return [].

Return ONLY a raw JSON array — no markdown fences, no preamble:
[{
  "type": "place",
  "name": "the place's name",
  "url": null,
  "category_path": ["broad", "narrower"],
  "detail": {
    "what_it_is": "restaurant | cafe | beach | park | landmark | attraction | hotel | museum | neighborhood | other, one word",
    "city": "city name if known, else null",
    "country": "country name if known or clearly implied (e.g. a UAE roundup implies United Arab Emirates), else null",
    "why_go": "one line under 12 words — the content's pitch for it"
  }
}]

category_path: lowercase, broad→specific, 1-2 levels, e.g. ["beaches"] or ["restaurants", "brunch"].`;

function arg(flag) {
  const i = process.argv.indexOf(flag);
  return i === -1 ? null : (process.argv[i + 1] || true);
}

function parseArray(text) {
  const s = String(text || '').replace(/```json\n?/gi, '').replace(/```\n?/g, '').trim();
  const start = s.indexOf('[');
  if (start === -1) throw new Error(`No JSON array found: ${s.substring(0, 200)}`);
  let depth = 0, inString = false, escape = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '[') depth++;
    if (ch === ']') { depth--; if (depth === 0) return JSON.parse(s.slice(start, i + 1)); }
  }
  throw new Error(`Incomplete JSON array: ${s.substring(0, 200)}`);
}

function itemText(item) {
  const parts = [`Title: ${item.title || '(untitled)'}`];
  if (item.summary) parts.push(`Summary: ${item.summary}`);
  if (item.transcript) parts.push(`Transcript: ${String(item.transcript).slice(0, 6000)}`);
  return parts.join('\n\n');
}

async function extractPlaces(client, item) {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: itemText(item) }],
  });
  const textBlock = response.content.filter(b => b.type === 'text').pop();
  if (!textBlock) return [];
  const raw = parseArray(textBlock.text);
  return raw.filter(e =>
    e && e.type === 'place' && typeof e.name === 'string' && e.name.trim());
}

const key = name => String(name).trim().toLowerCase();

async function main() {
  const write = process.argv.includes('--write');
  const all = process.argv.includes('--all');
  const only = arg('--only');

  const sb = getSupabase();
  const client = getAnthropicClient();

  let query = sb.from('items').select('id, user_id, title, summary, transcript, entities');
  if (only) query = query.eq('id', only);
  const { data: items, error } = await query;
  if (error) throw error;

  let scanned = 0, itemsWithPlaces = 0, added = 0;
  const userIds = new Set();

  for (const item of items || []) {
    const haystack = `${item.title || ''} ${item.summary || ''}`;
    if (!only && !all && !TRAVEL_HINTS.test(haystack)) continue;

    const entities = Array.isArray(item.entities) ? item.entities : [];
    const existing = new Set(entities.filter(e => e && e.type === 'place').map(e => key(e.name)));
    scanned += 1;

    let found;
    try {
      found = await extractPlaces(client, item);
    } catch (err) {
      console.error(`✗ ${item.title} (${item.id}): extraction failed — ${err.message}`);
      continue;
    }
    const fresh = found.filter(e => !existing.has(key(e.name)));
    if (fresh.length === 0) continue;

    itemsWithPlaces += 1;
    console.log(`\n■ ${item.title} (${item.id})`);
    for (const e of fresh) {
      const d = e.detail || {};
      console.log(`  + ${e.name} — ${d.what_it_is || '?'}${d.city ? `, ${d.city}` : ''}${d.country ? `, ${d.country}` : ''}`);
    }
    added += fresh.length;
    userIds.add(item.user_id);

    if (write) {
      const { error: updErr } = await sb
        .from('items')
        .update({ entities: [...entities, ...fresh] })
        .eq('id', item.id);
      if (updErr) throw new Error(`write failed for ${item.id}: ${updErr.message}`);
    }
  }

  console.log(`\n${scanned} items scanned, ${itemsWithPlaces} with new places, ${added} place entities ${write ? 'added' : 'found (dry run — rerun with --write)'}`);
  if (!write || added === 0) return;

  // Register through the exact save-time path (canonical rows, meta_category),
  // then geocode — same order a fresh save goes through.
  const { sweepEntities } = require('../lib/entityResolution');
  const { geocodePendingPlaces } = require('../lib/placeGeocoding');
  for (const userId of userIds) {
    const sweep = await sweepEntities({ userId, type: 'place' });
    console.log(`sweep (user ${userId}):`, JSON.stringify(sweep));
    const geo = await geocodePendingPlaces({ userId });
    console.log(`geocode (user ${userId}):`, JSON.stringify(geo));
  }
}

main().catch(err => { console.error(err); process.exit(1); });
