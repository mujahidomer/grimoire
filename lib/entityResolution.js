const { getSupabase } = require('./supabase');
const { embedQuery } = require('./embeddings');
const { getAnthropicClient } = require('./anthropicClient');

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

async function insertNew(entityType, entity, embedding, needsReview) {
  const sb = getSupabase();
  const description = entity.detail && typeof entity.detail === 'object' && typeof entity.detail.what_it_does === 'string'
    ? entity.detail.what_it_does
    : null;
  const { error } = await sb.from('canonical_entities').insert({
    entity_type: entityType,
    canonical_name: entity.name,
    aliases: [],
    category_path: Array.isArray(entity.category_path) ? entity.category_path : [],
    description,
    embedding,
    mention_count: 1,
    needs_review: needsReview
  });
  if (error) throw new Error(`canonical_entities insert failed: ${error.message}`);
}

async function applyMatch(entity, candidate) {
  const sb = getSupabase();
  const rawName = entity.name;
  if (rawName !== candidate.canonical_name) entity.raw_name = rawName;
  entity.name = candidate.canonical_name;
  entity.category_path = Array.isArray(candidate.category_path) ? candidate.category_path : [];

  const aliases = Array.isArray(candidate.aliases) ? candidate.aliases : [];
  const nextAliases = (rawName !== candidate.canonical_name && !aliases.includes(rawName))
    ? [...aliases, rawName]
    : aliases;

  const { error } = await sb.from('canonical_entities')
    .update({
      aliases: nextAliases,
      mention_count: (candidate.mention_count || 1) + 1,
      last_seen_at: new Date().toISOString()
    })
    .eq('id', candidate.id);
  if (error) throw new Error(`canonical_entities update failed: ${error.message}`);
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

module.exports = { resolveEntities, ENTITY_RESOLUTION_PROMPT, buildEmbedText };
