require('dotenv').config();
const { getSupabase } = require('../lib/supabase');
const { embedQuery } = require('../lib/embeddings');
const { getAnthropicClient } = require('../lib/anthropicClient');
const { ENTITY_RESOLUTION_PROMPT, buildEmbedText } = require('../lib/entityResolution');
const { categoryFor } = require('../lib/entityMetaCategories');

const anthropic = getAnthropicClient();
const MODEL = 'claude-haiku-4-5-20251001';
const RECALL_THRESHOLD = 0.40;
const RECALL_COUNT = 8;
const TYPES = ['tool', 'skill', 'resource', 'workflow'];

// ── Category lookup: the already-approved per-type mapping tables, now the
// shared lib/entityMetaCategories.js (they used to be transcribed inline here
// AND, byte-identically, in entity-backfill-write.js). categoryFor() is
// unchanged: a per-entity override wins over the label-level default, and an
// unmapped entity returns null — e.g. Al Wazir Basmati Rice / Atman Retreat,
// deliberately unmapped. ──

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
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
    if (ch === '[' || ch === '{') depth++;
    if (ch === ']' || ch === '}') { depth--; if (depth === 0) return JSON.parse(s.slice(start, i + 1)); }
  }
  throw new Error(`Incomplete JSON array: ${s.substring(0, 200)}`);
}

// One entity, real Haiku call, same prompt as production — kept local (rather
// than importing lib/entityResolution.js's confirmBatch) only so the dry run
// can capture "reason" for reporting without touching the production module.
async function confirmOne(entity, candidates) {
  const cand = candidates.map(c => `    - "${c.canonical_name}": ${c.description || (c.category_path || []).join(' > ') || c.canonical_name}`).join('\n');
  const detail = buildEmbedText(entity).split(' - ').slice(1).join(' - ');
  const userMsg = `New entity: "${entity.name}": ${detail}\nCandidates (entity_type="${entity.type}"):\n${cand}\n\nResolve each new entity.`;
  const response = await anthropic.messages.create({
    model: MODEL, max_tokens: 500, system: ENTITY_RESOLUTION_PROMPT,
    messages: [{ role: 'user', content: userMsg }]
  });
  const textBlock = response.content.filter(b => b.type === 'text').pop();
  const parsed = parseArray(textBlock.text);
  const raw = parsed[0] || {};
  const outcome = ['MATCH', 'NEW', 'UNCERTAIN'].includes(raw.outcome) ? raw.outcome : 'NEW';
  const reason = raw.reason || '';
  if (outcome !== 'MATCH') return { outcome, candidate: null, reason };
  const canonicalName = typeof raw.canonical === 'string' ? raw.canonical.trim() : '';
  const candidate = candidates.find(c => c.canonical_name === canonicalName);
  return candidate ? { outcome: 'MATCH', candidate, reason } : { outcome: 'NEW', candidate: null, reason: reason + ' (unverifiable canonical, treated as NEW)' };
}

async function fetchEntities(type) {
  const sb = getSupabase();
  const { data, error } = await sb.from('items').select('id, entities, date_saved').not('entities', 'is', null);
  if (error) throw error;
  const raw = [];
  for (const item of data) {
    if (!Array.isArray(item.entities)) continue;
    for (const e of item.entities) {
      if (!e || e.type !== type || !e.name) continue;
      raw.push({
        name: e.name,
        type: e.type,
        category_path: Array.isArray(e.category_path) ? e.category_path : [],
        detail: e.detail || null,
        hidden: !!e.hidden,
        dateSaved: item.date_saved,
      });
    }
  }
  const byKey = new Map();
  for (const e of raw) {
    const key = e.name.trim().toLowerCase();
    const existing = byKey.get(key);
    if (!existing || (e.dateSaved || '') >= (existing.dateSaved || '')) byKey.set(key, e);
  }
  return [...byKey.values()].filter(e => !e.hidden).sort((a, b) => (a.dateSaved || '').localeCompare(b.dateSaved || ''));
}

async function processType(type) {
  const entities = await fetchEntities(type);
  const registry = []; // in-memory canonical rows: { canonical_name, aliases, category_path, meta_category, description, embedding, mention_count, needs_review, sources: [] }
  const unmapped = [];
  const needsReview = [];
  const log = [];

  for (const entity of entities) {
    const rawLabel = entity.category_path[0] || '';
    const cat = categoryFor(type, entity.name, rawLabel);
    if (!cat) { unmapped.push(entity); continue; }
    const [canonicalLabel, metaCategory] = cat;

    const embedding = await embedQuery(buildEmbedText(entity));

    const scored = registry
      .map(row => ({ row, sim: cosine(embedding, row.embedding) }))
      .filter(x => x.sim >= RECALL_THRESHOLD)
      .sort((a, b) => b.sim - a.sim)
      .slice(0, RECALL_COUNT);

    if (scored.length === 0) {
      registry.push({
        canonical_name: entity.name, aliases: [], category_path: [canonicalLabel],
        meta_category: metaCategory, description: entity.detail && entity.detail.what_it_does || null,
        embedding, mention_count: 1, needs_review: false,
        sources: [{ name: entity.name, rawLabel, ownCanonical: canonicalLabel, ownMeta: metaCategory }]
      });
      log.push({ name: entity.name, outcome: 'NEW (cold/no-candidate)', canonical: entity.name });
      continue;
    }

    const candidates = scored.map(x => ({
      canonical_name: x.row.canonical_name, description: x.row.description,
      category_path: x.row.category_path, meta_category: x.row.meta_category, similarity: x.sim
    }));
    const decision = await confirmOne(entity, candidates);

    if (decision.outcome === 'MATCH') {
      const row = registry.find(r => r.canonical_name === decision.candidate.canonical_name);
      if (!row.aliases.includes(entity.name) && entity.name !== row.canonical_name) row.aliases.push(entity.name);
      row.mention_count += 1;
      row.sources.push({ name: entity.name, rawLabel, ownCanonical: canonicalLabel, ownMeta: metaCategory });
      log.push({ name: entity.name, outcome: 'MATCH', canonical: row.canonical_name, reason: decision.reason });
    } else {
      const row = {
        canonical_name: entity.name, aliases: [], category_path: [canonicalLabel],
        meta_category: metaCategory, description: entity.detail && entity.detail.what_it_does || null,
        embedding, mention_count: 1, needs_review: decision.outcome === 'UNCERTAIN',
        sources: [{ name: entity.name, rawLabel, ownCanonical: canonicalLabel, ownMeta: metaCategory }]
      };
      registry.push(row);
      log.push({ name: entity.name, outcome: decision.outcome, canonical: entity.name, reason: decision.reason });
      if (decision.outcome === 'UNCERTAIN') needsReview.push({ entity, candidates, reason: decision.reason });
    }
  }

  return { type, totalVisible: entities.length, registry, unmapped, needsReview, log };
}

async function main() {
  console.log('Processing tool / skill / resource / workflow in parallel (each internally sequential)...\n');
  const results = await Promise.all(TYPES.map(t => processType(t)));

  for (const r of results) {
    console.log(`\n########## ${r.type.toUpperCase()} — visible=${r.totalVisible}, canonical rows=${r.registry.length}, unmapped=${r.unmapped.length}, needs_review=${r.needsReview.length} ##########`);
    const clusters = r.registry.filter(row => row.mention_count > 1).sort((a, b) => b.mention_count - a.mention_count);
    console.log(`-- Merged clusters (${clusters.length}) --`);
    for (const c of clusters) {
      console.log(`  "${c.canonical_name}" [${c.category_path.join(' > ')}] meta="${c.meta_category}" mention_count=${c.mention_count} aliases=${JSON.stringify(c.aliases)}`);
    }
    console.log(`-- Singletons (canonical rows with mention_count=1): ${r.registry.length - clusters.length} --`);
    console.log(`-- Unmapped (no category, not run through resolution): ${r.unmapped.map(e => e.name).join(', ') || '(none)'} --`);
    if (r.needsReview.length) {
      console.log(`-- needs_review --`);
      for (const nr of r.needsReview) {
        console.log(`  "${nr.entity.name}": ${nr.reason}`);
        console.log(`     candidates considered: ${nr.candidates.map(c => `"${c.canonical_name}"(sim=${c.similarity.toFixed(3)})`).join(', ')}`);
      }
    }
  }

  console.log('\n\n=== COUNT CHECK ===');
  let grandTotal = 0;
  for (const r of results) {
    const mappedCount = r.registry.reduce((sum, row) => sum + row.mention_count, 0);
    console.log(`${r.type}: visible=${r.totalVisible}, mapped(sum of mention_count)=${mappedCount}, unmapped=${r.unmapped.length}, check=${mappedCount + r.unmapped.length === r.totalVisible ? 'OK' : 'MISMATCH'}`);
    grandTotal += r.totalVisible;
  }
  console.log(`grand total visible entities: ${grandTotal}`);
}

main().catch(e => { console.error(e); process.exit(1); });
