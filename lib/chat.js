const Anthropic = require('@anthropic-ai/sdk');
const { semanticSearch, getBestChunksForItems } = require('./embeddings');
const { takeawaysToText, isEmptyTakeaways } = require('./takeaways');

// Library-wide chat (Doc A item 9): a stateless question → semantic retrieval →
// answer grounded ONLY in the retrieved items. The core of the future MCP server,
// so it lives here as a clean callable function, not inline in a route.
//
// Stateless this phase: does NOT persist to chats/messages.
// Single-doc chat (deferred) is the same function with itemIds pre-filtered to
// one item — `restrictToItemId` is the hook for that, already wired.

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const CHAT_MODEL = process.env.CHAT_MODEL || 'claude-sonnet-4-6';

const SYSTEM_PROMPT = `You are Grimoire's research assistant. You answer questions using ONLY the saved library items provided as context below. Rules:
- Base every claim on the provided items. Do not use outside knowledge to fill gaps.
- Cite the item titles you drew from.
- If the provided items don't actually answer the question, say so plainly rather than guessing.
- Be concise and direct.`;

// Max number of retrieved items folded into Sonnet's context.
const MAX_CONTEXT_ITEMS = 8;

function sseWrite(write, data) {
  write(`data: ${JSON.stringify(data)}\n\n`);
}

function sseDone(write, end) {
  write('data: [DONE]\n\n');
  end();
}

// Compact context block per item. The full transcript is intentionally excluded
// — only structured metadata, summary, key takeaways, and one best-matching
// chunk (labelled Relevant passage) go in.
function itemToContext(item, idx, relevantPassage) {
  const takeaways = !isEmptyTakeaways(item.key_takeaways)
    ? takeawaysToText(item.key_takeaways).split('\n').map(l => `  - ${l}`).join('\n')
    : '  (none)';
  const tags = Array.isArray(item.tags) && item.tags.length
    ? item.tags.map(t => (typeof t === 'string' ? t : t.name)).filter(Boolean).join(', ')
    : '(none)';
  const date = item.date_saved || item.created_at || '(unknown)';
  const lines = [
    `### [${idx + 1}] ${item.title}`,
    `Source: ${item.source_url}`,
    `Category: ${item.category}`,
    `Tags: ${tags}`,
    `Date: ${date}`,
    `Summary: ${item.summary || '(none)'}`,
    `Key takeaways:\n${takeaways}`
  ];
  if (relevantPassage) {
    lines.push(`Relevant passage: ${relevantPassage}`);
  }
  return lines.filter(Boolean).join('\n');
}

// answerQuestion streams SSE events via write/end. When retrieval clears nothing,
// emits { type: 'empty' } and does NOT call the model.
async function answerQuestion({ userId, question, restrictToItemId, threshold, write, end } = {}) {
  const q = (question || '').trim();
  if (!q) {
    sseWrite(write, { type: 'empty' });
    sseDone(write, end);
    return;
  }

  sseWrite(write, { type: 'progress', step: 'searching' });

  const { items, queryEmbedding } = await semanticSearch({
    userId,
    query: q,
    threshold,
    onProgress: ({ count }) => {
      sseWrite(write, { type: 'progress', step: 'reranking', count });
    }
  });

  // Single-doc chat (deferred feature, hook in place): restrict to one item.
  let filtered = items;
  if (restrictToItemId) filtered = items.filter(it => it.id === restrictToItemId);

  if (filtered.length === 0) {
    sseWrite(write, { type: 'empty' });
    sseDone(write, end);
    return;
  }

  const contextItems = filtered.slice(0, MAX_CONTEXT_ITEMS);
  sseWrite(write, { type: 'progress', step: 'synthesizing', count: contextItems.length });

  const chunkByItem = await getBestChunksForItems({
    userId,
    itemIds: contextItems.map(it => it.id),
    queryEmbedding
  });
  const context = contextItems
    .map((item, idx) => itemToContext(item, idx, chunkByItem.get(item.id)))
    .join('\n\n');

  const sources = contextItems.map(it => ({
    id: it.id,
    title: it.title,
    source_url: it.source_url,
    similarity: it.similarity
  }));

  const stream = client.messages.stream({
    model: CHAT_MODEL,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `Saved library items:\n\n${context}\n\n---\n\nQuestion: ${q}`
    }]
  });

  stream.on('text', (text) => {
    if (text) sseWrite(write, { type: 'text', text });
  });

  await stream.finalMessage();

  sseWrite(write, { type: 'sources', sources });
  sseDone(write, end);
}

module.exports = { answerQuestion };
