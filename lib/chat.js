const Anthropic = require('@anthropic-ai/sdk');
const { semanticSearch } = require('./embeddings');
const { takeawaysToText, isEmptyTakeaways } = require('./takeaways');
const { classifyQuery } = require('./queryRouter');
const { answerLibraryQuery } = require('./libraryAnalytics');

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
- Cite sources at the END of each sentence or bullet that draws from them — never mid-sentence. Write the full sentence first, then append citations.
- Citation format: [[N|Title]] where N is the item number and Title is the exact title from context. Example: "...autonomous loops. [[1|Self-Improving AI Agent System]]". Multiple sources: [[1|Title A]] [[3|Title B]].
- If the provided items don't actually answer the question, say so plainly rather than guessing.
- If your answer is a list that may be incomplete because you only see a subset of the library, end the response with: "For a complete list across all your saves, check your Library Digest."
- Be concise and direct.`;

// Max number of retrieved items folded into Sonnet's context.
const MAX_CONTEXT_ITEMS = 5;

function sseWrite(write, data) {
  write(`data: ${JSON.stringify(data)}\n\n`);
}

function sseDone(write, end) {
  write('data: [DONE]\n\n');
  end();
}

// Compact context block per item. The full transcript and best-matching chunk
// are intentionally excluded — only structured metadata, a truncated summary,
// and the first few key takeaways go in, to keep token usage low.
const SUMMARY_MAX_CHARS = 200;
const MAX_TAKEAWAYS = 3;

function itemToContext(item, idx) {
  const takeaways = !isEmptyTakeaways(item.key_takeaways)
    ? takeawaysToText(item.key_takeaways).split('\n').slice(0, MAX_TAKEAWAYS).map(l => `  - ${l}`).join('\n')
    : '  (none)';
  const tags = Array.isArray(item.tags) && item.tags.length
    ? item.tags.map(t => (typeof t === 'string' ? t : t.name)).filter(Boolean).join(', ')
    : '(none)';
  const date = item.date_saved || item.created_at || '(unknown)';
  const summary = item.summary
    ? item.summary.slice(0, SUMMARY_MAX_CHARS)
    : '(none)';
  const lines = [
    `### [${idx + 1}] ${item.title}`,
    `Source: ${item.source_url}`,
    `Category: ${item.category}`,
    `Tags: ${tags}`,
    `Date: ${date}`,
    `Summary: ${summary}`,
    `Key takeaways:\n${takeaways}`
  ];
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

  // Query router: detect whether this is a "find my saved content" question
  // (Job A, the retrieval pipeline below) or a "tell me about my library as a
  // whole" analytics question (Job B). Single-doc chat is always Job A.
  if (!restrictToItemId) {
    const queryType = await classifyQuery(q);
    console.log(`[router] classified as ${queryType}`);
    if (queryType === 'JOB_B') {
      return answerLibraryQuery({ question: q, userId, write, end });
    }
  }

  sseWrite(write, { type: 'progress', step: 'searching' });

  const { items } = await semanticSearch({
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

  const context = contextItems
    .map((item, idx) => itemToContext(item, idx))
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

  const final = await stream.finalMessage();
  if (final.usage) {
    console.log(`[tokens] model: ${CHAT_MODEL}, input: ${final.usage.input_tokens}, output: ${final.usage.output_tokens}`);
    sseWrite(write, {
      type: 'meta',
      model: CHAT_MODEL,
      usage: {
        input_tokens: final.usage.input_tokens,
        output_tokens: final.usage.output_tokens
      }
    });
  }

  sseWrite(write, { type: 'sources', sources });
  sseDone(write, end);
}

module.exports = { answerQuestion };
