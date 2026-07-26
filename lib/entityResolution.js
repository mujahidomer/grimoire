const { getSupabase } = require('./supabase');
const { embedQuery } = require('./embeddings');
const { getAnthropicClient } = require('./anthropicClient');
const { resolveMetaCategory } = require('./entityMetaCategories');
const { seedFromEntityUrl } = require('./entityUrlResolution');

const client = getAnthropicClient();
const MODEL = 'claude-haiku-4-5-20251001';

// Vector recall is a noise floor, not an identity decision — validated against
// real duplicate/lookalike entity pairs (Higgsfield's variants, Sora/Sora 2,
// Claude Code/Claude Code Setup, Claude Fable/Claude Fable 5): no fixed cosine
// threshold separates "same entity" from "different but topically adjacent"
// entity, so this only prunes candidates that aren't even plausibly related.
// The Haiku confirmation call below makes every actual match/no-match decision.
const RECALL_THRESHOLD = 0.40;
const RECALL_COUNT = 8;

// Validated prompt (see the prompt-validation rounds: 4/5 true positives matched
// correctly, 6/6 false-positive pairs never falsely merged, including the
// Claude Fable / Claude Fable 5 same-name-different-product case holding under
// the version/tier clause below).
const ENTITY_RESOLUTION_PROMPT = `You resolve freshly-extracted entities against a canonical entity registry, to prevent the same real-world thing (a tool, skill, resource, workflow, book, scripture reference, or any other saved entity) being saved under multiple different names in a personal bookmarking library.

For EACH new entity, you are given its name + description, and a shortlist of existing canonical-entity candidates (surfaced by embedding similarity — similarity only means these are topically or lexically related, it is NOT evidence they are the same thing).

Decide exactly one outcome per new entity:

- "MATCH": the new entity refers to the exact same real-world thing as one candidate — the same thing described again under a different name, abbreviation, casing, version suffix, or focused on a different facet of the same thing (e.g. a platform's official name vs. its MCP connector vs. its CLI vs. a version-numbered variant of the same brand; or the same scripture passage/book cited under a different translation, edition, or reference style). Set "canonical" to that candidate's name, copied verbatim.
  - Version-numbered or tiered variants of the same underlying thing (e.g. "Sora" vs "Sora 2", "ClaudeKit" vs "ClaudeKit Trade") default to MATCH, collapsing into one canonical entity — but only when the DESCRIPTION confirms it is genuinely the same lineage, evolved or tiered. A number or version-style suffix in the name is not by itself evidence of a version relationship.
  - This does NOT override the NEW rule below: if the descriptions indicate two unrelated things that merely happen to share a name or number, that is still NEW, never MATCH. The description is always the deciding evidence, not the name pattern.
- "NEW": the new entity is a genuinely different thing from every candidate — even when names overlap heavily, share a brand prefix, or the descriptions are topically similar. Sharing a word, a company name, or a family name does NOT make two things the same entity.
  - Operating in the same broad domain or theme (e.g. two skills that are both about frontend/UI design, two books that are both about the same historical period, two scripture entries from the same chapter) is NOT evidence of being the same entity. Compare the specific mechanism, content, or output each one describes — what it actually produces, says, or covers — not just its subject area. Two entities can be topically identical and still be NEW if what they specifically describe differs (e.g. one that generates reference images before coding vs. one that forces a bold aesthetic direction vs. one that gives agents product-decision context — three different mechanisms, even though all three are "frontend design" skills).
  - Sharing a stated GOAL or desired OUTCOME is not the same as sharing a mechanism. Many distinct skills/tools chase the same broad aspiration (e.g. "prevent generic/cliché AI output," "establish good design direction," "make things look more premium") through different specific techniques. Only decide MATCH when the described technique/approach/content is the same — never merely because both entities claim to pursue a similar end result or theme.
  - A thing and a SEPARATE companion or derivative of that thing (a setup/config/scanner add-on for a tool, a study guide or commentary about a book, a different app built by a different team that merely integrates with it) are DIFFERENT entities, even when one name is a superset of the other's name.
  - A name reused for two unrelated things (e.g. a company's own model/product vs. an unrelated third-party product that happens to share part of that name; or two different scripture passages that share a common word) is NEW — a shared proper noun does not override a real functional or substantive difference. Read the description, not the string.
- "UNCERTAIN": the evidence for MATCH and for NEW are both genuinely plausible and you would be guessing either way. Use this instead of forcing a confident answer.

Rules:
- "canonical" MUST be copied verbatim from that entity's own candidate list, or null when the outcome is not MATCH.
- Never invent a canonical name that is not in the candidate list.
- Decide from what each entity actually IS and DOES per its description — not from surface similarity of the name strings.
- Output one object per new entity, preserving input order.

Return ONLY a raw JSON array — no markdown fences, no preamble:
[{ "name": "<new entity name>", "outcome": "MATCH" | "NEW" | "UNCERTAIN", "canonical": "<candidate name verbatim or null>", "reason": "<one short sentence>" }]`;

// Text embedded for identity recall: name + a short description. Falls back to
// category_path when the entity carries no detail.what_it_does (e.g. bare
// entities like "gstack" with no detail block).
function buildEmbedText(entity) {
  const detail = entity.detail && typeof entity.detail === 'object' && typeof entity.detail.what_it_does === 'string'
    ? entity.detail.what_it_does
    : null;
  const fallback = Array.isArray(entity.category_path) ? entity.category_path.join(' > ') : '';
  return `${entity.name} - ${detail || fallback || entity.name}`;
}

function describeCandidate(c) {
  return c.description || (Array.isArray(c.category_path) ? c.category_path.join(' > ') : '') || c.canonical_name;
}

function buildUserMessage(pending) {
  const blocks = pending.map(p => {
    const cand = p.candidates.map(c => `    - "${c.canonical_name}": ${describeCandidate(c)}`).join('\n');
    return `New entity: "${p.entity.name}": ${buildEmbedText(p.entity).split(' - ').slice(1).join(' - ')}\nCandidates (entity_type="${p.entity.type}"):\n${cand}`;
  }).join('\n\n');
  return `${blocks}\n\nResolve each new entity.`;
}

// Extract the first complete JSON array from a model response (same
// bracket-depth parser used elsewhere in this codebase — classifier.js,
// subcategoryConsolidation.js, tags.js, embeddings.js).
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
    if (ch === ']' || ch === '}') {
      depth--;
      if (depth === 0) return JSON.parse(s.slice(start, i + 1));
    }
  }
  throw new Error(`Incomplete JSON array: ${s.substring(0, 200)}`);
}

// One batched Haiku call per save covering every ambiguous entity in it
// (mirrors tags.js's scoreTags batching multiple new tags into one call).
// Hallucination-guarded: "canonical" must be copied verbatim from THAT
// entity's own candidate list, or the decision is discarded to NEW.
async function confirmBatch(pending) {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1500,
    system: ENTITY_RESOLUTION_PROMPT,
    messages: [{ role: 'user', content: buildUserMessage(pending) }]
  });
  const textBlock = response.content.filter(b => b.type === 'text').pop();
  if (!textBlock) throw new Error('No response from entity resolver');

  const parsed = parseArray(textBlock.text);
  return pending.map((p, i) => {
    const raw = parsed[i];
    const outcome = raw && ['MATCH', 'NEW', 'UNCERTAIN'].includes(raw.outcome) ? raw.outcome : 'NEW';
    if (outcome !== 'MATCH') return { outcome, candidate: null };

    const canonicalName = typeof raw.canonical === 'string' ? raw.canonical.trim() : '';
    const candidate = p.candidates.find(c => c.canonical_name === canonicalName);
    // Hallucinated/unverifiable canonical name — fall back to NEW rather than
    // trust an unverified match.
    return candidate ? { outcome: 'MATCH', candidate } : { outcome: 'NEW', candidate: null };
  });
}

// The single insert path for a new canonical row — every branch below (cold
// start, NEW, UNCERTAIN) funnels through here, which is why meta_category is
// resolved inside it: no path can create a row that skips the shelf.
async function insertNew(entityType, entity, embedding, needsReview) {
  const sb = getSupabase();
  const description = entity.detail && typeof entity.detail === 'object' && typeof entity.detail.what_it_does === 'string'
    ? entity.detail.what_it_does
    : null;
  const categoryPath = Array.isArray(entity.category_path) ? entity.category_path : [];
  // Approved-table lookup first, Haiku only on a miss, null when nothing in the
  // closed per-type list fits (never a coerced or invented shelf). Never
  // throws, so an unfiled entity still gets its row.
  const metaCategory = await resolveMetaCategory(entityType, {
    name: entity.name,
    description,
    categoryPath
  });
  // Free URL seed: when the content itself linked the entity, that link is the
  // canonical URL, and passage/place types are settled without a lookup. Rows
  // this can't settle stay 'unresolved' for the metered search pass
  // (resolveEntityUrlsInBackground / the /api/entities/resolve-urls sweep).
  // Synchronous by contract — insertNew sits inside the save path.
  const urlSeed = seedFromEntityUrl(entityType, entity);
  const { error } = await sb.from('canonical_entities').insert({
    entity_type: entityType,
    canonical_name: entity.name,
    aliases: [],
    category_path: categoryPath,
    meta_category: metaCategory,
    description,
    embedding,
    mention_count: 1,
    needs_review: needsReview,
    // Explicit even though schema.sql declares a default — the live column
    // was ALTERed in without one, and a null here breaks the iOS client's
    // non-optional decode of GET /api/entities.
    url_status: 'unresolved',
    ...(urlSeed || {})
  });
  if (error) throw new Error(`canonical_entities insert failed: ${error.message}`);
}

// The one implementation of "these names are the same entity": fold aliases +
// mention weight into a canonical row. Shared by the save-time MATCH path
// (applyMatch, one raw name / one mention) and the manual review-sheet merge
// (applyReviewDecision, which folds in a whole uncertain row) so the merge
// semantics can never fork.
async function absorbIntoCanonical(candidate, { newAliases = [], mentions = 1 } = {}) {
  const sb = getSupabase();
  const merged = Array.isArray(candidate.aliases) ? [...candidate.aliases] : [];
  for (const alias of newAliases) {
    if (alias && alias !== candidate.canonical_name && !merged.includes(alias)) merged.push(alias);
  }
  const { error } = await sb.from('canonical_entities')
    .update({
      aliases: merged,
      mention_count: (candidate.mention_count || 1) + mentions,
      last_seen_at: new Date().toISOString()
    })
    .eq('id', candidate.id);
  if (error) throw new Error(`canonical_entities update failed: ${error.message}`);
}

async function applyMatch(entity, candidate) {
  const rawName = entity.name;
  if (rawName !== candidate.canonical_name) entity.raw_name = rawName;
  entity.name = candidate.canonical_name;
  entity.category_path = Array.isArray(candidate.category_path) ? candidate.category_path : [];

  await absorbIntoCanonical(candidate, {
    newAliases: rawName !== candidate.canonical_name ? [rawName] : [],
    mentions: 1
  });
}

// ─── Manual review (the iOS Review Matches sheet) ────────────────────────────

// The client-facing column set — matches GET /api/entities (no embedding).
const REVIEW_COLUMNS = 'id, entity_type, canonical_name, aliases, category_path, meta_category, description, canonical_url, logo_url, url_status, owned_domain, resolution_note, needs_review';

/// The review queue: every needs_review row paired with its best current
/// match. The UNCERTAIN path deliberately stores no candidate (it would go
/// stale as the registry grows), so the suggestion is recalled fresh here
/// from the row's stored embedding — same RPC, same noise floor as save-time
/// resolution. `suggestion` is null when nothing clears the floor.
async function listReviews() {
  const sb = getSupabase();
  const { data: rows, error } = await sb.from('canonical_entities')
    .select(REVIEW_COLUMNS + ', embedding')
    .eq('needs_review', true)
    .order('entity_type', { ascending: true })
    .order('canonical_name', { ascending: true });
  if (error) throw new Error(`listReviews failed: ${error.message}`);

  // A suggestion must be a settled entity — never another row that's itself
  // awaiting review (merging uncertain-into-uncertain compounds the doubt).
  const queueIds = new Set((rows || []).map(r => r.id));

  const reviews = [];
  for (const row of rows || []) {
    let suggestion = null;
    if (row.embedding) {
      const { data: candidates, error: rpcError } = await sb.rpc('match_canonical_entities', {
        query_embedding: row.embedding,
        match_type: row.entity_type,
        match_threshold: RECALL_THRESHOLD,
        match_count: 4
      });
      if (rpcError) throw new Error(`listReviews recall failed: ${rpcError.message}`);
      const top = (candidates || []).find(c => !queueIds.has(c.id));
      if (top) {
        // The RPC returns a trimmed projection (no url/logo columns, which
        // the sheet's icons need) — refetch the full client-facing row.
        const { data: full, error: fetchError } = await sb.from('canonical_entities')
          .select(REVIEW_COLUMNS).eq('id', top.id).maybeSingle();
        if (fetchError) throw new Error(`listReviews candidate fetch failed: ${fetchError.message}`);
        suggestion = full || null;
      }
    }
    const { embedding, ...entity } = row;
    reviews.push({ entity, suggestion });
  }
  return { reviews };
}

/// Apply one review decision. Throws Error with `.status` set for client
/// errors (routes map it; anything else stays a 500).
///
/// "different" → clear the flag; the row is already a complete canonical
/// entity (the UNCERTAIN path created it), so both entities stand as-is.
///
/// "same" → the manual twin of the save-time MATCH path, in three steps:
///   1. absorbIntoCanonical — the shared merge core (aliases + mentions).
///   2. Rewrite the user's persisted items that reference the uncertain name
///      (same read-modify-write as repository.setEntityHidden), writing the
///      exact fields save-time MATCH writes pre-persist: raw_name, name,
///      category_path. Without this the digest keeps showing two rows.
///   3. Delete the uncertain row — it's an alias now, not an entity.
async function applyReviewDecision({ userId, id, decision, canonicalId }) {
  const sb = getSupabase();
  const fail = (status, message) => { const e = new Error(message); e.status = status; return e; };

  const { data: row, error } = await sb.from('canonical_entities')
    .select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(`applyReviewDecision failed: ${error.message}`);
  if (!row || !row.needs_review) throw fail(404, 'No entity awaiting review with that id');

  if (decision === 'different') {
    const { error: clearError } = await sb.from('canonical_entities')
      .update({ needs_review: false }).eq('id', id);
    if (clearError) throw new Error(`applyReviewDecision failed: ${clearError.message}`);
    return { success: true };
  }

  // decision === 'same'
  if (!canonicalId) throw fail(400, 'canonical_id is required for a "same" decision');
  if (canonicalId === id) throw fail(400, 'canonical_id must be a different entity');
  const { data: candidate, error: candidateError } = await sb.from('canonical_entities')
    .select('*').eq('id', canonicalId).maybeSingle();
  if (candidateError) throw new Error(`applyReviewDecision failed: ${candidateError.message}`);
  if (!candidate) throw fail(400, 'canonical_id does not exist');
  if (candidate.needs_review) throw fail(400, 'canonical_id is itself awaiting review — resolve it first');
  if (candidate.entity_type !== row.entity_type) throw fail(400, 'canonical_id is a different entity type');

  await absorbIntoCanonical(candidate, {
    newAliases: [row.canonical_name, ...(Array.isArray(row.aliases) ? row.aliases : [])],
    mentions: row.mention_count || 1
  });

  // The uncertain row's names as they appear inside items.entities.
  const staleNames = new Set([row.canonical_name, ...(Array.isArray(row.aliases) ? row.aliases : [])]);
  const { data: items, error: itemsError } = await sb.from('items')
    .select('id, entities').eq('user_id', userId).not('entities', 'is', null);
  if (itemsError) throw new Error(`applyReviewDecision failed: ${itemsError.message}`);
  for (const item of items || []) {
    const entities = Array.isArray(item.entities) ? item.entities : [];
    let touched = false;
    const updated = entities.map(e => {
      if (e && e.type === row.entity_type && staleNames.has(e.name)) {
        touched = true;
        return {
          ...e,
          raw_name: e.raw_name || e.name,
          name: candidate.canonical_name,
          category_path: Array.isArray(candidate.category_path) ? candidate.category_path : []
        };
      }
      return e;
    });
    if (touched) {
      const { error: updateError } = await sb.from('items')
        .update({ entities: updated }).eq('id', item.id).eq('user_id', userId);
      if (updateError) throw new Error(`applyReviewDecision failed: ${updateError.message}`);
    }
  }

  const { error: deleteError } = await sb.from('canonical_entities').delete().eq('id', id);
  if (deleteError) throw new Error(`applyReviewDecision failed: ${deleteError.message}`);
  return { success: true };
}

// Resolve every entity in one save's `entities` array against the canonical
// registry, mutating each entity's name/category_path/raw_name in place.
// Called from index.js's runPipeline()/researchAndSave(), right after
// processContent()/researchUrl() returns and before saveItem() persists the
// item — entities is a single jsonb blob written once, so resolution has to
// land before that write, the same slot reconcileSubcategory() occupies for
// topic_subcategory inside classifier.js.
//
// Never throws: a resolution failure for one entity leaves it as extracted
// (unresolved) rather than blocking the save, same posture as
// recordSubcategory()/normalizeTagsPg() elsewhere in this pipeline.
async function resolveEntities(entities) {
  if (!Array.isArray(entities) || entities.length === 0) return entities;
  const sb = getSupabase();

  const pending = []; // { entity, embedding, candidates } — needs the LLM call

  for (const entity of entities) {
    if (!entity || !entity.type || !entity.name) continue;
    try {
      const embedding = await embedQuery(buildEmbedText(entity));
      const { data: candidates, error } = await sb.rpc('match_canonical_entities', {
        query_embedding: embedding,
        match_type: entity.type,
        match_threshold: RECALL_THRESHOLD,
        match_count: RECALL_COUNT
      });
      if (error) throw new Error(`match_canonical_entities failed: ${error.message}`);

      // No candidates above the noise floor subsumes true cold start (zero
      // rows of this entity_type exist yet) — both cases mean "nothing to ask
      // Haiku about," so this is the only branch point needed.
      if (!candidates || candidates.length === 0) {
        await insertNew(entity.type, entity, embedding, false);
        continue;
      }

      pending.push({ entity, embedding, candidates });
    } catch (err) {
      console.error(`[entityResolution] Failed to resolve "${entity.name}" (${entity.type}), leaving unresolved:`, err.message);
    }
  }

  if (pending.length === 0) return entities;

  try {
    const decisions = await confirmBatch(pending);
    for (let i = 0; i < pending.length; i++) {
      const { entity, embedding } = pending[i];
      const { outcome, candidate } = decisions[i];
      try {
        if (outcome === 'MATCH') {
          await applyMatch(entity, candidate);
        } else {
          // NEW and UNCERTAIN both become their own canonical row; UNCERTAIN
          // is flagged for the periodic review pass instead of forcing a
          // confident guess (mirrors tags.js's flag-with-'?' tier).
          await insertNew(entity.type, entity, embedding, outcome === 'UNCERTAIN');
        }
      } catch (err) {
        console.error(`[entityResolution] Failed to apply resolution for "${entity.name}", leaving unresolved:`, err.message);
      }
    }
  } catch (err) {
    console.error('[entityResolution] Confirmation batch failed, leaving these entities unresolved:', err.message);
  }

  return entities;
}

// ─── Manual sweep (the meta-category page's magic-wand button) ───────────────

// One entity reference's identity key, matching the iOS client's dedupeKey
// normalization (DigestEntities.swift) so "already registered" means the same
// thing on both sides of the wire.
function refKey(name) {
  return String(name).trim().toLowerCase();
}

// Sweep one entity type: register every item-entity reference of that type
// that has no canonical row yet (the Digest shows these as "Uncategorized" —
// there is no registry row to hold a meta_category), then fill meta_category
// on any rows of the type still lacking one.
//
// Reuses resolveEntities() verbatim, so a swept reference goes through the
// exact save-time path: embedding recall, Haiku MATCH/NEW/UNCERTAIN, and
// insertNew's meta_category resolution. References that already match a
// canonical row by name/alias are skipped up front — re-resolving them would
// double-count mention_count and burn tokens confirming known identities.
// The skip-set is fixed at sweep start on purpose: when two items carry the
// same unregistered entity, the first creates the row and the second MATCHes
// into it via recall, incrementing mention_count exactly as two saves would.
//
// resolveEntities mutates matched references in place (name → canonical,
// category_path → canonical path), so touched items get their entities blob
// written back — same persistence step applyReviewDecision performs.
async function sweepEntities({ userId, type }) {
  if (!userId) { const e = new Error('userId is required'); e.status = 400; throw e; }
  if (!type || typeof type !== 'string') { const e = new Error('type is required'); e.status = 400; throw e; }
  const sb = getSupabase();

  const { data: regRows, error: regError } = await sb
    .from('canonical_entities')
    .select('canonical_name, aliases')
    .eq('entity_type', type);
  if (regError) throw new Error(`sweep registry read failed: ${regError.message}`);
  const known = new Set();
  for (const row of regRows || []) {
    known.add(refKey(row.canonical_name));
    for (const alias of row.aliases || []) known.add(refKey(alias));
  }

  const { data: items, error: itemsError } = await sb
    .from('items')
    .select('id, entities')
    .eq('user_id', userId)
    .not('entities', 'is', null);
  if (itemsError) throw new Error(`sweep items read failed: ${itemsError.message}`);

  let scanned = 0;
  let swept = 0;
  let itemsUpdated = 0;
  for (const item of items || []) {
    const entities = Array.isArray(item.entities) ? item.entities : [];
    const unregistered = entities.filter(e => {
      if (!e || e.type !== type || !e.name) return false;
      scanned += 1;
      return !known.has(refKey(e.name));
    });
    if (unregistered.length === 0) continue;

    await resolveEntities(unregistered);
    swept += unregistered.length;

    const { error: updateError } = await sb
      .from('items')
      .update({ entities })
      .eq('id', item.id)
      .eq('user_id', userId);
    if (updateError) throw new Error(`sweep item write failed: ${updateError.message}`);
    itemsUpdated += 1;
  }

  // Rows that predate save-time meta resolution (or where it once returned
  // null): give each another pass through the same resolver.
  const { data: nullRows, error: nullError } = await sb
    .from('canonical_entities')
    .select('id, canonical_name, category_path, description')
    .eq('entity_type', type)
    .is('meta_category', null);
  if (nullError) throw new Error(`sweep null-meta read failed: ${nullError.message}`);

  let metaFilled = 0;
  for (const row of nullRows || []) {
    const meta = await resolveMetaCategory(type, {
      name: row.canonical_name,
      description: row.description,
      categoryPath: row.category_path
    });
    if (!meta) continue;
    const { error: metaError } = await sb
      .from('canonical_entities')
      .update({ meta_category: meta })
      .eq('id', row.id);
    if (metaError) throw new Error(`sweep meta write failed: ${metaError.message}`);
    metaFilled += 1;
  }

  const { count: remainingNullMeta, error: countError } = await sb
    .from('canonical_entities')
    .select('id', { count: 'exact', head: true })
    .eq('entity_type', type)
    .is('meta_category', null);
  if (countError) throw new Error(`sweep count failed: ${countError.message}`);

  return { type, scanned, swept, itemsUpdated, metaFilled, remainingNullMeta: remainingNullMeta || 0 };
}

module.exports = { resolveEntities, sweepEntities, listReviews, applyReviewDecision, ENTITY_RESOLUTION_PROMPT, buildEmbedText };
