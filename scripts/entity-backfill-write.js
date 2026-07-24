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

// Permanently excluded — no category mapping exists, confirmed out of scope.
const EXCLUDED_TOOL_NAMES = new Set(['al wazir basmati rice', 'atman retreat', 'vibe island', 'gemini cli']);

// The 9 skill entities from the two originally-flagged clusters — explicitly
// re-litigated and approved. Written verbatim, not re-run through Haiku again,
// so a fresh LLM call can't silently relitigate an already-approved decision.
const APPROVED_SKILL_DECISIONS = {
  'anthropic front-end design skill': { canonical: 'Anthropic Front-End Design Skill', description: 'Establishes design direction before code generation, preventing generic defaults' },
  'frontend-design': { canonical: 'Anthropic Front-End Design Skill' },
  "anthropic's design taste": { canonical: 'Anthropic Front-End Design Skill' },
  'premium front-end ui skill': { canonical: 'Premium Front-End UI Skill', description: 'Creates luxury fashion brand landing page aesthetic' },
  'front-end ui/ux skill': { canonical: 'Front-End UI/UX Skill', description: 'General all-rounder for clean professional defaults' },
  'product-design': { canonical: 'product-design', description: 'Provides coding agents context behind product and UI decisions' },
  'image-to-code-skill': { canonical: 'image-to-code-skill', description: 'Generates design references first, analyzes deeply, then implements frontend' },
  'soft-skill': { canonical: 'soft-skill', description: 'Creates calm, expensive-looking interfaces with softer contrast and smooth motion' },
  'imagegen-frontend-web': { canonical: 'imagegen-frontend-web', description: 'Generates premium website reference images with strong art direction' },
};
// canonical_label / meta_category for the 3 founding rows born from this set
// (from the approved skill mapping table).
const APPROVED_SKILL_CATEGORY = {
  'Anthropic Front-End Design Skill': ['ui/frontend design skills', 'Design & Frontend Engineering'],
  'Premium Front-End UI Skill': ['ui/frontend design skills', 'Design & Frontend Engineering'],
  'Front-End UI/UX Skill': ['ui/frontend design skills', 'Design & Frontend Engineering'],
  'product-design': ['ui/frontend design skills', 'Design & Frontend Engineering'],
  'image-to-code-skill': ['ui/frontend design skills', 'Design & Frontend Engineering'],
  'soft-skill': ['ui/frontend design skills', 'Design & Frontend Engineering'],
  'imagegen-frontend-web': ['ui/frontend design skills', 'Design & Frontend Engineering'],
};

// ── Category lookup: the already-approved per-type mapping tables, now the
// shared lib/entityMetaCategories.js (they used to live inline here, with a
// byte-identical copy in entity-backfill-dry-run.js). categoryFor() is
// unchanged: a per-entity override wins over the label-level default, and an
// unmapped entity returns null. ──

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
  if (outcome !== 'MATCH') return { outcome, candidate: null, reason: raw.reason };
  const canonicalName = typeof raw.canonical === 'string' ? raw.canonical.trim() : '';
  const candidate = candidates.find(c => c.canonical_name === canonicalName);
  return candidate ? { outcome: 'MATCH', candidate, reason: raw.reason } : { outcome: 'NEW', candidate: null, reason: raw.reason };
}

async function fetchAllItems() {
  const sb = getSupabase();
  const { data, error } = await sb.from('items').select('id, entities, date_saved').not('entities', 'is', null);
  if (error) throw error;
  return data;
}

function fetchTypeEntities(items, type) {
  const raw = [];
  for (const item of items) {
    if (!Array.isArray(item.entities)) continue;
    for (const e of item.entities) {
      if (!e || e.type !== type || !e.name) continue;
      raw.push({
        name: e.name, type: e.type,
        category_path: Array.isArray(e.category_path) ? e.category_path : [],
        detail: e.detail || null, hidden: !!e.hidden,
        dateSaved: item.date_saved, itemId: item.id,
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

// rewrites: itemId -> [{ type, rawName, canonicalName, categoryPath }]
const rewrites = new Map();
function recordRewrite(itemId, type, rawName, canonicalName, categoryPath) {
  if (!rewrites.has(itemId)) rewrites.set(itemId, []);
  rewrites.get(itemId).push({ type, rawName, canonicalName, categoryPath });
}

async function processType(type, items) {
  const entities = fetchTypeEntities(items, type);
  const registry = [];
  const excludedNames = [];

  // Seed pre-approved skill decisions so the remaining 117 skill entities can
  // recall against them, without re-asking Haiku about the already-approved 9.
  if (type === 'skill') {
    const seeded = new Map(); // canonical name -> row
    for (const [rawLower, decision] of Object.entries(APPROVED_SKILL_DECISIONS)) {
      const src = entities.find(e => e.name.trim().toLowerCase() === rawLower);
      if (!src) continue; // shouldn't happen, but don't fail the run if it does
      const [canonicalLabel, metaCategory] = APPROVED_SKILL_CATEGORY[decision.canonical];
      let row = seeded.get(decision.canonical);
      if (!row) {
        row = {
          canonical_name: decision.canonical, aliases: [], category_path: [canonicalLabel],
          meta_category: metaCategory, description: decision.description || null,
          embedding: null, mention_count: 0, needs_review: false, firstSeen: src.dateSaved, lastSeen: src.dateSaved
        };
        seeded.set(decision.canonical, row);
        registry.push(row);
      }
      row.mention_count += 1;
      row.lastSeen = src.dateSaved > row.lastSeen ? src.dateSaved : row.lastSeen;
      if (src.name !== row.canonical_name && !row.aliases.includes(src.name)) row.aliases.push(src.name);
      recordRewrite(src.itemId, type, src.name, row.canonical_name, row.category_path);
    }
    // Embed the 7 founding rows once so later skill entities can recall against them.
    for (const row of registry) {
      row.embedding = await embedQuery(`${row.canonical_name} - ${row.description || row.category_path.join(' > ')}`);
    }
  }

  const preResolvedNames = new Set(type === 'skill' ? Object.keys(APPROVED_SKILL_DECISIONS) : []);

  for (const entity of entities) {
    const nameLower = entity.name.trim().toLowerCase();
    if (preResolvedNames.has(nameLower)) continue; // already handled above
    if (type === 'tool' && EXCLUDED_TOOL_NAMES.has(nameLower)) { excludedNames.push(entity.name); continue; }

    const rawLabel = entity.category_path[0] || '';
    const cat = categoryFor(type, entity.name, rawLabel);
    if (!cat) { excludedNames.push(entity.name); continue; }
    const [canonicalLabel, metaCategory] = cat;

    const embedding = await embedQuery(buildEmbedText(entity));
    const scored = registry
      .map(row => ({ row, sim: cosine(embedding, row.embedding) }))
      .filter(x => x.sim >= RECALL_THRESHOLD)
      .sort((a, b) => b.sim - a.sim)
      .slice(0, RECALL_COUNT);

    if (scored.length === 0) {
      const row = {
        canonical_name: entity.name, aliases: [], category_path: [canonicalLabel],
        meta_category: metaCategory, description: entity.detail && entity.detail.what_it_does || null,
        embedding, mention_count: 1, needs_review: false, firstSeen: entity.dateSaved, lastSeen: entity.dateSaved
      };
      registry.push(row);
      recordRewrite(entity.itemId, type, entity.name, row.canonical_name, row.category_path);
      continue;
    }

    const candidates = scored.map(x => ({
      canonical_name: x.row.canonical_name, description: x.row.description,
      category_path: x.row.category_path, meta_category: x.row.meta_category
    }));
    const decision = await confirmOne(entity, candidates);

    if (decision.outcome === 'MATCH') {
      const row = registry.find(r => r.canonical_name === decision.candidate.canonical_name);
      if (!row.aliases.includes(entity.name) && entity.name !== row.canonical_name) row.aliases.push(entity.name);
      row.mention_count += 1;
      row.lastSeen = entity.dateSaved > row.lastSeen ? entity.dateSaved : row.lastSeen;
      recordRewrite(entity.itemId, type, entity.name, row.canonical_name, row.category_path);
    } else {
      const row = {
        canonical_name: entity.name, aliases: [], category_path: [canonicalLabel],
        meta_category: metaCategory, description: entity.detail && entity.detail.what_it_does || null,
        embedding, mention_count: 1, needs_review: decision.outcome === 'UNCERTAIN',
        firstSeen: entity.dateSaved, lastSeen: entity.dateSaved
      };
      registry.push(row);
      recordRewrite(entity.itemId, type, entity.name, row.canonical_name, row.category_path);
    }
  }

  return { type, totalVisible: entities.length, registry, excludedCount: excludedNames.length, excludedNames };
}

async function main() {
  const items = await fetchAllItems();
  console.log('Resolving all four types (skill pre-seeded with the 9 approved decisions)...\n');
  const results = await Promise.all(TYPES.map(t => processType(t, items)));

  // ── Phase A report ──
  let grandRegistryRows = 0;
  for (const r of results) {
    const mapped = r.registry.reduce((s, row) => s + row.mention_count, 0);
    console.log(`${r.type}: visible=${r.totalVisible}, canonical_rows=${r.registry.length}, mapped=${mapped}, excluded=${r.excludedCount} (${r.excludedNames.join(', ') || 'none'}), balance=${mapped + r.excludedCount === r.totalVisible ? 'OK' : 'MISMATCH!!'}`);
    grandRegistryRows += r.registry.length;
  }

  // ── Phase B: write canonical_entities ──
  const sb = getSupabase();
  let inserted = 0;
  for (const r of results) {
    for (const row of r.registry) {
      const { error } = await sb.from('canonical_entities').insert({
        entity_type: r.type,
        canonical_name: row.canonical_name,
        aliases: row.aliases,
        category_path: row.category_path,
        meta_category: row.meta_category,
        description: row.description,
        embedding: row.embedding,
        mention_count: row.mention_count,
        needs_review: row.needs_review,
        first_seen_at: new Date(row.firstSeen).toISOString(),
        last_seen_at: new Date(row.lastSeen).toISOString(),
      });
      if (error) throw new Error(`insert failed for "${row.canonical_name}" (${r.type}): ${error.message}`);
      inserted++;
    }
  }
  console.log(`\ncanonical_entities rows inserted: ${inserted}`);

  // ── Phase C: rewrite items.entities[] in place, preserving hidden ──
  let itemsUpdated = 0;
  for (const [itemId, itemRewrites] of rewrites.entries()) {
    const { data: itemRow, error: fetchErr } = await sb.from('items').select('entities').eq('id', itemId).single();
    if (fetchErr) throw new Error(`fetch failed for item ${itemId}: ${fetchErr.message}`);
    const current = Array.isArray(itemRow.entities) ? itemRow.entities : [];
    let changed = false;
    const updated = current.map(e => {
      if (!e) return e;
      const match = itemRewrites.find(rw => rw.type === e.type && rw.rawName === e.name);
      if (!match) return e;
      changed = true;
      const next = { ...e, name: match.canonicalName, category_path: match.categoryPath };
      if (match.rawName !== match.canonicalName) next.raw_name = match.rawName;
      return next; // hidden, url, detail all preserved via spread
    });
    if (!changed) continue;
    const { error: updateErr } = await sb.from('items').update({ entities: updated }).eq('id', itemId);
    if (updateErr) throw new Error(`update failed for item ${itemId}: ${updateErr.message}`);
    itemsUpdated++;
  }
  console.log(`items updated: ${itemsUpdated}`);
}

main().catch(e => { console.error(e); process.exit(1); });
