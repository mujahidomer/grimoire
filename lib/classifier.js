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
  "keyTakeaways": ["takeaway 1", "takeaway 2", "takeaway 3"],
  "has_lead_magnet_cta": "boolean — true only if the content tells viewers to comment a keyword to receive a link or resource (e.g. 'comment GUIDE and I'll DM you the link'), otherwise false"
}

keyTakeaways must have 3-5 items. Return ONLY the raw JSON object.`;

const RESEARCH_PROMPT = `You are a content classifier. Given a URL you cannot access directly, search for information about it and classify it. Return ONLY a JSON object — no markdown fences, no preamble.

{
  "title": "concise descriptive title for this content",
  "category": "exactly one of: Food & Cooking | Technology | Health & Fitness | Finance | Learning & Education | Entertainment | Travel | Business & Career | Personal Development | Other",
  "tags": ["5 to 7 relevant tags as strings"],
  "type": "Video or Article",
  "summary": "2-3 sentence overview of what this content covers",
  "keyTakeaways": ["takeaway 1", "takeaway 2", "takeaway 3"],
  "has_lead_magnet_cta": "boolean — true only if the content tells viewers to comment a keyword to receive a link or resource (e.g. 'comment GUIDE and I'll DM you the link'), otherwise false"
}

keyTakeaways must have 3-5 items. Return ONLY the raw JSON object.`;

const LINKED_RESOURCE_PROMPT = `You are cleaning a linked resource so it can be appended to an existing note. The input is raw extracted web content (often full of navigation menus, image links, template/example listings, and footer text). Do TWO things and return ONLY a JSON object — no markdown fences, no preamble.

1. Classify the resource_type as exactly one of:
   - "product" — a tool/product/service homepage or landing page
   - "article" — a guide, tutorial, blog post, or explainer
   - "resource" — a direct deliverable (doc, PDF, template, gist, download page)

2. Produce a cleaned "content" body appropriate to the type:
   - product: 3-6 lines max. What it is, what it does, key features, pricing if visible. NO navigation text, NO template/example listings, NO footer content, NO image references.
   - article: a "Summary" paragraph followed by "Key Takeaways" as a markdown bullet list. Cap at ~300 words.
   - resource: the core content, cleaned of boilerplate, links-only lines, and image markdown. Cap at ~500 words.

Return exactly:
{
  "resource_type": "product | article | resource",
  "title": "concise descriptive title for this resource",
  "content": "the cleaned body as described above"
}

Return ONLY the raw JSON object.`;

// Used only by the append path: classify + clean a linked resource via Haiku.
// Never throws — on failure returns a truncated raw fallback so the append still happens.
async function processLinkedResource(text, fallbackTitle) {
  const truncated = (text || '').substring(0, 8000);

  if (!truncated.trim()) {
    return {
      resource_type: 'resource',
      title: fallbackTitle || 'Linked Resource',
      content: '_Content could not be extracted._',
      processingFailed: false
    };
  }

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1500,
      system: LINKED_RESOURCE_PROMPT,
      messages: [{
        role: 'user',
        content: `Content:\n${truncated}\n\nClassify and clean this linked resource.`
      }]
    });

    const textBlock = response.content.filter(b => b.type === 'text').pop();
    if (!textBlock) throw new Error('No response from classifier');

    const parsed = parseClassification(textBlock.text);
    const validTypes = ['product', 'article', 'resource'];
    const resource_type = validTypes.includes(parsed.resource_type) ? parsed.resource_type : 'resource';
    const content = (parsed.content || '').trim();

    return {
      resource_type,
      title: parsed.title || fallbackTitle || 'Linked Resource',
      content: content || '_No content extracted._',
      processingFailed: false
    };
  } catch (err) {
    console.error('Linked resource processing failed:', err.message);
    return {
      resource_type: 'resource',
      title: fallbackTitle || 'Linked Resource',
      content: `_Automatic processing failed — showing raw excerpt._\n\n${truncated.substring(0, 1000)}`,
      processingFailed: true
    };
  }
}

async function processContent(text, sourceUrl, hashtags) {
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
  item.has_lead_magnet_cta = item.has_lead_magnet_cta === true;
  item.transcript = text;
  item.fileName = generateFileName(item);
  if (Array.isArray(hashtags) && hashtags.length > 0) {
    item.hashtags = hashtags;
  }
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
  item.has_lead_magnet_cta = item.has_lead_magnet_cta === true;
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

module.exports = { processContent, researchUrl, processLinkedResource };
