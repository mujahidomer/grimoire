const OpenAI = require('openai');
const Anthropic = require('@anthropic-ai/sdk');
const { getSupabase } = require('./supabase');
const { getItems } = require('./repository');
const { takeawaysToText, isEmptyTakeaways } = require('./takeaways');

// Embedding generation + storage + semantic search (Doc A items 7–9).
// Model: OpenAI text-embedding-3-small (1536 dims), matching the embeddings
// column. Uses the existing OPENAI_API_KEY.

const EMBED_MODEL = 'text-embedding-3-small';
const CHUNK_CHARS = 4000;   // ~1k tokens per chunk
const CHUNK_OVERLAP = 400;  // small overlap so ideas spanning a boundary survive

// Relevance threshold for semantic search (cosine similarity, 0..1). Below it,
// search returns NOTHING rather than nearest-but-irrelevant items — an honest
// empty state beats confidently-wrong context (Doc A item 9). Tune against the
// real pre-populated library; start conservative (strict).
const DEFAULT_THRESHOLD = parseFloat(process.env.SEMANTIC_THRESHOLD || '0.25');

const VECTOR_CANDIDATE_COUNT = 50;
const MERGED_POOL_CAP = 100;
const RERANK_CAP = 10;
const RERANK_MIN_SURVIVORS = 3;
const FALLBACK_VECTOR_TOP = 5;
const RERANK_MODEL = 'claude-haiku-4-5-20251001';

let openai = null;
function getOpenAI() {
  if (openai) return openai;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set (required for embeddings).');
  openai = new OpenAI({ apiKey });
  return openai;
}

let anthropic = null;
function getAnthropic() {
  if (anthropic) return anthropic;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set (required for reranking).');
  anthropic = new Anthropic({ apiKey });
  return anthropic;
}

// Assemble the item's meaningful text and split it into overlapping chunks.
// The title leads every chunk so each chunk is self-describing.
function chunkItemText(item) {
  const parts = [];
  if (item.summary) parts.push(item.summary);
  const takeaways = item.key_takeaways || item.keyTakeaways;
  if (!isEmptyTakeaways(takeaways)) parts.push(takeawaysToText(takeaways));
  if (item.transcript) parts.push(item.transcript);
  if (item.caption) parts.push(item.caption);

  const title = item.title || '';
  const full = parts.join('\n\n').trim();
  if (!full) return title ? [title] : [];

  const chunks = [];
  for (let i = 0; i < full.length; i += (CHUNK_CHARS - CHUNK_OVERLAP)) {
    const slice = full.slice(i, i + CHUNK_CHARS);
    chunks.push(title ? `${title}\n\n${slice}` : slice);
    if (i + CHUNK_CHARS >= full.length) break;
  }
  return chunks;
}

async function embedTexts(texts) {
  if (texts.length === 0) return [];
  const res = await getOpenAI().embeddings.create({ model: EMBED_MODEL, input: texts });
  return res.data.map(d => d.embedding);
}

async function embedQuery(query) {
  const [embedding] = await embedTexts([query]);
  return embedding;
}

function parseEmbedding(embedding) {
  if (Array.isArray(embedding)) return embedding;
  if (typeof embedding === 'string') return JSON.parse(embedding);
  return embedding;
}

function cosineSimilarity(a, b) {
  const va = parseEmbedding(a);
  const vb = parseEmbedding(b);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < va.length; i++) {
    dot += va[i] * vb[i];
    normA += va[i] * va[i];
    normB += vb[i] * vb[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// Generate + store embeddings for one item. Replaces any existing embeddings for
// the item first (idempotent on re-save).
async function embedAndStoreItem(item, itemId, userId) {
  const chunks = chunkItemText(item);
  if (chunks.length === 0) return 0;

  const vectors = await embedTexts(chunks);
  const sb = getSupabase();

  await sb.from('embeddings').delete().eq('item_id', itemId);

  const rows = chunks.map((chunk_text, chunk_index) => ({
    user_id: userId,
    item_id: itemId,
    chunk_index,
    chunk_text,
    embedding: vectors[chunk_index]
  }));
  const { error } = await sb.from('embeddings').insert(rows);
  if (error) throw new Error(`embedding insert failed: ${error.message}`);
  return rows.length;
}

// Kick off embedding without blocking the save response. Failures are logged
// but do not affect the already-persisted item.
function embedItemInBackground(item, itemId, userId) {
  embedAndStoreItem(item, itemId, userId).catch(err => {
    console.error(`Embedding failed for item ${itemId} (item still saved):`, err.message);
  });
}

async function vectorSearch({ userId, queryEmbedding, threshold, candidateCount }) {
  const sb = getSupabase();
  const { data, error } = await sb.rpc('match_items', {
    query_embedding: queryEmbedding,
    match_user: userId,
    match_threshold: threshold != null ? threshold : DEFAULT_THRESHOLD,
    match_count: candidateCount || VECTOR_CANDIDATE_COUNT
  });
  if (error) throw new Error(`semantic search failed: ${error.message}`);
  return data || [];
}

// Full-text keyword search via search_vector @@ plainto_tsquery('english', query).
async function keywordSearch(userId, query, candidateCount) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('items')
    .select('id, title, source_url, summary, key_takeaways, created_at, category, item_tags(confidence_pending, tags(name))')
    .eq('user_id', userId)
    .textSearch('search_vector', query, { type: 'plain', config: 'english' })
    .limit(candidateCount || VECTOR_CANDIDATE_COUNT);
  if (error) throw new Error(`keyword search failed: ${error.message}`);
  return data || [];
}

// Keyword hits enter first and unconditionally — never gated by vector similarity
// or threshold. Vector hits (already threshold-filtered by match_items) supplement.
function mergeSearchResults(vectorRows, keywordRows) {
  const simById = new Map(vectorRows.map(r => [r.item_id, r.similarity]));
  const keywordOnlyIds = new Set();
  const orderedIds = [];
  const seen = new Set();

  for (const row of keywordRows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    orderedIds.push(row.id);
    if (!simById.has(row.id)) keywordOnlyIds.add(row.id);
    if (orderedIds.length >= MERGED_POOL_CAP) break;
  }

  for (const row of vectorRows) {
    if (seen.has(row.item_id)) continue;
    seen.add(row.item_id);
    orderedIds.push(row.item_id);
    if (orderedIds.length >= MERGED_POOL_CAP) break;
  }

  return { orderedIds, simById, keywordOnlyIds };
}

function parseRerankArray(text) {
  const s = text.replace(/```json\n?/gi, '').replace(/```\n?/g, '').trim();
  const start = s.indexOf('[');
  if (start === -1) throw new Error(`No JSON array found: ${s.substring(0, 200)}`);

  let depth = 0;
  let inString = false;
  let escape = false;
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

const RERANK_PROMPT = `You score saved library items for relevance to a user question.
Each candidate is provided as its title only.

For EACH candidate, return:
- score: integer 0–10 (0 = not relevant, 10 = directly answers the question)
- relevant: true only if the item meaningfully helps answer the question; false otherwise

Return ONLY a raw JSON array — no markdown fences, no preamble:
[{ "index": 0, "score": 7, "relevant": true }, ...]`;

async function rerankWithHaiku(query, candidates) {
  if (candidates.length === 0) return [];

  const listing = candidates.map((item, index) => {
    return `[${index}] Title: ${item.title || '(untitled)'}`;
  }).join('\n');

  const response = await getAnthropic().messages.create({
    model: RERANK_MODEL,
    max_tokens: 2048,
    system: RERANK_PROMPT,
    messages: [{
      role: 'user',
      content: `Question: ${query}\n\nCandidates:\n\n${listing}`
    }]
  });

  const textBlock = response.content.filter(b => b.type === 'text').pop();
  if (!textBlock) throw new Error('Haiku rerank returned no text');
  const scores = parseRerankArray(textBlock.text);

  const scoreByIndex = new Map();
  for (const row of scores) {
    if (typeof row.index !== 'number') continue;
    scoreByIndex.set(row.index, {
      score: Number(row.score) || 0,
      relevant: row.relevant === true
    });
  }

  return candidates
    .map((item, index) => {
      const result = scoreByIndex.get(index) || { score: 0, relevant: false };
      return { ...item, rerankScore: result.score, rerankRelevant: result.relevant };
    })
    .filter(item => item.rerankRelevant)
    .sort((a, b) => (b.rerankScore || 0) - (a.rerankScore || 0))
    .slice(0, RERANK_CAP);
}

function fallbackCandidates(candidates, keywordOnlyIds) {
  const byVector = candidates
    .filter(item => item.similarity != null)
    .sort((a, b) => (b.similarity || 0) - (a.similarity || 0));
  const keywordOnly = candidates.filter(item => keywordOnlyIds.has(item.id));
  const picked = [];
  const seen = new Set();
  for (const item of byVector) {
    if (picked.length >= FALLBACK_VECTOR_TOP) break;
    picked.push(item);
    seen.add(item.id);
  }
  for (const item of keywordOnly) {
    if (seen.has(item.id)) continue;
    picked.push(item);
    seen.add(item.id);
  }
  return picked.slice(0, FALLBACK_VECTOR_TOP);
}

// Hybrid search: vector + keyword in parallel, merge, Haiku rerank. Returns items
// ordered for chat context plus the query embedding for per-item chunk lookup.
// Returns { items: [], queryEmbedding } — callers MUST treat items=[] as honest empty.
async function semanticSearch({ userId, query, threshold, candidateCount, onProgress } = {}) {
  const q = (query || '').trim();
  if (!q) return { items: [], queryEmbedding: null };

  const queryEmbedding = await embedQuery(q);
  const [vectorRows, keywordRows] = await Promise.all([
    vectorSearch({ userId, queryEmbedding, threshold, candidateCount }),
    keywordSearch(userId, q, candidateCount)
  ]);

  const { orderedIds, simById, keywordOnlyIds } = mergeSearchResults(vectorRows, keywordRows);
  if (orderedIds.length === 0) return { items: [], queryEmbedding };

  const items = await getItems({ userId, ids: orderedIds, limit: orderedIds.length });
  const itemById = new Map(items.map(it => [it.id, it]));
  const candidates = orderedIds
    .map(id => {
      const item = itemById.get(id);
      if (!item) return null;
      return {
        ...item,
        similarity: simById.get(id) ?? null,
        fromKeywordOnly: keywordOnlyIds.has(id)
      };
    })
    .filter(Boolean);

  console.log(`[retrieval] candidates before rerank: ${candidates.length}`);

  if (onProgress) onProgress({ step: 'reranking', count: candidates.length });

  let reranked;
  try {
    reranked = await rerankWithHaiku(q, candidates);
  } catch (err) {
    console.error('[retrieval] Haiku rerank failed, falling back to vector order:', err.message);
    reranked = fallbackCandidates(candidates, keywordOnlyIds);
  }

  if (reranked.length < RERANK_MIN_SURVIVORS) {
    reranked = fallbackCandidates(candidates, keywordOnlyIds);
  }

  console.log(`[retrieval] candidates after rerank: ${reranked.length}`);

  return { items: reranked, queryEmbedding };
}

// Best-matching chunk per item against the query embedding (one chunk each).
async function getBestChunksForItems({ userId, itemIds, queryEmbedding }) {
  if (!itemIds?.length || !queryEmbedding) return new Map();

  const sb = getSupabase();
  const { data, error } = await sb
    .from('embeddings')
    .select('item_id, chunk_text, embedding')
    .eq('user_id', userId)
    .in('item_id', itemIds);
  if (error) throw new Error(`chunk lookup failed: ${error.message}`);

  const bestByItem = new Map();
  for (const row of data || []) {
    const sim = cosineSimilarity(queryEmbedding, row.embedding);
    const prev = bestByItem.get(row.item_id);
    if (!prev || sim > prev.similarity) {
      bestByItem.set(row.item_id, { chunk_text: row.chunk_text, similarity: sim });
    }
  }

  return new Map([...bestByItem.entries()].map(([id, v]) => [id, v.chunk_text]));
}

module.exports = {
  embedAndStoreItem,
  embedItemInBackground,
  semanticSearch,
  getBestChunksForItems,
  embedQuery,
  chunkItemText,
  DEFAULT_THRESHOLD
};
