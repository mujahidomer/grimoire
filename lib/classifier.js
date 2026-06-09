const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MODEL = 'claude-haiku-4-5-20251001';

const SYSTEM_PROMPT = `Classify and summarize the given content. Return ONLY a JSON object — no markdown fences, no preamble.

{
  "title": "concise descriptive title for this content",
  "category": "exactly one of: Food & Cooking | Technology | Health & Fitness | Finance | Learning & Education | Entertainment | Travel | Business & Career | Personal Development | Other",
  "tags": ["5 to 7 relevant tags as strings"],
  "type": "Video or Article",
  "summary": "2-3 sentence overview of what this content covers",
  "keyTakeaways": ["takeaway 1", "takeaway 2", "takeaway 3"]
}

keyTakeaways must have 3-5 items. Return ONLY the raw JSON object.`;

const RESEARCH_PROMPT = `You are a content classifier. Given a URL you cannot access directly, search for information about it and classify it. Return ONLY a JSON object — no markdown fences, no preamble.

{
  "title": "concise descriptive title for this content",
  "category": "exactly one of: Food & Cooking | Technology | Health & Fitness | Finance | Learning & Education | Entertainment | Travel | Business & Career | Personal Development | Other",
  "tags": ["5 to 7 relevant tags as strings"],
  "type": "Video or Article",
  "summary": "2-3 sentence overview of what this content covers",
  "keyTakeaways": ["takeaway 1", "takeaway 2", "takeaway 3"]
}

keyTakeaways must have 3-5 items. Return ONLY the raw JSON object.`;

async function processContent(text, sourceUrl) {
  const truncated = text.substring(0, 8000);

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1000,
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `URL: ${sourceUrl}\n\nContent:\n${truncated}\n\nClassify and summarize this content.`
    }]
  });

  const textBlock = response.content.filter(b => b.type === 'text').pop();
  if (!textBlock) throw new Error('No response from classifier');

  const item = parseClassification(textBlock.text);
  item.transcript = text;
  item.fileName = generateFileName(item);
  return [item];
}

async function researchUrl(sourceUrl) {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1000,
    system: RESEARCH_PROMPT,
    tools: [{
      type: 'web_search_20250305',
      name: 'web_search'
    }],
    messages: [{
      role: 'user',
      content: `Search for information about this URL and classify it: ${sourceUrl}\n\nReturn the JSON classification object.`
    }]
  });

  const textBlock = response.content.filter(b => b.type === 'text').pop();
  if (!textBlock) throw new Error('No response from classifier');

  const item = parseClassification(textBlock.text);
  item.transcript = '';
  item.fileName = generateFileName(item);
  return [item];
}

function parseClassification(text) {
  let s = text.replace(/```json\n?/gi, '').replace(/```\n?/g, '').trim();

  const start = s.indexOf('{');
  if (start === -1) throw new Error(`No JSON object found: ${s.substring(0, 200)}`);

  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{' || ch === '[') depth++;
    if (ch === '}' || ch === ']') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(s.slice(start, i + 1));
        } catch (err) {
          throw new Error(`Invalid JSON: ${s.slice(start, i + 1).substring(0, 200)}`);
        }
      }
    }
  }
  throw new Error(`Incomplete JSON object: ${s.substring(0, 200)}`);
}

function generateFileName(item) {
  const slug = (item.title || 'untitled')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .substring(0, 50)
    .replace(/-+$/, '');
  return `${slug}.md`;
}

module.exports = { processContent, researchUrl };
