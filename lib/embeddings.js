const OpenAI = require('openai');
const { getSupabase } = require('./supabase');
const { getItems } = require('./repository');

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
const DEFAULT_THRESHOLD = parseFloat(process.env.SEMANTIC_THRESHOLD || '0.4');

let openai = null;
function getOpenAI() {
  if (openai) return openai;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set (required for embeddings).');
  openai = new OpenAI({ apiKey });
  return openai;
}

// Assemble the item's meaningful text and split it into overlapping chunks.
// The title leads every chunk so each chunk is self-describing.
function chunkItemText(item) {
  const parts = [];
  if (item.summary) parts.push(item.summary);
  const takeaways = item.key_takeaways || item.keyTakeaways;
  if (Array.isArray(takeaways) && takeaways.length) parts.push(takeaways.join('\n'));
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

// Semantic search: embed the query, run the cosine-similarity RPC (which applies
// the threshold server-side), then hydrate the matching items. Returns items
// ordered by similarity, each annotated with `similarity`. Returns [] when
// nothing clears the threshold — callers MUST treat [] as an honest empty state.
async function semanticSearch({ userId, query, limit = 8, threshold } = {}) {
  const q = (query || '').trim();
  if (!q) return [];

  const queryEmbedding = await embedQuery(q);
  const sb = getSupabase();
  const { data, error } = await sb.rpc('match_items', {
    query_embedding: queryEmbedding,
    match_user: userId,
    match_threshold: threshold != null ? threshold : DEFAULT_THRESHOLD,
    match_count: limit
  });
  if (error) throw new Error(`semantic search failed: ${error.message}`);
  if (!data || data.length === 0) return [];

  const ids = data.map(r => r.item_id);
  const simById = new Map(data.map(r => [r.item_id, r.similarity]));
  const items = await getItems({ userId, ids, limit });
  return items
    .map(it => ({ ...it, similarity: simById.get(it.id) }))
    .sort((a, b) => (b.similarity || 0) - (a.similarity || 0));
}

module.exports = { embedAndStoreItem, semanticSearch, embedQuery, chunkItemText, DEFAULT_THRESHOLD };
