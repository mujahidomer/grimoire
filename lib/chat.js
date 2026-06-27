const Anthropic = require('@anthropic-ai/sdk');
const { semanticSearch } = require('./embeddings');
const { takeawaysToText, isEmptyTakeaways } = require('./takeaways');
const { classifyQuery } = require('./queryRouter');
const { answerLibraryQuery } = require('./libraryAnalytics');
const { createChat, saveMessage } = require('./chatHistory');

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
- Citation format: [[handle|Title]] where handle is the source's citation handle (e.g. s1, s3) shown in its context block, and Title is the exact title from that block. Example: "...autonomous loops. [[s1|Self-Improving AI Agent System]]". Multiple sources: [[s1|Title A]] [[s3|Title B]].
- Always copy the handle exactly as it appears in the source block. Never invent, renumber, or guess a handle — use only handles that appear in the context.
- If the provided items don't actually answer the question, say so plainly rather than guessing.
- If your answer is a list that may be incomplete because you only see a subset of the library, end the response with: "For a complete list across all your saves, check your Library Digest."
- Cite inline only, using the [[N|Title]] format above. Do NOT add a separate "Sources" section at the end of your answer — the interface renders the source list for you.
- Be concise and direct.`;

// Retrieval/context tuning. Deep Dive widens the funnel at every stage: more
// vector candidates, more items in context, and longer per-item summaries.
// Quick Answer keeps the lean defaults.
const QUICK = { candidateCount: 50, maxContextItems: 5, summaryMaxChars: 200 };
const DEEP = { candidateCount: 100, maxContextItems: 10, summaryMaxChars: 500 };

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
const MAX_TAKEAWAYS = 3;

function itemToContext(item, idx, summaryMaxChars) {
  const takeaways = !isEmptyTakeaways(item.key_takeaways)
    ? takeawaysToText(item.key_takeaways).split('\n').slice(0, MAX_TAKEAWAYS).map(l => `  - ${l}`).join('\n')
    : '  (none)';
  const tags = Array.isArray(item.tags) && item.tags.length
    ? item.tags.map(t => (typeof t === 'string' ? t : t.name)).filter(Boolean).join(', ')
    : '(none)';
  const date = item.date_saved || item.created_at || '(unknown)';
  const summary = item.summary
    ? item.summary.slice(0, summaryMaxChars)
    : '(none)';
  // Citation handle: a short, stable token (s1, s2…) the model copies verbatim
  // when citing. It maps positionally to the `sources` array emitted below, so
  // the frontend resolves it back to the real item.id without the model ever
  // having to count or transcribe a UUID.
  const handle = `s${idx + 1}`;
  const lines = [
    `### [${handle}] ${item.title}`,
    `Cite as: [[${handle}|${item.title}]]`,
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
//
// Persistence: library-wide chats (no restrictToItemId) are saved to the
// chats/messages tables. A chat row is created on the first turn; pass its id
// back as `chatId` to continue the same conversation. The user's question is
// saved up front; the assistant's answer is accumulated from the streamed text
// and saved once at the end. The terminating SSE is a { type: 'done', chatId }
// event followed by [DONE], so the client learns which chat it just wrote to.
async function answerQuestion({ userId, question, chatId, restrictToItemId, threshold, isDeep, write: rawWrite, end: rawEnd } = {}) {
  const cfg = isDeep ? DEEP : QUICK;
  const q = (question || '').trim();
  if (!q) {
    sseWrite(rawWrite, { type: 'empty' });
    sseDone(rawWrite, rawEnd);
    return;
  }

  // Only library-wide chats persist; single-doc chat (restrictToItemId) does not.
  const persist = !!(userId && !restrictToItemId);
  let activeChatId = chatId || null;
  let fullAnswer = '';

  if (persist) {
    try {
      if (!activeChatId) activeChatId = await createChat(userId, q);
      if (activeChatId) await saveMessage(userId, activeChatId, 'user', q);
    } catch (err) {
      console.error('[chat-history] failed to save question:', err.message);
      activeChatId = chatId || null; // keep streaming even if persistence fails
    }
  }

  // Tap the SSE stream: accumulate assistant text, and hold back the terminal
  // [DONE] marker so `end` can inject the { type: 'done', chatId } event (and
  // persist the answer) before the client closes the stream.
  const write = (chunk) => {
    if (chunk === 'data: [DONE]\n\n') return; // re-emitted by end()
    if (persist && typeof chunk === 'string' && chunk.startsWith('data: ')) {
      try {
        const evt = JSON.parse(chunk.slice(6, -2));
        if (evt && evt.type === 'text' && evt.text) fullAnswer += evt.text;
      } catch { /* non-JSON keepalive or partial — ignore */ }
    }
    rawWrite(chunk);
  };
  const end = async () => {
    if (persist && activeChatId && fullAnswer) {
      try {
        await saveMessage(userId, activeChatId, 'assistant', fullAnswer);
      } catch (err) {
        console.error('[chat-history] failed to save answer:', err.message);
      }
    }
    rawWrite(`data: ${JSON.stringify({ type: 'done', chatId: activeChatId })}\n\n`);
    rawWrite('data: [DONE]\n\n');
    rawEnd();
  };

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
    candidateCount: cfg.candidateCount,
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

  const contextItems = filtered.slice(0, cfg.maxContextItems);
  sseWrite(write, { type: 'progress', step: 'synthesizing', count: contextItems.length });

  const context = contextItems
    .map((item, idx) => itemToContext(item, idx, cfg.summaryMaxChars))
    .join('\n\n');

  const sources = contextItems.map(it => ({
    id: it.id,
    title: it.title,
    source_url: it.source_url,
    similarity: it.similarity
  }));

  // Send sources before text so inline citation chips can resolve while streaming.
  sseWrite(write, { type: 'sources', sources });

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

  sseDone(write, end);
}

module.exports = { answerQuestion };
