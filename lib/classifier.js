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
  "keyTakeaways": <object — structure you invent based on what this content actually contains>,
  "has_lead_magnet_cta": "boolean — true only if the content tells viewers to comment a keyword to receive a link or resource (e.g. 'comment GUIDE and I'll DM you the link'), otherwise false",
  "artifact_type": "exactly one of: skill | tool | resource | person | concept | none",
  "artifact_name": "the name of the primary artifact, or null if artifact_type is none",
  "artifact_url": "the primary link for this artifact, copied verbatim from the source — or null",
  "artifact_url_source": "where the link was found: caption | content | linked resource — or null if artifact_url is null"
}

Rules for keyTakeaways:
1. Output a JSON object with keys you invent. No fixed schema. Keys should feel obvious to someone who just read this content.
2. If the content is procedural (recipe, tutorial, how-to, workflow), capture actions in the exact order they happen. Use arrays of strings where each string is one discrete step. Number them implicitly by their array position. Do NOT summarize steps into concepts — extract the actual actions.
3. If the content is a list (9 tips, 7 habits, 5 steps), preserve the original count and original order. Each item must stand alone as a complete, actionable point — not a vague summary phrase.
4. If the source contains verbatim text that IS the content — Arabic text, a dua, a Quranic verse, code, a direct quote, a formula — reproduce it exactly as a string value. Do not paraphrase it. Create a dedicated key for it.
5. Values can be strings, arrays of strings, or nested objects. Use nesting when the content has genuine subcategories (e.g. ingredients split into Base, Aromatics, Spices). Do not nest for the sake of it.
6. Never return a flat top-level array. Always an object.
7. Recipe / cooking video exception: When category is "Food & Cooking" AND the content is a recipe or cooking tutorial, put this structure INSIDE the keyTakeaways object (never as sibling root keys):
   - "ingredients": array of strings (each ingredient with quantity if stated). Omit this key only if no ingredients are mentioned anywhere in the source.
   - "cooking_steps": array of strings — REQUIRED. Each string is one discrete cooking action in chronological order. Do not merge or summarize steps.
   - You may add additional keys inside keyTakeaways after these (e.g. "tips", "serving", "substitutions", "timing") for anything else worth preserving.
   - Inside keyTakeaways, list "ingredients" before "cooking_steps". Use these exact key names.
   - CRITICAL: ingredients and cooking_steps must be nested under keyTakeaways, not at the root of the JSON response.
8. Sacred text / Islamic content exception: When the content features du'a (supplication), hadith, or Quranic verses — especially when Arabic is spoken or shown — put this structure INSIDE the keyTakeaways object (never as sibling root keys):
   - "passages": array of objects — REQUIRED when any du'a, hadith, or Quranic verse appears. One object per distinct passage, in the order presented.
   - Each passage object MUST include:
     - "arabic": string — REQUIRED. Copy the Arabic text exactly as it appears in the source (transcript, caption, on-screen text). Character-for-character. Never paraphrase, transliterate, or replace with English.
     - "type": exactly one of "dua" | "hadith" | "quranic_verse"
   - Each passage object MAY include (only when stated in the source):
     - "translation": English meaning or explanation given in the source
     - "source": reference such as "Sahih Bukhari 1234" or "Surah Al-Baqarah 2:255"
     - "transliteration": romanized pronunciation only if explicitly provided in the source
   - You may add additional keys inside keyTakeaways after passages (e.g. "context", "benefits", "when_to_recite", "notes") for surrounding explanation.
   - CRITICAL: passages must be nested under keyTakeaways, not at the root of the JSON response.
   - CRITICAL: If Arabic appears anywhere in the source for a du'a/hadith/verse, it MUST appear in passages[].arabic. Never omit Arabic in favor of an English summary.

To identify artifact_name, ask: "What is this content primarily teaching, introducing, or arguing for?" That answer is the artifact_name — not the tools, platforms, or environments mentioned along the way.

A tool used to demonstrate or enable a concept is NOT the artifact. The concept being taught IS the artifact.

Examples:
- Content teaches AI Loops using Claude Code → artifact_type: concept, artifact_name: AI Loops
- Content demos Granola as a meeting tool → artifact_type: tool, artifact_name: Granola
- Content shows how to install a resume-tailoring Claude skill → artifact_type: skill, artifact_name: Resume Tailor Skill
- Content is an interview with Andrej Karpathy → artifact_type: person, artifact_name: Andrej Karpathy
- Content is a cooking tutorial → artifact_type: none, artifact_name: null, keyTakeaways: { "ingredients": ["2 cups flour", "..."], "cooking_steps": ["Preheat oven to 350°F", "Mix dry ingredients", "..."] }
- Islamic video teaching a morning dua → artifact_type: none, artifact_name: null, keyTakeaways: { "passages": [{ "type": "dua", "arabic": "اللَّهُمَّ بِكَ أَصْبَحْنَا وَبِكَ أَمْسَيْنَا...", "translation": "O Allah, by You we enter the morning and by You we enter the evening..." }], "when_to_recite": "Upon waking" }

Type priority order (use the first one that fits):
skill → tool → resource → person → concept → none

artifact_url rules — READ CAREFULLY:
- When artifact_type is set and a link to that artifact's primary page (e.g. its GitHub repo, official site, or download page) appears in the source you were given, copy that URL verbatim into artifact_url and set artifact_url_source to where it appeared (caption | content | linked resource).
- CRITICAL: artifact_url MUST be a URL that literally appears in the source provided to you. NEVER invent, guess, autocomplete, or recall a URL from prior knowledge. If no such link is present, set artifact_url AND artifact_url_source to null.
- Store the URL as a plain string. Never wrap it in markdown link syntax like [text](url).

Return ONLY the raw JSON object.`;

const RESEARCH_PROMPT = `You are a content classifier. Given a URL you cannot access directly, search for information about it and classify it. Return ONLY a JSON object — no markdown fences, no preamble.

{
  "title": "concise descriptive title for this content",
  "category": "exactly one of: Food & Cooking | Technology | Health & Fitness | Finance | Learning & Education | Entertainment | Travel | Business & Career | Personal Development | Other",
  "tags": ["5 to 7 relevant tags as strings"],
  "type": "Video or Article",
  "summary": "2-3 sentence overview of what this content covers",
  "keyTakeaways": <object — structure you invent based on what this content actually contains>,
  "has_lead_magnet_cta": "boolean — true only if the content tells viewers to comment a keyword to receive a link or resource (e.g. 'comment GUIDE and I'll DM you the link'), otherwise false",
  "artifact_type": "exactly one of: skill | tool | resource | person | concept | none",
  "artifact_name": "the name of the primary artifact, or null if artifact_type is none",
  "artifact_url": "the primary link for this artifact, copied verbatim from the source — or null",
  "artifact_url_source": "where the link was found: caption | content | linked resource — or null if artifact_url is null"
}

Rules for keyTakeaways:
1. Output a JSON object with keys you invent. No fixed schema. Keys should feel obvious to someone who just read this content.
2. If the content is procedural (recipe, tutorial, how-to, workflow), capture actions in the exact order they happen. Use arrays of strings where each string is one discrete step. Number them implicitly by their array position. Do NOT summarize steps into concepts — extract the actual actions.
3. If the content is a list (9 tips, 7 habits, 5 steps), preserve the original count and original order. Each item must stand alone as a complete, actionable point — not a vague summary phrase.
4. If the source contains verbatim text that IS the content — Arabic text, a dua, a Quranic verse, code, a direct quote, a formula — reproduce it exactly as a string value. Do not paraphrase it. Create a dedicated key for it.
5. Values can be strings, arrays of strings, or nested objects. Use nesting when the content has genuine subcategories (e.g. ingredients split into Base, Aromatics, Spices). Do not nest for the sake of it.
6. Never return a flat top-level array. Always an object.
7. Recipe / cooking video exception: When category is "Food & Cooking" AND the content is a recipe or cooking tutorial, put this structure INSIDE the keyTakeaways object (never as sibling root keys):
   - "ingredients": array of strings (each ingredient with quantity if stated). Omit this key only if no ingredients are mentioned anywhere in the source.
   - "cooking_steps": array of strings — REQUIRED. Each string is one discrete cooking action in chronological order. Do not merge or summarize steps.
   - You may add additional keys inside keyTakeaways after these (e.g. "tips", "serving", "substitutions", "timing") for anything else worth preserving.
   - Inside keyTakeaways, list "ingredients" before "cooking_steps". Use these exact key names.
   - CRITICAL: ingredients and cooking_steps must be nested under keyTakeaways, not at the root of the JSON response.
8. Sacred text / Islamic content exception: When the content features du'a (supplication), hadith, or Quranic verses — especially when Arabic is spoken or shown — put this structure INSIDE the keyTakeaways object (never as sibling root keys):
   - "passages": array of objects — REQUIRED when any du'a, hadith, or Quranic verse appears. One object per distinct passage, in the order presented.
   - Each passage object MUST include:
     - "arabic": string — REQUIRED. Copy the Arabic text exactly as it appears in the source (transcript, caption, on-screen text). Character-for-character. Never paraphrase, transliterate, or replace with English.
     - "type": exactly one of "dua" | "hadith" | "quranic_verse"
   - Each passage object MAY include (only when stated in the source):
     - "translation": English meaning or explanation given in the source
     - "source": reference such as "Sahih Bukhari 1234" or "Surah Al-Baqarah 2:255"
     - "transliteration": romanized pronunciation only if explicitly provided in the source
   - You may add additional keys inside keyTakeaways after passages (e.g. "context", "benefits", "when_to_recite", "notes") for surrounding explanation.
   - CRITICAL: passages must be nested under keyTakeaways, not at the root of the JSON response.
   - CRITICAL: If Arabic appears anywhere in the source for a du'a/hadith/verse, it MUST appear in passages[].arabic. Never omit Arabic in favor of an English summary.

To identify artifact_name, ask: "What is this content primarily teaching, introducing, or arguing for?" That answer is the artifact_name — not the tools, platforms, or environments mentioned along the way.

A tool used to demonstrate or enable a concept is NOT the artifact. The concept being taught IS the artifact.

Examples:
- Content teaches AI Loops using Claude Code → artifact_type: concept, artifact_name: AI Loops
- Content demos Granola as a meeting tool → artifact_type: tool, artifact_name: Granola
- Content shows how to install a resume-tailoring Claude skill → artifact_type: skill, artifact_name: Resume Tailor Skill
- Content is an interview with Andrej Karpathy → artifact_type: person, artifact_name: Andrej Karpathy
- Content is a cooking tutorial → artifact_type: none, artifact_name: null, keyTakeaways: { "ingredients": ["2 cups flour", "..."], "cooking_steps": ["Preheat oven to 350°F", "Mix dry ingredients", "..."] }
- Islamic video teaching a morning dua → artifact_type: none, artifact_name: null, keyTakeaways: { "passages": [{ "type": "dua", "arabic": "اللَّهُمَّ بِكَ أَصْبَحْنَا وَبِكَ أَمْسَيْنَا...", "translation": "O Allah, by You we enter the morning and by You we enter the evening..." }], "when_to_recite": "Upon waking" }

Type priority order (use the first one that fits):
skill → tool → resource → person → concept → none

artifact_url rules — READ CAREFULLY:
- When artifact_type is set and a link to that artifact's primary page (e.g. its GitHub repo, official site, or download page) appears in the source you were given, copy that URL verbatim into artifact_url and set artifact_url_source to where it appeared (caption | content | linked resource).
- CRITICAL: artifact_url MUST be a URL that literally appears in the source provided to you. NEVER invent, guess, autocomplete, or recall a URL from prior knowledge. If no such link is present, set artifact_url AND artifact_url_source to null.
- Store the URL as a plain string. Never wrap it in markdown link syntax like [text](url).

Return ONLY the raw JSON object.`;

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

function consolidateTakeaways(item) {
  // Haiku sometimes emits ingredients/cooking_steps/passages as root keys instead of
  // nesting them under keyTakeaways. Merge those into keyTakeaways before save.
  const ingredients = item.ingredients;
  const steps = item.cooking_steps ?? item.cookingSteps ?? item.steps;
  const passages = item.passages;
  let takeaways = item.keyTakeaways ?? item.key_takeaways;

  if (typeof takeaways === 'string' && takeaways.trim()) {
    delete item.ingredients;
    delete item.cooking_steps;
    delete item.cookingSteps;
    delete item.steps;
    delete item.passages;
    item.keyTakeaways = takeaways;
    return;
  }

  if (Array.isArray(takeaways) && takeaways.length > 0 && !ingredients && !steps && !passages) {
    delete item.ingredients;
    delete item.cooking_steps;
    delete item.cookingSteps;
    delete item.steps;
    delete item.passages;
    item.keyTakeaways = takeaways;
    return;
  }

  const obj = (takeaways && typeof takeaways === 'object' && !Array.isArray(takeaways))
    ? { ...takeaways }
    : {};

  if (ingredients) obj.ingredients = ingredients;
  if (steps) obj.cooking_steps = steps;
  if (passages) obj.passages = passages;

  if (Object.keys(obj).length > 0) {
    item.keyTakeaways = obj;
  } else if (takeaways !== undefined) {
    item.keyTakeaways = takeaways;
  }

  delete item.ingredients;
  delete item.cooking_steps;
  delete item.cookingSteps;
  delete item.steps;
  delete item.passages;
}

async function processContent(text, sourceUrl, hashtags, parts = {}) {
  // Pass the full content to Haiku — no truncation — so the structured
  // keyTakeaways object can reflect everything the source actually covers.
  const content = text || '';
  const caption = parts.caption || '';
  const captionBlock = caption ? `Caption: ${caption}\n\n` : '';

  const response = await client.messages.create({
    model: MODEL,
    // Headroom for long sources (e.g. PDFs up to ~7,500 words): the structured
    // keyTakeaways object can grow large and was truncating at 2000, yielding
    // incomplete JSON. This is a ceiling, not a cost floor — short sources still
    // only generate what they need.
    max_tokens: 4000,
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `URL: ${sourceUrl}\n\n${captionBlock}Content:\n${content}\n\nClassify and summarize this content.`
    }]
  });

  const textBlock = response.content.filter(b => b.type === 'text').pop();
  if (!textBlock) throw new Error('No response from classifier');

  const item = parseClassification(textBlock.text);
  consolidateTakeaways(item);
  item.has_lead_magnet_cta = item.has_lead_magnet_cta === true;
  normalizeArtifactFields(item);
  // Guard against a hallucinated artifact_url: only keep it if it actually
  // appears in the source content/caption. Otherwise drop it to null.
  verifyArtifactUrl(item, [text, parts.caption]);
  // Keep spoken transcript and caption separate for the output sections.
  item.transcript = parts.transcript !== undefined ? (parts.transcript || '') : text;
  item.caption = parts.caption || '';
  item.fileName = generateFileName(item);
  if (Array.isArray(hashtags) && hashtags.length > 0) {
    item.hashtags = hashtags;
  }
  return [item];
}

async function researchUrl(sourceUrl) {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
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
  consolidateTakeaways(item);
  item.has_lead_magnet_cta = item.has_lead_magnet_cta === true;
  normalizeArtifactFields(item);
  // Research path uses web_search results, not provided content, so we don't
  // run the content-presence guard here — but the prompt still forbids fabrication.
  item.transcript = '';
  item.caption = '';
  item.fileName = generateFileName(item);
  return [item];
}

const ARTIFACT_TYPES = ['skill', 'tool', 'resource', 'person', 'concept', 'none'];

// Normalize the artifact_* fields in place: clamp artifact_type to the allowed
// set, and force name/url to null when there is no artifact.
function normalizeArtifactFields(item) {
  const type = String(item.artifact_type || '').toLowerCase().trim();
  item.artifact_type = ARTIFACT_TYPES.includes(type) ? type : 'none';

  if (item.artifact_type === 'none') {
    item.artifact_name = null;
    item.artifact_url = null;
    return;
  }

  const name = typeof item.artifact_name === 'string' ? item.artifact_name.trim() : '';
  item.artifact_name = name || null;
  item.artifact_url = stripMarkdownLink(item.artifact_url);
}

// "[text](url)" → "url"; plain strings pass through; non-strings/empty → null.
function stripMarkdownLink(value) {
  if (typeof value !== 'string') return null;
  const s = value.trim();
  const linked = s.match(/^\[[^\]]*\]\(([^)]+)\)$/);
  const url = (linked ? linked[1] : s).trim();
  return url || null;
}

// Anti-hallucination guard: keep artifact_url only if it genuinely appears in the
// source content/caption. The model is instructed never to invent URLs, but this
// makes it deterministic. Clears artifact_url + source when not found.
function verifyArtifactUrl(item, sources) {
  if (!item.artifact_url) {
    item.artifact_url_source = null;
    return;
  }
  const core = item.artifact_url.replace(/^https?:\/\//i, '').toLowerCase();
  const haystack = sources.filter(s => typeof s === 'string').join('\n').toLowerCase();

  if (core && haystack.includes(core)) {
    const src = typeof item.artifact_url_source === 'string' ? item.artifact_url_source.trim() : '';
    item.artifact_url_source = src || 'content';
  } else {
    if (item.artifact_url) {
      console.warn(`[classifier] Dropping unverifiable artifact_url (not found in content): ${item.artifact_url}`);
    }
    item.artifact_url = null;
    item.artifact_url_source = null;
  }
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
