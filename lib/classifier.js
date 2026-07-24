const { getAnthropicClient } = require('./anthropicClient');
const { DEFAULT_SUBCATEGORY, normalizeTopCategory, normalizeSubcategoryLabel, getTopCategories } = require('./topCategories');

// The classifier prompts embed the closed top-category list, which is now
// DB-driven. The big prompt templates keep a literal __TOP_CATEGORIES__ marker
// (evaluated once at load); this injects the LIVE list at call time so a
// category added to the DB is offered to the classifier without a redeploy.
function withTopCategories(prompt) {
  return prompt.replace(/__TOP_CATEGORIES__/g, getTopCategories().join(' | '));
}

// Render the closed subcategory vocabulary for injection into the classifier
// prompt. `vocab` is { "<top_category name>": [{ name, description }] } as
// returned by repository.getSubcategoryVocabulary(). Each subcategory renders as
// `Name — definition` when a definition exists (so the model honors the label's
// intended boundary, e.g. subject-over-runtime), or as a bare `Name` otherwise.
// Every top_category is listed (even empty ones) so the model always sees the
// closed set for whichever category it picks.
function renderSubcategoryVocab(vocab) {
  const lines = getTopCategories().map(c => {
    const subs = (vocab && vocab[c]) || [];
    if (!subs.length) return `- ${c}: (none yet — you may create the first)`;
    const subLines = subs
      .map(s => `    • ${s.description ? `${s.name} — ${s.description}` : s.name}`)
      .join('\n');
    return `- ${c}:\n${subLines}`;
  });
  return `EXISTING SUBCATEGORIES (closed vocabulary — reuse an exact name when one reasonably fits; only propose a new label when none does):\n${lines.join('\n')}`;
}

// Enforce closed-vocabulary selection for the topic subcategory against the
// vocab snapshot for the item's chosen top_category. Runs AFTER
// normalizeCategoryFields (so item.top_category is a valid name and item.category
// is label-normalized). Sets item._newSubcategory so the write path knows whether
// to log a creation event. The ≥10 cap is per top_category (global vocabulary).
function reconcileSubcategory(item, vocab) {
  // Failed/blocked captures carry a deterministic 'Failed Capture' shelf that must
  // never enter the real vocabulary.
  if (item.unclassifiable) { item._newSubcategory = false; return; }
  // vocab entries are { name, description }; reconciliation only needs the names.
  const existing = ((vocab && vocab[item.top_category]) || []).map(e => e.name);
  const byLower = new Map(existing.map(n => [n.toLowerCase(), n]));
  const chosen = normalizeSubcategoryLabel(item.category) || DEFAULT_SUBCATEGORY;
  const match = byLower.get(chosen.toLowerCase());
  if (match) {
    // Reuse the canonical stored casing.
    item.category = match;
    item._newSubcategory = false;
  } else if (existing.length >= 10) {
    // Cap reached: reject the new label. Prefer the model's own closest existing
    // match; fall back to the first existing label, then to the default shelf.
    const fb = normalizeSubcategoryLabel(item.topic_subcategory_fallback);
    item.category = (fb && byLower.get(fb.toLowerCase())) || existing[0] || DEFAULT_SUBCATEGORY;
    item._newSubcategory = false;
  } else {
    // Genuinely new label under an uncapped category — accept and register.
    item.category = chosen;
    item._newSubcategory = true;
  }
  delete item.topic_subcategory_fallback;
}

const client = getAnthropicClient();

const MODEL = 'claude-haiku-4-5-20251001';

// The single unified extraction rule shared by SYSTEM_PROMPT and RESEARCH_PROMPT.
// Replaces the old skills-array rule and the highlights rule. An entity is a
// NAMED, ACTIONABLE thing the user can go get/use/browse — never a concept or
// summary. Emitted for EVERY save regardless of artifact_type.
const ENTITIES_RULE = `9. ENTITIES RULE:

Extract a top-level "entities" array. An entity is a NAMED, ACTIONABLE thing the user can go get, use, browse to, or reference — NOT a concept, summary, insight, or explanation.

Extract as entities:
- tools / products / apps / platforms (with a name)
- MCP servers and connectors (e.g. "Gmail MCP", "Filesystem MCP") — these are type "tool", NOT "skill"
- Claude skills or plugins — type "skill" ONLY when it is a named Claude skill/plugin invoked with a / command
- duas (with Arabic + translation)
- hadiths (with Arabic + translation)
- Quranic verses (with Arabic + translation)
- books, courses, repos, websites
- named workflows (only if they have a distinct proper name)
- real-world places worth visiting — restaurants, cafés, beaches, parks, landmarks, attractions, hotels, museums, neighborhoods (type "place")

For Islamic content, extract EACH dua, hadith, AND Quranic verse as its own separate entity — do not bundle them into a single resource entity. A post with 5 Quranic verses produces 5 quranic_verse entities.

For travel content, likewise extract EACH named place as its own separate "place" entity — a "5 hidden gems in the UAE" reel produces 5 place entities, not one resource. A place must be a specific named venue or spot someone can physically go to; a whole country or "the mountains" generically is NOT a place entity (but a named city, district, or island being recommended as a destination IS). Organizations without a fixed venue — communities, clubs, meetup groups, brands, online groups — are NOT places even when they gather somewhere; keep those as "resource". Never emit a country itself: for a country-level trip or itinerary, extract its named stops (lakes, towns, valleys, viewpoints) instead, or none if the content names none.

Disambiguating dua vs hadith vs quranic_verse:
- If the text is a verse quoted from the Qur'an, type is "quranic_verse" (even if it is a supplication like "Rabbana...").
- Otherwise, if the text is a supplication addressed to Allah (e.g. begins with "Allahumma...", "Rabbi...", "Rabbana...", or asks/seeks something from Allah), type is "dua" — even when its source is a hadith collection (e.g. Sahih al-Bukhari).
- Use "hadith" only for a narrated saying, report, or teaching of the Prophet ﷺ that is NOT itself a supplication.

Do NOT extract as entities:
- concepts, strategies, frameworks, business models
- summaries, insights, "primary value", "core benefit", results/metrics
- generic descriptions of what something does
- anything the user would ASK about rather than GO TO

Each entity has this shape:
{
  "type": "tool" | "skill" | "dua" | "hadith" | "quranic_verse" | "book" | "workflow" | "resource" | "place" | (invent a lowercase type if genuinely needed),
  "name": "the entity's name",
  "url": "direct URL if explicitly present in content, else null",
  "category_path": ["broad", "narrower", "narrowest"],
  "detail": { ...optional type-specific fields... }
}

category_path rules:
- An array representing a nesting hierarchy, broad to specific.
- Use 1 level when that's all that's clear: ["video editing"]
- Use 2-3 levels when the content supports it: ["design", "ui design"]
- Lowercase, short labels. Don't invent deep nesting that isn't real.

detail field (optional, type-specific):
- skill: { "command": "/x", "what_it_does": "one line under 12 words" }
- dua: { "arabic": "...", "translation": "...", "source": "...", "when_to_use": "..." (if present) }
- quranic_verse: { "arabic": "...", "translation": "...", "source": "Quran X:Y", "transliteration": "..." (if present) }
- hadith: { "arabic": "...", "translation": "...", "source": "..." }
- tool: { "what_it_does": "one line under 12 words" }
- place: { "what_it_is": "restaurant | cafe | beach | park | landmark | attraction | hotel | museum | neighborhood | other, one word", "city": "city name if known, else null", "country": "country name if known or clearly implied (e.g. a UAE roundup implies United Arab Emirates), else null", "why_go": "one line under 12 words — the content's pitch for it" }
- omit detail entirely if nothing type-specific applies

For a quranic_verse or dua entity, the "name" should be a short human label — e.g. the source reference ("Quran 3:173") or a 3-5 word descriptor of when it's used ("When something is out of your control").

DENYLIST — never extract these as entities (too ubiquitous):
Claude, ChatGPT, GPT, Gemini, Google, OpenAI, Anthropic.
The denylist covers ONLY these bare assistant/brand names. Named products built on them ARE extractable — e.g. "Claude Code" is a distinct tool (type "tool") and should be extracted, even though bare "Claude" must not be.

DEDUPLICATION within a single save: do not list the same named entity twice. (Cross-save dedup is handled by the dashboard, not here.)

One save can and should produce entities of MULTIPLE types — e.g. a workflow reel might yield several "tool" entities even though the save itself is about a workflow. Extract every actionable entity regardless of the save's overall topic. This includes the host environment a skill or workflow runs inside: a skill demo running inside Claude Code should yield BOTH the skill AND "Claude Code" (type "tool").`;

// Shared by SYSTEM_PROMPT and RESEARCH_PROMPT. Resolves the common ambiguity
// where AI/dev tools applied to a non-tech domain (design, marketing, etc.)
// were split inconsistently between Technology & AI and other top categories.
const TOP_CATEGORY_TIEBREAK = `TOP CATEGORY TIE-BREAK:
Classify by the content's PRIMARY SUBJECT — the outcome or domain the audience actually cares about — NOT by the tools it happens to use. The mere presence of an AI or software tool does NOT make something Technology & AI.

Choose Technology & AI ONLY when the AI/software/tool is itself the primary subject: what it is, how it works, how to build/use/configure it, model or tooling comparisons, agent design, or prompt engineering.

When AI or software is merely the MEANS to an end in another domain, classify by that domain instead:
- Getting a job, resume, interview prep, hiring, career growth, or professional/soft skills → Personal Development (use Education & Learning for structured courses or curricula).
- Making money, sales, marketing, lead generation, e-commerce, freelancing rates, pricing, business strategy or operations → Business & Finance.
- Investing, personal finance, banking, markets → Business & Finance.
- Cooking, health, travel, relationships, religion, home & lifestyle → that domain, even when an AI tool is used to produce or teach it.

Rule of thumb: mentally remove the specific AI/software tool. If the content is still about the same topic, THAT topic is the primary subject and the correct top category. Only when nothing meaningful remains without the tool is it Technology & AI.`;

const SYSTEM_PROMPT = `Classify and summarize the given content. Return ONLY a JSON object — no markdown fences, no preamble.

{
  "title": "concise descriptive title for this content",
  "top_category": "exactly one of: __TOP_CATEGORIES__ — NEVER any other value, never invent a new top-level category",
  "category": "the topic shelf this belongs on WITHIN top_category. Classify by the item's primary subject matter, not by whether it is a tool, tutorial, or thread. EXISTING SUBCATEGORIES per top_category are listed below (each shown as 'Name — definition' where a definition exists; honor the definition's boundary when choosing). For your chosen top_category, if any listed subcategory reasonably fits this content, return that name EXACTLY as written. Only if none reasonably fits may you propose a NEW short Title Case label (1-3 words, e.g. 'Prompt Engineering', 'Duas', 'Desserts'). Never invent a near-duplicate of an existing one.",
  "topic_subcategory_fallback": "ONLY when the value you put in 'category' is a NEW label not already listed for your chosen top_category: the closest EXISTING subcategory under that top_category (exact name), or null if that top_category has none listed. Otherwise null.",
  "tags": ["5 to 7 relevant tags as strings"],
  "type": "Video or Article",
  "summary": "2-3 sentence overview of what this content covers",
  "keyTakeaways": <object — structure you invent based on what this content actually contains>,
  "entities": [ <array of actionable named entities — see ENTITIES RULE below; [] if none> ],
  "has_lead_magnet_cta": "boolean — true only if the content tells viewers to comment a keyword to receive a link or resource (e.g. 'comment GUIDE and I'll DM you the link'), otherwise false",
  "artifact_type": "one of the defined artifact types below",
  "subcategory": "short lowercase label (2-3 words max) within the chosen artifact_type, or null when truly not classifiable",
  "artifact_name": "the name of the primary artifact, or null when not applicable",
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
7. Recipe / cooking video exception: When top_category is "Food & Cooking" AND the content is a recipe or cooking tutorial, put this structure INSIDE the keyTakeaways object (never as sibling root keys):
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
${ENTITIES_RULE}

${TOP_CATEGORY_TIEBREAK}

ARTIFACT TYPE RULES:
artifact_type must be one of these values, chosen strictly:

- "skill" — a named, installable Claude skill or plugin with a specific name and activation command. Must be something you install or invoke directly. NOT a workflow, strategy, or tool you use externally.
- "tool" — a standalone software product, app, SaaS, or platform that exists independently of Claude. Must have its own product page or website. NOT a Claude skill. NOT a concept or strategy.
- "concept" — a strategy, framework, business model, or approach with no direct install or product page.
- "workflow" — a multi-step repeatable process combining multiple tools or skills to achieve an outcome.
- "recipe" — a food recipe with ingredients and steps.
- "islamic" — Islamic content including duas, hadiths, khutbahs, lessons on aqeedah, fiqh, seerah, akhirah, prayer, family, or Quranic content.
- "resource" — a curated collection, directory, bundle, cheatsheet, or reference guide that contains multiple items.
- any other type Haiku judges necessary — invent sparingly, only when none of the above fit. Use lowercase, hyphenated if needed.

SUBCATEGORY RULES:
After determining artifact_type, also output a subcategory field.
This is a short lowercase label (2-3 words max) that groups similar items within the same type.

Use these guidance examples:
- skill: "video editing", "frontend development", "content creation", "automation", "coding", "design", "marketing"
- tool: "video generation", "no-code", "outreach", "productivity", "analytics", "ecommerce"
- concept: "business model", "marketing", "AI workflow", "productivity", "investing"
- workflow: "content production", "knowledge management", "lead generation", "development"
- islamic: "dua", "hadith", "akhirah", "prayer", "fiqh", "seerah", "family", "Quran"
- recipe: cuisine type or meal type such as "Pakistani", "dessert", "quick meals"
- resource: mirror relevant skill/tool subcategories above

Do not invent subcategories randomly — pick the closest match from these examples, or use a clear equivalent when needed.

To identify artifact_name, ask: "What is this content primarily teaching, introducing, or arguing for?" That answer is the artifact_name.

artifact_url rules — READ CAREFULLY:
- When artifact_type is set and a link to that artifact's primary page (e.g. its GitHub repo, official site, or download page) appears in the source you were given, copy that URL verbatim into artifact_url and set artifact_url_source to where it appeared (caption | content | linked resource).
- CRITICAL: artifact_url MUST be a URL that literally appears in the source provided to you. NEVER invent, guess, autocomplete, or recall a URL from prior knowledge. If no such link is present, set artifact_url AND artifact_url_source to null.
- Store the URL as a plain string. Never wrap it in markdown link syntax like [text](url).

Return ONLY the raw JSON object.`;

const RESEARCH_PROMPT = `You are a content classifier. Given a URL you cannot access directly, search for information about it and classify it. Return ONLY a JSON object — no markdown fences, no preamble.

{
  "title": "concise descriptive title for this content",
  "top_category": "exactly one of: __TOP_CATEGORIES__ — NEVER any other value, never invent a new top-level category",
  "category": "the topic shelf this belongs on WITHIN top_category. Classify by the item's primary subject matter, not by whether it is a tool, tutorial, or thread. EXISTING SUBCATEGORIES per top_category are listed below (each shown as 'Name — definition' where a definition exists; honor the definition's boundary when choosing). For your chosen top_category, if any listed subcategory reasonably fits this content, return that name EXACTLY as written. Only if none reasonably fits may you propose a NEW short Title Case label (1-3 words, e.g. 'Prompt Engineering', 'Duas', 'Desserts'). Never invent a near-duplicate of an existing one.",
  "topic_subcategory_fallback": "ONLY when the value you put in 'category' is a NEW label not already listed for your chosen top_category: the closest EXISTING subcategory under that top_category (exact name), or null if that top_category has none listed. Otherwise null.",
  "tags": ["5 to 7 relevant tags as strings"],
  "type": "Video or Article",
  "summary": "2-3 sentence overview of what this content covers",
  "keyTakeaways": <object — structure you invent based on what this content actually contains>,
  "entities": [ <array of actionable named entities — see ENTITIES RULE below; [] if none> ],
  "has_lead_magnet_cta": "boolean — true only if the content tells viewers to comment a keyword to receive a link or resource (e.g. 'comment GUIDE and I'll DM you the link'), otherwise false",
  "artifact_type": "one of the defined artifact types below",
  "subcategory": "short lowercase label (2-3 words max) within the chosen artifact_type, or null when truly not classifiable",
  "artifact_name": "the name of the primary artifact, or null when not applicable",
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
7. Recipe / cooking video exception: When top_category is "Food & Cooking" AND the content is a recipe or cooking tutorial, put this structure INSIDE the keyTakeaways object (never as sibling root keys):
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
${ENTITIES_RULE}

${TOP_CATEGORY_TIEBREAK}

ARTIFACT TYPE RULES:
artifact_type must be one of these values, chosen strictly:

- "skill" — a named, installable Claude skill or plugin with a specific name and activation command. Must be something you install or invoke directly. NOT a workflow, strategy, or tool you use externally.
- "tool" — a standalone software product, app, SaaS, or platform that exists independently of Claude. Must have its own product page or website. NOT a Claude skill. NOT a concept or strategy.
- "concept" — a strategy, framework, business model, or approach with no direct install or product page.
- "workflow" — a multi-step repeatable process combining multiple tools or skills to achieve an outcome.
- "recipe" — a food recipe with ingredients and steps.
- "islamic" — Islamic content including duas, hadiths, khutbahs, lessons on aqeedah, fiqh, seerah, akhirah, prayer, family, or Quranic content.
- "resource" — a curated collection, directory, bundle, cheatsheet, or reference guide that contains multiple items.
- any other type Haiku judges necessary — invent sparingly, only when none of the above fit. Use lowercase, hyphenated if needed.

SUBCATEGORY RULES:
After determining artifact_type, also output a subcategory field.
This is a short lowercase label (2-3 words max) that groups similar items within the same type.

Use these guidance examples:
- skill: "video editing", "frontend development", "content creation", "automation", "coding", "design", "marketing"
- tool: "video generation", "no-code", "outreach", "productivity", "analytics", "ecommerce"
- concept: "business model", "marketing", "AI workflow", "productivity", "investing"
- workflow: "content production", "knowledge management", "lead generation", "development"
- islamic: "dua", "hadith", "akhirah", "prayer", "fiqh", "seerah", "family", "Quran"
- recipe: cuisine type or meal type such as "Pakistani", "dessert", "quick meals"
- resource: mirror relevant skill/tool subcategories above

Do not invent subcategories randomly — pick the closest match from these examples, or use a clear equivalent when needed.

To identify artifact_name, ask: "What is this content primarily teaching, introducing, or arguing for?" That answer is the artifact_name.

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
  // highlights belongs inside keyTakeaways, but Haiku sometimes emits it as a
  // root key like passages/ingredients — rescue it so it isn't dropped.
  const highlights = Array.isArray(item.highlights) ? item.highlights : undefined;
  let takeaways = item.keyTakeaways ?? item.key_takeaways;

  if (typeof takeaways === 'string' && takeaways.trim()) {
    delete item.ingredients;
    delete item.cooking_steps;
    delete item.cookingSteps;
    delete item.steps;
    delete item.passages;
    delete item.highlights;
    item.keyTakeaways = takeaways;
    return;
  }

  if (Array.isArray(takeaways) && takeaways.length > 0 && !ingredients && !steps && !passages && !highlights) {
    delete item.ingredients;
    delete item.cooking_steps;
    delete item.cookingSteps;
    delete item.steps;
    delete item.passages;
    delete item.highlights;
    item.keyTakeaways = takeaways;
    return;
  }

  const obj = (takeaways && typeof takeaways === 'object' && !Array.isArray(takeaways))
    ? { ...takeaways }
    : {};

  if (ingredients) obj.ingredients = ingredients;
  if (steps) obj.cooking_steps = steps;
  if (passages) obj.passages = passages;
  if (highlights && !obj.highlights) obj.highlights = highlights;

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
  delete item.highlights;
}

// Failed-capture / junk detection. Some saves resolve to bot-block
// interstitials, error pages, or empty shells ("Access Denied", "Content Not
// Accessible", a bare CDN image URL) that have no real content to classify.
// Sending these through Haiku wastes a call and — worse — scatters them across
// real categories (a "Vercel Security Checkpoint" page reads as Technology &
// AI). Detect them deterministically and short-circuit to Other.
const FAILED_CAPTURE_PATTERNS = [
  /access denied/i,
  /security (?:verification|checkpoint)/i,
  /verify (?:you are|you're|that you are) (?:a )?human/i,
  /are you a robot/i,
  /\bcaptcha\b/i,
  /checking your browser/i,
  /(?:please )?enable javascript/i,
  /content (?:is )?(?:not|isn'?t) (?:accessible|available)/i,
  /this (?:content|video|page) (?:is|isn'?t) (?:unavailable|not available)/i,
  /\b(?:page|content) not found\b/i,
  /\b404\b[^\n]*not found/i,
];

// True when the fetched content looks like a blocked/empty/errored capture
// rather than real material. Conservative on purpose: long articles that merely
// mention "captcha" in passing must not trip this.
function isFailedCapture(content, caption) {
  const meaningful = `${content || ''}\n${caption || ''}`.replace(/\s+/g, ' ').trim();
  // A near-empty capture has nothing to classify.
  if (meaningful.length < 25 && !caption) return true;
  // Content that is nothing but a single bare URL (e.g. a raw CDN/asset link)
  // — no prose, no caption — has nothing to classify.
  if (!caption && /^https?:\/\/\S+$/i.test(meaningful)) return true;
  // Strong bot-block / error signals, but only in a SHORT body.
  if (meaningful.length < 600 && FAILED_CAPTURE_PATTERNS.some(re => re.test(meaningful))) {
    return true;
  }
  return false;
}

// Deterministic item for a failed capture — no LLM call. Routed to Other so it
// never pollutes a real top category; titled from whatever text we did capture
// so the card is still recognizable.
function buildUnclassifiableItem(content, caption) {
  const firstLine = String(caption || content || '')
    .split('\n').map(s => s.trim()).find(Boolean) || '';
  return {
    title: firstLine ? firstLine.slice(0, 120) : 'Unclassifiable content',
    top_category: 'Other',
    category: 'Failed Capture',
    tags: [],
    type: 'Article',
    summary: 'This link could not be captured (blocked page, error, or empty content) and was not classified.',
    keyTakeaways: {},
    entities: [],
    has_lead_magnet_cta: false,
    artifact_type: 'none',
    subcategory: null,
    artifact_name: null,
    artifact_url: null,
    artifact_url_source: null,
    unclassifiable: true,
  };
}

async function processContent(text, sourceUrl, hashtags, parts = {}, subcategoryVocab = {}) {
  // Pass the full content to Haiku — no truncation — so the structured
  // keyTakeaways object can reflect everything the source actually covers.
  const content = text || '';
  const caption = parts.caption || '';
  const captionBlock = caption ? `Caption: ${caption}\n\n` : '';

  let item;
  if (isFailedCapture(content, caption)) {
    // Skip the LLM entirely for junk/blocked captures.
    item = buildUnclassifiableItem(content, caption);
  } else {
    const response = await client.messages.create({
      model: MODEL,
      // Headroom for long sources (e.g. PDFs up to ~7,500 words): the structured
      // keyTakeaways object can grow large and was truncating at 2000, yielding
      // incomplete JSON. This is a ceiling, not a cost floor — short sources still
      // only generate what they need.
      max_tokens: 4000,
      // Inject the closed subcategory vocabulary so the model selects an existing
      // topic subcategory when one fits, rather than freely inventing labels.
      system: `${withTopCategories(SYSTEM_PROMPT)}\n\n${renderSubcategoryVocab(subcategoryVocab)}`,
      messages: [{
        role: 'user',
        content: `URL: ${sourceUrl}\n\n${captionBlock}Content:\n${content}\n\nClassify and summarize this content.`
      }]
    });

    const textBlock = response.content.filter(b => b.type === 'text').pop();
    if (!textBlock) throw new Error('No response from classifier');

    item = parseClassification(textBlock.text);
  }
  consolidateTakeaways(item);
  item.has_lead_magnet_cta = item.has_lead_magnet_cta === true;
  normalizeCategoryFields(item);
  // Constrain the topic subcategory to the closed vocabulary for its
  // top_category. No-op for failed captures (empty vocab, 'Failed Capture' label
  // is left as-is and never registered).
  reconcileSubcategory(item, subcategoryVocab);
  normalizeArtifactFields(item);
  // Guard against a hallucinated artifact_url: only keep it if it actually
  // appears in the source content/caption. Otherwise drop it to null.
  verifyArtifactUrl(item, [text, parts.caption]);
  // Same anti-hallucination guard for each entity's url.
  verifyEntityUrls(item, [text, parts.caption]);
  // Keep spoken transcript and caption separate for the output sections.
  item.transcript = parts.transcript !== undefined ? (parts.transcript || '') : text;
  item.caption = parts.caption || '';
  item.fileName = generateFileName(item);
  if (Array.isArray(hashtags) && hashtags.length > 0) {
    item.hashtags = hashtags;
  }
  return [item];
}

async function researchUrl(sourceUrl, subcategoryVocab = {}) {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    system: `${withTopCategories(RESEARCH_PROMPT)}\n\n${renderSubcategoryVocab(subcategoryVocab)}`,
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
  normalizeCategoryFields(item);
  reconcileSubcategory(item, subcategoryVocab);
  normalizeArtifactFields(item);
  // Research path uses web_search results, not provided content, so we don't
  // run the content-presence guard here — but the prompt still forbids fabrication.
  item.transcript = '';
  item.caption = '';
  item.fileName = generateFileName(item);
  return [item];
}

// Enforce the closed top_category list deterministically (the prompt already
// forbids inventing values, but this makes it a guarantee): anything outside
// the 13 clamps to 'Other'. The repurposed `category` (topic subcategory) is
// free-text — normalize its label and fall back to 'General' when missing.
function normalizeCategoryFields(item) {
  item.top_category = normalizeTopCategory(item.top_category) || 'Other';
  item.category = normalizeSubcategoryLabel(item.category) || DEFAULT_SUBCATEGORY;
}

const ARTIFACT_TYPES = ['skill', 'tool', 'concept', 'workflow', 'recipe', 'islamic', 'resource', 'person', 'none'];

// Normalize the artifact_* fields in place: clamp artifact_type to the allowed
// set, and force name/url to null when there is no artifact.
function normalizeArtifactFields(item) {
  const type = String(item.artifact_type || '').toLowerCase().trim();
  item.artifact_type = ARTIFACT_TYPES.includes(type) ? type : 'none';

  if (item.artifact_type === 'none') {
    item.artifact_name = null;
    item.artifact_url = null;
    item.subcategory = null;
    delete item.skills;
    return;
  }

  const subcategory = typeof item.subcategory === 'string' ? item.subcategory.trim().toLowerCase() : '';
  item.subcategory = subcategory || null;

  const name = typeof item.artifact_name === 'string' ? item.artifact_name.trim() : '';
  item.artifact_name = name || null;
  item.artifact_url = stripMarkdownLink(item.artifact_url);
  normalizeSkills(item);
}

// The skills array is only meaningful for skill-type saves. Drop it otherwise,
// and clean each entry to the { name, what_it_does, install_command, source_url }
// shape so downstream (front matter, dashboard) can rely on it.
function normalizeSkills(item) {
  if (item.artifact_type !== 'skill' || !Array.isArray(item.skills)) {
    delete item.skills;
    return;
  }
  const cleaned = item.skills
    .filter(s => s && typeof s === 'object' && !Array.isArray(s))
    .map(s => {
      const name = typeof s.name === 'string' ? s.name.trim() : '';
      const what = typeof s.what_it_does === 'string' ? s.what_it_does.trim() : '';
      return {
        name,
        what_it_does: what || null,
        install_command: typeof s.install_command === 'string' && s.install_command.trim()
          ? s.install_command.trim()
          : null,
        source_url: stripMarkdownLink(s.source_url)
      };
    })
    .filter(s => s.name);

  if (cleaned.length > 0) item.skills = cleaned;
  else delete item.skills;
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
  // Combined text the URL is verified against: transcript/content + caption +
  // the model's own summary.
  const haystack = [...sources, item.summary]
    .filter(s => typeof s === 'string')
    .join('\n')
    .toLowerCase();

  // Beyond the literal URL, match on the domain a transcript might mention
  // verbally: bare domain (no protocol/www/path), e.g. "mistral.ai", and the
  // domain minus its TLD, e.g. "mistral".
  const bareDomain = core.replace(/^www\./, '').split(/[/?#]/)[0];
  const domainName = bareDomain.includes('.')
    ? bareDomain.slice(0, bareDomain.lastIndexOf('.'))
    : bareDomain;

  const verified =
    (core && haystack.includes(core)) ||
    (bareDomain && haystack.includes(bareDomain)) ||
    (domainName && haystack.includes(domainName));

  if (verified) {
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

// Anti-hallucination guard for entity URLs: keep entity.url only when it
// genuinely appears in the source content/caption; otherwise null it. Also
// coerces item.entities to an array so downstream never sees a stray value.
function verifyEntityUrls(item, sources) {
  if (!Array.isArray(item.entities)) {
    item.entities = [];
    return;
  }
  const haystack = sources.filter(s => typeof s === 'string').join('\n').toLowerCase();
  for (const entity of item.entities) {
    if (!entity || typeof entity !== 'object') continue;
    const url = stripMarkdownLink(entity.url);
    if (!url) {
      entity.url = null;
      continue;
    }
    const core = url.replace(/^https?:\/\//i, '').toLowerCase();
    if (core && haystack.includes(core)) {
      entity.url = url;
    } else {
      console.warn(`[classifier] Dropping unverifiable entity url (not found in content): ${url}`);
      entity.url = null;
    }
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

module.exports = { processContent, researchUrl, processLinkedResource, TOP_CATEGORY_TIEBREAK, isFailedCapture };
