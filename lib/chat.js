const Anthropic = require('@anthropic-ai/sdk');
const { semanticSearch } = require('./embeddings');

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

// Compact, token-bounded context block per item. Full transcripts are truncated;
// the summary + key takeaways carry the signal.
function itemToContext(item, idx) {
  const takeaways = Array.isArray(item.key_takeaways) && item.key_takeaways.length
    ? item.key_takeaways.map(t => `  - ${t}`).join('\n')
    : '  (none)';
  const transcript = (item.transcript || '').slice(0, 1500);
  return [
    `### [${idx + 1}] ${item.title}`,
    `Category: ${item.category} · Type: ${item.type}`,
    `Source: ${item.source_url}`,
    `Summary: ${item.summary || '(none)'}`,
    `Key takeaways:\n${takeaways}`,
    transcript ? `Excerpt: ${transcript}` : ''
  ].filter(Boolean).join('\n');
}

// answerQuestion → { answer, empty, sources }. When retrieval clears nothing,
// returns an explicit empty state and does NOT call the model — the caller must
// surface "nothing saved on that" rather than letting the model invent an answer.
async function answerQuestion({ userId, question, restrictToItemId, limit, threshold } = {}) {
  const q = (question || '').trim();
  if (!q) return { answer: '', empty: true, sources: [] };

  let items = await semanticSearch({ userId, query: q, limit, threshold });

  // Single-doc chat (deferred feature, hook in place): restrict to one item.
  if (restrictToItemId) items = items.filter(it => it.id === restrictToItemId);

  if (items.length === 0) {
    return {
      answer: "I don't have anything saved on that. Nothing in your library matches this question closely enough to answer it honestly.",
      empty: true,
      sources: []
    };
  }

  const context = items.map(itemToContext).join('\n\n');
  const response = await client.messages.create({
    model: CHAT_MODEL,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `Saved library items:\n\n${context}\n\n---\n\nQuestion: ${q}`
    }]
  });

  const textBlock = response.content.filter(b => b.type === 'text').pop();
  return {
    answer: textBlock ? textBlock.text.trim() : '',
    empty: false,
    sources: items.map(it => ({
      id: it.id,
      title: it.title,
      source_url: it.source_url,
      similarity: it.similarity
    }))
  };
}

module.exports = { answerQuestion };
