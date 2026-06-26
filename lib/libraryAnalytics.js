const Anthropic = require('@anthropic-ai/sdk');
const { getSupabase } = require('./supabase');

// Library analytics (Job B of the chat router). Whole-library questions —
// counts, themes, platform breakdowns, date ranges — that the retrieval
// pipeline (Job A) cannot answer because they are statistics ABOUT the library,
// not lookups INSIDE it. Sonnet generates a single read-only SELECT, we execute
// it via the exec_read_query RPC (read-only, 100-row + 10s caps enforced in SQL),
// then Sonnet turns the rows into a natural-language answer.
//
// Streams over the same SSE contract as lib/chat.js (write/end callbacks):
//   { type: 'progress', step: 'analysing' } → text chunks → { type: 'sources', sources: [] } → [DONE]
// Job B answers come from the database, so sources is always empty.

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const ANALYTICS_MODEL = process.env.CHAT_MODEL || 'claude-sonnet-4-6';

const SQL_SYSTEM_PROMPT = `You are a SQL query generator for a personal knowledge library stored in Postgres.
Generate a single read-only SELECT query to answer the user's question.

Schema:
- items (id uuid, user_id uuid, title text, source_url text, category text, summary text, caption text, created_at timestamptz)
- tags (id uuid, name text)
- item_tags (item_id uuid, tag_id uuid, confidence_pending boolean)
- embeddings (item_id uuid, chunk_index int, chunk_text text)

Platform is determined from source_url domain:
- instagram.com → Instagram
- youtube.com or youtu.be → YouTube
- twitter.com or x.com → Twitter/X
- linkedin.com → LinkedIn
- All queries must filter by user_id = '<userId>'

Rules:
1. Only generate SELECT statements — never INSERT, UPDATE, DELETE, DROP
2. Always include WHERE user_id = '<userId>'
3. For platform questions, use source_url ILIKE '%instagram.com%' pattern
4. For tag/theme questions, JOIN items → item_tags → tags
5. For date questions, use created_at with date_trunc or date comparisons
6. Keep queries simple — no CTEs, no subqueries more than one level deep
7. Respond with JSON only: {"sql": "SELECT ..."}`;

const ANSWER_SYSTEM_PROMPT = `You are Grimoire's analytics assistant. You are given a user's question about their saved library and the result rows of a database query that answers it. Write a clear, direct, natural-language answer grounded ONLY in the provided rows. Rules:
- State the numbers and findings plainly. Do not invent data not present in the rows.
- When the rows are a breakdown (by platform, tag, month, etc.), summarise the shape — the top entries and notable counts — rather than dumping every row.
- Be concise. No preamble like "Based on the data".`;

function sseWrite(write, data) {
  write(`data: ${JSON.stringify(data)}\n\n`);
}

function sseDone(write, end) {
  write('data: [DONE]\n\n');
  end();
}

// Extract the first {...} JSON object from a model response, tolerating fences
// and preamble. Returns null when no parseable object is present.
function extractJsonObject(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch (err) {
    return null;
  }
}

// Ask Sonnet for a SELECT. Returns the validated SQL string, or null when the
// response is unusable (bad JSON, or not a SELECT).
async function generateSql(question, userId) {
  const system = SQL_SYSTEM_PROMPT.replaceAll('<userId>', userId);
  const response = await client.messages.create({
    model: ANALYTICS_MODEL,
    max_tokens: 512,
    system,
    messages: [{ role: 'user', content: question }]
  });

  const textBlock = response.content.filter(b => b.type === 'text').pop();
  const parsed = textBlock ? extractJsonObject(textBlock.text) : null;
  const sql = parsed && typeof parsed.sql === 'string' ? parsed.sql.trim() : '';
  if (!sql || !/^select\b/i.test(sql)) return { sql: null, usage: response.usage };
  return { sql, usage: response.usage };
}

// answerLibraryQuery streams the Job B answer via write/end (same contract as
// lib/chat.js answerQuestion). Never throws into the caller — emits an error SSE
// and closes the stream on failure.
async function answerLibraryQuery({ question, userId, write, end } = {}) {
  sseWrite(write, { type: 'progress', step: 'analysing' });

  try {
    const { sql, usage: sqlUsage } = await generateSql(question, userId);
    if (!sql) {
      sseWrite(write, { type: 'error', message: 'Could not generate a valid query for that question.' });
      sseDone(write, end);
      return;
    }

    const sb = getSupabase();
    const { data, error } = await sb.rpc('exec_read_query', { query_text: sql });
    if (error) {
      console.error('[analytics] query failed:', error.message, '\nSQL:', sql);
      sseWrite(write, { type: 'error', message: 'The analytics query failed to run.' });
      sseDone(write, end);
      return;
    }

    const rows = Array.isArray(data) ? data.slice(0, 100) : [];
    if (rows.length === 0) {
      sseWrite(write, { type: 'empty' });
      sseDone(write, end);
      return;
    }

    const stream = client.messages.stream({
      model: ANALYTICS_MODEL,
      max_tokens: 1024,
      system: ANSWER_SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: `Question: ${question}\n\nQuery results (JSON):\n${JSON.stringify(rows, null, 2)}\n\nAnswer the question.`
      }]
    });

    stream.on('text', (text) => {
      if (text) sseWrite(write, { type: 'text', text });
    });

    const final = await stream.finalMessage();
    const usage = {
      input_tokens: (sqlUsage?.input_tokens ?? 0) + (final.usage?.input_tokens ?? 0),
      output_tokens: (sqlUsage?.output_tokens ?? 0) + (final.usage?.output_tokens ?? 0)
    };
    if (usage.input_tokens || usage.output_tokens) {
      sseWrite(write, { type: 'meta', model: ANALYTICS_MODEL, usage });
    }

    // Job B answers come from the database aggregate, not individual saved items.
    sseWrite(write, { type: 'sources', sources: [] });
    sseDone(write, end);
  } catch (err) {
    console.error('[analytics] answerLibraryQuery failed:', err.message);
    sseWrite(write, { type: 'error', message: err.message });
    sseDone(write, end);
  }
}

module.exports = { answerLibraryQuery };
