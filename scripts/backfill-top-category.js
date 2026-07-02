#!/usr/bin/env node
// One-time backfill: assign the new hierarchical top_category + repurposed
// free-text subcategory (stored in items.category) to every existing item
// that hasn't been classified yet.
//
// For every qualifying item we batch 20 at a time into a single Haiku call
// asking for { id, top_category, subcategory }. Results are validated against
// the closed TOP_CATEGORIES list (lib/topCategories.js); anything invalid,
// missing, or from a failed batch falls back to a deterministic mapping of
// the item's OLD legacy category value.
//
// Usage:
//   node scripts/backfill-top-category.js              # apply updates
//   node scripts/backfill-top-category.js --dry-run     # report only, no writes
//   node scripts/backfill-top-category.js --limit 100   # cap how many items are processed
//
// Requires: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GRIMOIRE_USER_ID, ANTHROPIC_API_KEY.
// Re-runnable: items that already have top_category set, or that were
// manually moved (category_manually_set = true), are skipped on the next run.

require('dotenv').config();
const { getSupabase, defaultUserId } = require('../lib/supabase');
const { getAnthropicClient } = require('../lib/anthropicClient');
const { TOP_CATEGORIES, DEFAULT_SUBCATEGORY, normalizeTopCategory, normalizeSubcategoryLabel } = require('../lib/topCategories');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const limitIdx = args.indexOf('--limit');
const LIMIT = limitIdx !== -1 && args[limitIdx + 1] ? parseInt(args[limitIdx + 1], 10) : null;

const MODEL = 'claude-haiku-4-5-20251001';
const BATCH_SIZE = 20;
const PAGE_SIZE = 1000; // Supabase per-request row cap.
const MAX_TOKENS = 3000;

const client = getAnthropicClient();

// Deterministic fallback: OLD legacy category value -> new top_category.
const LEGACY_TOP_CATEGORY_MAP = {
  'Technology': 'Technology & AI',
  'Finance': 'Business & Finance',
  'Business & Career': 'Business & Finance',
  'Health & Fitness': 'Health & Wellness',
  'Learning & Education': 'Education & Learning',
  'Entertainment': 'Arts & Entertainment',
  'Personal Development': 'Personal Development',
  'Food & Cooking': 'Food & Cooking',
  'Travel': 'Travel'
};

function fallbackTopCategory(legacyCategory) {
  return LEGACY_TOP_CATEGORY_MAP[legacyCategory] || 'Other';
}

function truncate(text, max) {
  if (typeof text !== 'string') return '';
  return text.length > max ? text.slice(0, max) : text;
}

function buildPrompt(batch) {
  const list = batch.map(item => ({
    id: item.id,
    title: item.title || null,
    summary: truncate(item.summary || '', 300),
    legacy_category: item.category || null,
    artifact_type: item.artifact_type || null
  }));

  return `Classify each item below into exactly one of these 13 top-level categories, and a short reusable topic subcategory within it.

TOP_CATEGORIES (use EXACTLY one of these values, verbatim): ${TOP_CATEGORIES.join(' | ')}

For each item, choose:
- "top_category": exactly one value from TOP_CATEGORIES above — never invent a new one.
- "subcategory": a short reusable Title Case topic label (1-3 words) under that top_category (e.g. 'Prompt Engineering' under 'Technology & AI', 'Duas' under 'Religion & Spirituality'). Prefer a broadly reusable label over a hyper-specific one.

Hints:
- Items with artifact_type "islamic" belong under "Religion & Spirituality".
- Items with artifact_type "recipe" belong under "Food & Cooking".

Items:
${JSON.stringify(list, null, 2)}

Return ONLY a strict JSON array (no markdown fences, no preamble) with exactly this shape:
[{ "id": "...", "top_category": "...", "subcategory": "..." }]`;
}

function stripFences(text) {
  return text.replace(/```json\n?/gi, '').replace(/```\n?/g, '').trim();
}

function parseClassificationArray(text) {
  const stripped = stripFences(text);
  const start = stripped.indexOf('[');
  const end = stripped.lastIndexOf(']');
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`No JSON array found: ${stripped.substring(0, 200)}`);
  }
  return JSON.parse(stripped.slice(start, end + 1));
}

async function classifyBatch(batch) {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    messages: [{ role: 'user', content: buildPrompt(batch) }]
  });

  const textBlock = response.content.filter(b => b.type === 'text').pop();
  if (!textBlock) throw new Error('No response from classifier');

  const parsed = parseClassificationArray(textBlock.text);
  if (!Array.isArray(parsed)) throw new Error('Classifier response was not an array');
  return parsed;
}

// Fetch all qualifying items, paginated (Supabase caps at 1000 rows/request).
async function fetchItems(sb, userId) {
  const items = [];
  let from = 0;

  while (true) {
    if (LIMIT !== null && items.length >= LIMIT) break;

    const to = from + PAGE_SIZE - 1;
    const { data, error } = await sb
      .from('items')
      .select('id, title, summary, category, subcategory, artifact_type')
      .eq('user_id', userId)
      .is('top_category', null)
      .eq('category_manually_set', false)
      .range(from, to);
    if (error) throw new Error(`query failed: ${error.message}`);

    items.push(...data);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return LIMIT !== null ? items.slice(0, LIMIT) : items;
}

async function main() {
  const sb = getSupabase();
  const userId = defaultUserId();

  const items = await fetchItems(sb, userId);
  const total = items.length;

  console.log(`[backfill-top-category] ${DRY_RUN ? 'DRY RUN — ' : ''}${total} item(s) to classify${LIMIT !== null ? ` (limit ${LIMIT})` : ''}\n`);

  const summary = {
    processed: 0,
    fromLlm: 0,
    fromFallback: 0,
    failedBatches: 0,
    byTopCategory: {}
  };
  const dryRunSamples = [];

  const batches = [];
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    batches.push(items.slice(i, i + BATCH_SIZE));
  }

  let batchNum = 0;
  for (const batch of batches) {
    batchNum++;
    console.log(`[backfill-top-category] batch ${batchNum}/${batches.length} (${summary.processed}/${total} processed so far)`);

    let results = null;
    let usedFallback = false;

    for (let attempt = 1; attempt <= 2 && results === null; attempt++) {
      try {
        results = await classifyBatch(batch);
      } catch (err) {
        console.error(`[backfill-top-category]   batch ${batchNum} attempt ${attempt} failed: ${err.message}`);
        if (attempt === 2) {
          usedFallback = true;
          summary.failedBatches++;
        }
      }
    }

    const resultById = new Map();
    if (results) {
      for (const r of results) {
        if (r && typeof r === 'object' && r.id) resultById.set(String(r.id), r);
      }
    }

    for (const item of batch) {
      const raw = usedFallback ? null : resultById.get(String(item.id));

      // "source" tracks provenance for the summary: an item only counts as
      // "fromLlm" when the batch responded AND its top_category validated.
      // A missing/invalid top_category (or a whole-batch failure) counts as
      // fallback, even if the subcategory itself came from a valid response.
      let topCategory = raw ? normalizeTopCategory(raw.top_category) : null;
      let subcategory = raw ? normalizeSubcategoryLabel(raw.subcategory) : null;
      const source = topCategory ? 'llm' : 'fallback';

      if (!topCategory) topCategory = fallbackTopCategory(item.category);
      if (!subcategory) subcategory = DEFAULT_SUBCATEGORY;

      if (source === 'llm') summary.fromLlm++;
      else summary.fromFallback++;

      summary.byTopCategory[topCategory] = (summary.byTopCategory[topCategory] || 0) + 1;
      summary.processed++;

      if (DRY_RUN) {
        if (dryRunSamples.length < 20) {
          dryRunSamples.push({ title: item.title, topCategory, subcategory, source });
        }
        continue;
      }

      const { error: updErr } = await sb
        .from('items')
        .update({ top_category: topCategory, category: subcategory })
        .eq('user_id', userId)
        .eq('id', item.id);
      if (updErr) throw new Error(`update failed for ${item.id}: ${updErr.message}`);
    }
  }

  console.log(`\n[backfill-top-category] Done. ${summary.processed} item(s) ${DRY_RUN ? 'would be ' : ''}processed.`);
  console.log(`  From LLM:      ${summary.fromLlm}`);
  console.log(`  From fallback: ${summary.fromFallback}`);
  console.log(`  Failed batches (both attempts): ${summary.failedBatches}`);
  console.log(`  By top_category:`);
  for (const cat of TOP_CATEGORIES) {
    if (summary.byTopCategory[cat]) console.log(`    ${cat}: ${summary.byTopCategory[cat]}`);
  }

  if (DRY_RUN && dryRunSamples.length > 0) {
    console.log(`\n[backfill-top-category] Sample of ${dryRunSamples.length} proposed assignment(s):`);
    for (const s of dryRunSamples) {
      console.log(`  "${s.title}" → ${s.topCategory} / ${s.subcategory}  (${s.source})`);
    }
  }
}

main().catch(err => {
  console.error(`[backfill-top-category] FAILED: ${err.message}`);
  process.exit(1);
});
