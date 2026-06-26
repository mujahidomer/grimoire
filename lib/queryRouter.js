const Anthropic = require('@anthropic-ai/sdk');

// Query router (chat pipeline). Classifies an incoming chat question into one of
// two jobs so the pipeline can branch:
//   JOB_A — find/recall specific saved content  → existing retrieval pipeline
//   JOB_B — analytics about the library as a whole → lib/libraryAnalytics.js
// Classification is a cheap Haiku call. It must NEVER crash the pipeline: any
// failure, timeout, or malformed response defaults to JOB_A (the safe path).

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const ROUTER_MODEL = 'claude-haiku-4-5-20251001';

const SYSTEM_PROMPT = `You are a query classifier for a personal knowledge library.
Classify the user's question as one of two types:

JOB_A: The user wants to find or recall specific saved content.
Examples: "what did I save about RAG?", "find me that video about cold plunge recovery", "what is agentic AI?", "summarise what I know about productivity"

JOB_B: The user wants analytics or statistics about their library as a whole.
Examples: "what are my main saved topics?", "how many Instagram saves do I have?", "who do I save most from?", "what did I save this month?", "what are the themes across my saves?", "which platform do I save from most?", "what are all the design skills I've saved?", "list every tool across my saves", "what are the themes of everything I saved?", "show me all recipes I've saved", "what skills appear most across my library?", "give me every X from all my links", "across all my saves, what...", "from all my saved links, list..."

Rule: any question asking for a complete list or aggregation across the entire library is JOB_B, even if it mentions a specific content type like skills, tools, or recipes.

Respond with JSON only: {"type": "JOB_A"} or {"type": "JOB_B"}`;

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

// Returns 'JOB_A' or 'JOB_B'. Defaults to 'JOB_A' on any error or invalid output.
async function classifyQuery(question) {
  const q = (question || '').trim();
  if (!q) return 'JOB_A';

  try {
    const response = await client.messages.create({
      model: ROUTER_MODEL,
      max_tokens: 20,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: q }]
    });

    const textBlock = response.content.filter(b => b.type === 'text').pop();
    const parsed = textBlock ? extractJsonObject(textBlock.text) : null;
    return parsed && parsed.type === 'JOB_B' ? 'JOB_B' : 'JOB_A';
  } catch (err) {
    console.error('[router] classify failed, defaulting to JOB_A:', err.message);
    return 'JOB_A';
  }
}

module.exports = { classifyQuery };
