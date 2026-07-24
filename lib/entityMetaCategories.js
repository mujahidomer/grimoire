// The closed meta_category vocabulary for canonical_entities, plus the one
// implementation of "which meta_category does this entity belong to".
//
// meta_category is the top shelf the iOS Digest groups entities under; a null
// lands the entity in "Uncategorized". Until now it was only ever written by
// the one-off backfill scripts (scripts/entity-backfill-*.js), which each held
// their own byte-identical copy of the lookup tables below — so every entity
// created at save time by lib/entityResolution.js got a null. This module is
// that shared source of truth, and the save path now calls it.
//
// WHY A MODULE AND NOT A TABLE (cf. top_categories, which is DB-driven with a
// code seed): these four lists are closed and per-entity_type. Unlike a
// top-level category, adding a meta_category is not a row insert — the Digest
// lays out a page per meta_category, so it is a product decision plus client
// work, not a config change. Keeping it in code also avoids a manual Supabase
// DDL step. The shape below (frozen list + normalize-or-null) mirrors
// lib/topCategories.js, so promoting it to a table later is one
// refreshMetaCategories() away.
//
// The invariant that matters: nothing here may ever invent a meta_category.
// Every path returns either a member of META_CATEGORIES[type] or null.

// The approved vocabulary — 9 tool / 9 skill / 7 resource / 5 workflow, plus
// one shared shelf for the three Islamic entity types. Every value in
// LABEL_DEFAULT/ENTITY_OVERRIDE below is one of these, and the model fallback
// is clamped to them.
// One thematic list shared by dua / islamic_concept / quranic_verse (and by
// hadith once it is registered — see the standing decision below).
const ISLAMIC_SHELVES = [
  'Forgiveness & Repentance',
  'Praise & Gratitude',
  'Protection & Well-being',
  'Provision & Sustenance',
  'Guidance & Decisions',
  'Faith & Trust in Allah',
  'Worship & Practice',
  'The Self & Character',
];

const META_CATEGORIES = {
  tool: [
    'AI Agents, Automation & Integrations',
    'AI Models & Platforms',
    'Business, Career & Security',
    'Design & Creative',
    'Knowledge & Research',
    'Marketing & Content',
    'Productivity & Collaboration',
    'Software Development',
    'Video & Audio Production',
  ],
  skill: [
    'AI/Agent Development & Tooling',
    'Automation & Workflow',
    'Career & Resume',
    'Content & Media Creation',
    'Design & Frontend Engineering',
    'Knowledge & Documentation',
    'Marketing & Advertising',
    'Prompting & Agent Behavior',
    'Testing & Quality',
  ],
  resource: [
    'AI & Learning Resources',
    'Business & Career Resources',
    'Community & Newsletters',
    'Design & Web References',
    'Islamic Resources',
    'Media & Entertainment',
    'Personal Life & Hobbies',
  ],
  workflow: [
    'Agent Systems',
    'Career Workflows',
    'Development Workflows',
    'Marketing & Content Workflows',
    'Personal & Business Workflows',
  ],
  // The Islamic entity types share one thematic vocabulary, following the
  // Digest's organizing principle everywhere else: the top level is what KIND
  // of thing it is (tool, dua, verse), the meta level splits by its NATURE
  // within that kind — design vs. marketing for tools, forgiveness vs.
  // provision here. (An earlier single shared 'Islamic Knowledge' shelf broke
  // that pattern by restating the type; replaced 2026-07-24 at Muji's call.)
  // Derived from the actual saved content, with "none fit" as the escape.
  //
  // STANDING DECISION (2026-07-24): `hadith` is not yet registered in
  // canonical_entities — it appears in items.entities[] but has zero canonical
  // rows, which is a separate issue. When it IS registered it maps HERE, to
  // ISLAMIC_SHELVES like the other three. Settled, not a question to
  // re-derive.
  dua: ISLAMIC_SHELVES,
  islamic_concept: ISLAMIC_SHELVES,
  quranic_verse: ISLAMIC_SHELVES,
};

// ── Category lookup tables — the approved per-type mapping, transcribed as
// data. Moved here verbatim from scripts/entity-backfill-write.js, which held
// the original alongside a byte-identical copy in entity-backfill-dry-run.js;
// both scripts now import it from here. Each value is
// [canonical_label, meta_category] — the label is the sub-grouping the
// backfill wrote into category_path, the second element is what this module
// exists to produce. ──
const LABEL_DEFAULT = {
  tool: {
    'video generation': ['video generation', 'Video & Audio Production'],
    'ai models': ['ai models', 'AI Models & Platforms'],
    'fleet management': ['fleet & tracking systems', 'Business, Career & Security'],
    'design inspiration': ['design inspiration', 'Design & Creative'],
    'marketing': ['marketing tools', 'Marketing & Content'],
    'ai agents': ['ai agents', 'AI Agents, Automation & Integrations'],
    'ai': ['ai platforms', 'AI Models & Platforms'],
    'automation': ['automation platforms', 'AI Agents, Automation & Integrations'],
    'web scraping': ['web scraping', 'AI Agents, Automation & Integrations'],
    'communication': ['communication tools', 'Productivity & Collaboration'],
    'marketing automation': ['marketing automation', 'Marketing & Content'],
    'audio processing': ['audio tools', 'Video & Audio Production'],
    'image generation': ['image generation', 'Video & Audio Production'],
    'video editing': ['video editing', 'Video & Audio Production'],
    'mobile development': ['mobile development', 'Software Development'],
    'design systems': ['component library', 'Design & Creative'],
    'video': ['video editing', 'Video & Audio Production'],
    'ai audio': ['audio tools', 'Video & Audio Production'],
    'research': ['research tools', 'Knowledge & Research'],
    'job boards': ['job search tools', 'Business, Career & Security'],
    'wearable tracking': ['fleet & tracking systems', 'Business, Career & Security'],
    'fleet security': ['fleet & tracking systems', 'Business, Career & Security'],
    'agent infrastructure': ['agent infrastructure', 'AI Agents, Automation & Integrations'],
    'creative': ['video generation', 'Video & Audio Production'],
    'hosting': ['hosting & deployment', 'Software Development'],
    'job search automation': ['job search tools', 'Business, Career & Security'],
    'knowledge management': ['knowledge management', 'Knowledge & Research'],
    'knowledge retrieval': ['knowledge management', 'Knowledge & Research'],
    'content analysis': ['research tools', 'Knowledge & Research'],
    'stock photography': ['design resources', 'Design & Creative'],
    'portfolio': ['design inspiration', 'Design & Creative'],
    'recipe management': ['recipe management', 'Productivity & Collaboration'],
    'developer tools': ['coding assistant', 'Software Development'],
    'token optimization': ['coding assistant', 'Software Development'],
    'video analysis': ['video analysis', 'Video & Audio Production'],
    'accounting': ['accounting', 'Business, Career & Security'],
    'advertising': ['marketing tools', 'Marketing & Content'],
    'ai integration': ['integration platforms', 'AI Agents, Automation & Integrations'],
    'ai coaching': ['ai coaching', 'Productivity & Collaboration'],
    'content generation': ['content generation', 'Marketing & Content'],
    'web development': ['ai web builder', 'Software Development'],
    'islamic': ['lifestyle apps', 'Productivity & Collaboration'],
    'video download': ['video processing', 'Video & Audio Production'],
    'media processing': ['video processing', 'Video & Audio Production'],
    'transcription': ['audio tools', 'Video & Audio Production'],
    'analytics': ['product analytics', 'Productivity & Collaboration'],
    'browser extension': ['fact-checking', 'Knowledge & Research'],
    'typography': ['design resources', 'Design & Creative'],
    'ai content creation': ['video generation', 'Video & Audio Production'],
    'ai coding': ['coding assistant', 'Software Development'],
    'research automation': ['research tools', 'Knowledge & Research'],
    'design system': ['component library', 'Design & Creative'],
    'email automation': ['email & outreach automation', 'Marketing & Content'],
    'file management': ['content/file storage', 'Productivity & Collaboration'],
    'data infrastructure': ['data infrastructure', 'AI Agents, Automation & Integrations'],
    'ai platform': ['ai platforms', 'AI Models & Platforms'],
    'collaboration': ['collaboration tools', 'Productivity & Collaboration'],
    'ios development': ['mobile development', 'Software Development'],
    'documentation': ['component library', 'Design & Creative'],
    'no-code': ['ai web builder', 'Software Development'],
    'integration': ['ai agents', 'AI Agents, Automation & Integrations'],
    'ai services': ['ai platforms', 'AI Models & Platforms'],
    'development environment': ['coding assistant', 'Software Development'],
    'local models': ['ai models', 'AI Models & Platforms'],
    'api integration': ['integration platforms', 'AI Agents, Automation & Integrations'],
    'video platform': ['video platform', 'Video & Audio Production'],
    'user research': ['user research', 'Knowledge & Research'],
  },
  skill: {
    'design': ['ui/frontend design skills', 'Design & Frontend Engineering'],
    'frontend development': ['ui/frontend design skills', 'Design & Frontend Engineering'],
    'prompting': ['prompt engineering skills', 'Prompting & Agent Behavior'],
    'trust': ['agent trust & safety skills', 'Prompting & Agent Behavior'],
    'interaction': ['agent interaction skills', 'Prompting & Agent Behavior'],
    'advertising': ['ad creative skills', 'Marketing & Advertising'],
    'automation': ['automation skills', 'Automation & Workflow'],
    'resume optimization': ['resume skills', 'Career & Resume'],
    'graphics': ['generative art skills', 'Content & Media Creation'],
    'video': ['video/media creation skills', 'Content & Media Creation'],
    'claude code': ['project setup skills', 'AI/Agent Development & Tooling'],
    'interview preparation': ['resume skills', 'Career & Resume'],
    'ai agents': ['agent orchestration skills', 'AI/Agent Development & Tooling'],
    'testing': ['testing skills', 'Testing & Quality'],
    '3d': ['video/media creation skills', 'Content & Media Creation'],
    'mobile development': ['mobile dev skills', 'AI/Agent Development & Tooling'],
    'development': ['coding efficiency skills', 'AI/Agent Development & Tooling'],
    'web design': ['ui/frontend design skills', 'Design & Frontend Engineering'],
    'motion design': ['video/media creation skills', 'Content & Media Creation'],
    'video generation': ['video/media creation skills', 'Content & Media Creation'],
    'video analysis': ['video/media creation skills', 'Content & Media Creation'],
    'product design': ['ui/frontend design skills', 'Design & Frontend Engineering'],
    'ai development & tooling': ['video/media creation skills', 'Content & Media Creation'],
  },
  resource: {
    'design': ['design & component references', 'Design & Web References'],
    'learning': ['ai learning resources', 'AI & Learning Resources'],
    'islamic': ['islamic resources', 'Islamic Resources'],
    'ai': ['ai learning resources', 'AI & Learning Resources'],
    'ai workflow': ['ai learning resources', 'AI & Learning Resources'],
    'coaching': ['career coaching', 'Business & Career Resources'],
    'television': ['entertainment', 'Media & Entertainment'],
    'community': ['communities', 'Community & Newsletters'],
    'news': ['news & media', 'Media & Entertainment'],
    'youtube': ['news & media', 'Media & Entertainment'],
    'membership': ['memberships', 'Community & Newsletters'],
    'agentic ai': ['ai learning resources', 'AI & Learning Resources'],
    'food': ['cooking & food', 'Personal Life & Hobbies'],
    'travel': ['travel', 'Personal Life & Hobbies'],
    'uae employment': ['employment resources', 'Business & Career Resources'],
    'islamic scholarship': ['islamic resources', 'Islamic Resources'],
    'ai agents': ['ai learning resources', 'AI & Learning Resources'],
    'parenting': ['islamic resources', 'Islamic Resources'],
    'islamic life design': ['islamic resources', 'Islamic Resources'],
    'cooking': ['cooking & food', 'Personal Life & Hobbies'],
    'web design': ['design & component references', 'Design & Web References'],
    'open-source': ['open source repos', 'AI & Learning Resources'],
    'claude code': ['ai learning resources', 'AI & Learning Resources'],
    'design systems': ['design & component references', 'Design & Web References'],
    'video': ['ai learning resources', 'AI & Learning Resources'],
    'entrepreneurship': ['business & entrepreneurship', 'Business & Career Resources'],
    'research': ['ai learning resources', 'AI & Learning Resources'],
  },
  workflow: {
    'marketing automation': ['marketing workflows', 'Marketing & Content Workflows'],
    'web development': ['web build workflows', 'Development Workflows'],
    'career': ['job search workflows', 'Career Workflows'],
    'multi-agent systems': ['agent orchestration workflows', 'Agent Systems'],
    'brand experience': ['marketing workflows', 'Marketing & Content Workflows'],
    'strength training': ['personal & fitness workflows', 'Personal & Business Workflows'],
    'business intelligence': ['business ops workflows', 'Personal & Business Workflows'],
    'knowledge management': ['business ops workflows', 'Personal & Business Workflows'],
    'content creation': ['marketing workflows', 'Marketing & Content Workflows'],
    'ai agents': ['agent orchestration workflows', 'Agent Systems'],
  },
};

const ENTITY_OVERRIDE = {
  tool: {
    'kittl flows': ['ai design tools', 'Design & Creative'], 'shadcn mcp': ['component library', 'Design & Creative'],
    'higgs field': ['video generation', 'Video & Audio Production'], 'sora': ['video generation', 'Video & Audio Production'],
    'gpt 5.6 sol': ['ai web builder', 'Software Development'], 'gramotion': ['motion graphics', 'Video & Audio Production'],
    'gamma': ['presentation tools', 'Productivity & Collaboration'], 'border beam effect': ['component library', 'Design & Creative'],
    'nano banana': ['image generation', 'Video & Audio Production'], 'stitch': ['component library', 'Design & Creative'],
    'reicon': ['design resources', 'Design & Creative'], 'figma motion': ['motion graphics', 'Video & Audio Production'],
    'reve image': ['image generation', 'Video & Audio Production'], 'swishy ai': ['motion graphics', 'Video & Audio Production'],
    'figma': ['component library', 'Design & Creative'], 'figma cli': ['component library', 'Design & Creative'],
    'astryx': ['component library', 'Design & Creative'], 'grovia': ['design resources', 'Design & Creative'],
    'animated component library': ['component library', 'Design & Creative'], 'google flow': ['motion graphics', 'Video & Audio Production'],
    'ui design dictionary': ['design resources', 'Design & Creative'], 'open design': ['ai design tools', 'Design & Creative'],
    '21st.dev': ['component library', 'Design & Creative'], 'figma console mcp': ['component library', 'Design & Creative'],
    'perplexity mcp': ['research tools', 'Knowledge & Research'], 'superpowers': ['agent capability plugins', 'AI Agents, Automation & Integrations'],
    'gstack': ['coding assistant', 'Software Development'], 'codex-plugin-cc': ['coding assistant', 'Software Development'],
    'financial-services': ['specialist vertical plugins', 'Business, Career & Security'], 'claude-for-legal': ['specialist vertical plugins', 'Business, Career & Security'],
    'claude-skills': ['skill/plugin management', 'AI Agents, Automation & Integrations'], 'marketingskills': ['marketing plugins', 'Marketing & Content'],
    'social-media-skills': ['marketing plugins', 'Marketing & Content'], 'granola': ['productivity connectors', 'Productivity & Collaboration'],
    'slack mcp': ['communication tools', 'Productivity & Collaboration'], 'notion mcp': ['productivity connectors', 'Productivity & Collaboration'],
    'kondo': ['productivity connectors', 'Productivity & Collaboration'], 'zapier mcp': ['automation platforms', 'AI Agents, Automation & Integrations'],
    'agent-browser': ['browser & agent automation', 'AI Agents, Automation & Integrations'], 'codex': ['coding assistant', 'Software Development'],
    'context7': ['research tools', 'Knowledge & Research'], 'google calendar': ['productivity connectors', 'Productivity & Collaboration'],
    'gmail': ['productivity connectors', 'Productivity & Collaboration'], 'google drive': ['productivity connectors', 'Productivity & Collaboration'],
    'notion': ['productivity connectors', 'Productivity & Collaboration'], 'claudekit': ['agent frameworks', 'Productivity & Collaboration'],
    'claudekit trade': ['agent frameworks', 'Productivity & Collaboration'], 'google sheets': ['productivity connectors', 'Productivity & Collaboration'],
    'github copilot': ['coding assistant', 'Software Development'], 'river': ['coding assistant', 'Software Development'],
    'claude code': ['coding assistant', 'Software Development'], 'google ai studio': ['ai web builder', 'Software Development'],
    'anti-gravity agent': ['ai web builder', 'Software Development'], 'graphify': ['coding assistant', 'Software Development'],
    'agent skills library': ['skill marketplace', 'AI Agents, Automation & Integrations'], 'perspective mcp': ['marketing automation', 'Marketing & Content'],
    'postgres mcp': ['coding assistant', 'Software Development'], 'vercel mcp': ['hosting & deployment', 'Software Development'],
    'scrapegraph mcp server': ['web scraping', 'AI Agents, Automation & Integrations'], 'higgsfield mcp': ['video generation', 'Video & Audio Production'],
    'elevenlabs': ['audio tools', 'Video & Audio Production'], 'dreamcut': ['video generation', 'Video & Audio Production'],
    'seedance 2.0': ['video generation', 'Video & Audio Production'], 'grok imagine video': ['video generation', 'Video & Audio Production'],
    'google veo': ['video generation', 'Video & Audio Production'], 'github': ['coding assistant', 'Software Development'],
    'claude code chat': ['coding assistant', 'Software Development'], 'claude console': ['coding assistant', 'Software Development'],
    'cursor': ['coding assistant', 'Software Development'], 'playwright mcp': ['browser & agent automation', 'AI Agents, Automation & Integrations'],
    'firecrow': ['web scraping', 'AI Agents, Automation & Integrations'], 'glyph': ['image generation', 'Video & Audio Production'],
    'chrome mcp': ['browser & agent automation', 'AI Agents, Automation & Integrations'],
    'secutronic ai platform': ['physical & iot security', 'Business, Career & Security'],
    'psim (physical security information management)': ['physical & iot security', 'Business, Career & Security'],
    'idas (integrated detection and assessment system)': ['physical & iot security', 'Business, Career & Security'],
    'nvidia nemo guardrails': ['llm security & guardrails', 'Business, Career & Security'],
    'emergent': ['ai web builder', 'Software Development'], 'plot': ['ai web builder', 'Software Development'],
    'e1 agent': ['ai web builder', 'Software Development'], 'g-stack': ['coding assistant', 'Software Development'],
    'kimi work': ['automation platforms', 'AI Agents, Automation & Integrations'], 'mcp market': ['skill marketplace', 'AI Agents, Automation & Integrations'],
    'cloud tag': ['ai agents', 'AI Agents, Automation & Integrations'],
  },
  skill: {
    'fine skills': ['skill management', 'AI/Agent Development & Tooling'], 'claude memory': ['knowledge management skills', 'Knowledge & Documentation'],
    'vibe sec': ['security review skills', 'AI/Agent Development & Tooling'], 'hyperframes': ['skill management', 'AI/Agent Development & Tooling'],
    'ai-second-brain': ['knowledge management skills', 'Knowledge & Documentation'], 'notebooklm-skill': ['knowledge management skills', 'Knowledge & Documentation'],
    'humanizer': ['content & marketing skills', 'Marketing & Advertising'], 'claude-seo': ['content & marketing skills', 'Marketing & Advertising'],
    'skills': ['skill management', 'AI/Agent Development & Tooling'], 'caveman': ['skill management', 'AI/Agent Development & Tooling'],
    'marketingskills': ['content & marketing skills', 'Marketing & Advertising'], 'social-media-skills': ['content & marketing skills', 'Marketing & Advertising'],
    'doc skills': ['document generation skills', 'Knowledge & Documentation'],
    "emil's design engineering skills": ['ui/frontend design skills', 'Design & Frontend Engineering'],
    'engineering skills': ['agent/skill development', 'AI/Agent Development & Tooling'], 'document skills': ['document generation skills', 'Knowledge & Documentation'],
    'mcp builder': ['agent/skill development', 'AI/Agent Development & Tooling'], 'webapp testing': ['testing skills', 'Testing & Quality'],
    'frontend design': ['ui/frontend design skills', 'Design & Frontend Engineering'], 'skill creator': ['agent/skill development', 'AI/Agent Development & Tooling'],
    'ai trend tracker': ['research skills', 'Knowledge & Documentation'], 'graphy fine': ['coding efficiency skills', 'AI/Agent Development & Tooling'],
    'ponytail': ['coding efficiency skills', 'AI/Agent Development & Tooling'], 'graphify': ['coding efficiency skills', 'AI/Agent Development & Tooling'],
  },
};
// The static lookup, unchanged in substance from the backfill scripts'
// categoryFor(): a name-level override wins, then the raw first path segment.
// Returns [canonical_label, meta_category], or null when neither table has a
// key — e.g. Al Wazir Basmati Rice / Atman Retreat, deliberately unmapped.
//
// Both keys are trimmed/lowercased before lookup (every key in both tables is
// already lowercase, so this only catches casing drift in freshly-extracted
// paths like "Design" — it can never reach a different entry).
function categoryFor(type, name, rawLabel) {
  const nameKey = typeof name === 'string' ? name.trim().toLowerCase() : '';
  const labelKey = typeof rawLabel === 'string' ? rawLabel.trim().toLowerCase() : '';
  const override = nameKey && ENTITY_OVERRIDE[type] && ENTITY_OVERRIDE[type][nameKey];
  if (override) return override;
  const byLabel = labelKey && LABEL_DEFAULT[type] && LABEL_DEFAULT[type][labelKey];
  if (byLabel) return byLabel;
  return null;
}

// Clamp a raw value to the closed list for one entity_type (case-insensitive,
// tolerant of whitespace and "and" vs "&"). Returns the canonical spelling, or
// null when it isn't in the list — the same posture as
// topCategories.normalizeTopCategory, minus an 'Other' bucket: an entity we
// can't place keeps meta_category null rather than being forced somewhere.
const byLowerPerType = new Map();
for (const [type, names] of Object.entries(META_CATEGORIES)) {
  const map = new Map();
  for (const name of names) map.set(name.toLowerCase(), name);
  byLowerPerType.set(type, map);
}

function normalizeMetaCategory(type, value) {
  const map = byLowerPerType.get(type);
  if (!map || typeof value !== 'string') return null;
  const cleaned = value.trim().replace(/\s+/g, ' ');
  if (!cleaned) return null;
  return (
    map.get(cleaned.toLowerCase()) ||
    map.get(cleaned.toLowerCase().replace(/\band\b/g, '&').replace(/\s+/g, ' ')) ||
    null
  );
}

function getMetaCategories(type) {
  return META_CATEGORIES[type] || [];
}

// ─── Model fallback ──────────────────────────────────────────────────────────

// Why a model at all: the tables are keyed on the raw first path segment, and
// freshly-extracted entities routinely carry segments that were never keys
// ("design", "ai development", "development", "social media", "mcp"). A pure
// lookup therefore keeps producing nulls for exactly the rows this module is
// meant to fix. The model only ever runs on a table miss, only ever picks from
// that type's frozen list, and its answer is re-clamped through
// normalizeMetaCategory — so it can add coverage but never new vocabulary.
const MODEL = 'claude-haiku-4-5-20251001';

// Example sub-labels per meta_category, derived from the tables above, so the
// prompt describes each shelf by what actually lives on it rather than by its
// name alone.
function exampleLabels(type, meta) {
  const seen = [];
  for (const table of [LABEL_DEFAULT[type], ENTITY_OVERRIDE[type]]) {
    for (const [label, metaCategory] of Object.values(table || {})) {
      if (metaCategory === meta && !seen.includes(label)) seen.push(label);
    }
  }
  return seen.slice(0, 6);
}

function buildSystemPrompt(type) {
  const options = getMetaCategories(type).map(meta => {
    const examples = exampleLabels(type, meta);
    return examples.length ? `- "${meta}" — e.g. ${examples.join(', ')}` : `- "${meta}"`;
  }).join('\n');

  return `You file one newly-saved ${type} entity from a personal bookmarking library onto exactly one shelf ("meta-category"). The shelves are a fixed, closed list — they are the top-level grouping the library's Digest tab renders, so a wrong or invented shelf is worse than no shelf at all.

Shelves for entity_type="${type}" (the "e.g." items are sub-labels of things already filed there):
${options}

Rules:
- Pick the shelf that fits what the entity actually IS and DOES, per its description — not what topic it is merely adjacent to.
- Copy the chosen shelf name VERBATIM from the list above. Never invent, reword, merge, shorten or re-case one.
- Answer "NONE" when the entity genuinely does not belong on any shelf, or when you would be guessing between two unrelated ones. "NONE" is a correct, expected answer — leaving it unfiled is better than a wrong shelf.

Return ONLY a raw JSON object — no markdown fences, no preamble:
{"meta_category": "<shelf name verbatim>" | "NONE", "reason": "<one short sentence>"}`;
}

// Extract the first complete JSON object from a model response (the
// object-shaped twin of the bracket-depth parser used in entityResolution.js,
// subcategoryConsolidation.js, tags.js).
function parseObject(text) {
  const s = String(text || '').replace(/```json\n?/gi, '').replace(/```\n?/g, '').trim();
  const start = s.indexOf('{');
  if (start === -1) throw new Error(`No JSON object found: ${s.substring(0, 200)}`);
  let depth = 0, inString = false, escape = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) return JSON.parse(s.slice(start, i + 1));
    }
  }
  throw new Error(`Incomplete JSON object: ${s.substring(0, 200)}`);
}

function buildUserMessage({ name, description, categoryPath }) {
  const path = Array.isArray(categoryPath) && categoryPath.length ? categoryPath.join(' > ') : '(none)';
  return `Entity: "${name}"\nDescription: ${description || '(none given)'}\nExtracted category path: ${path}\n\nWhich shelf?`;
}

// One Haiku call for one entity. Returns a verbatim member of the type's list,
// or null (explicit "NONE", an unrecognized answer, or any failure — the
// caller must not be able to tell those apart, they all mean "leave it null").
async function classifyWithModel(type, entity) {
  const { getAnthropicClient } = require('./anthropicClient');
  const response = await getAnthropicClient().messages.create({
    model: MODEL,
    max_tokens: 200,
    system: buildSystemPrompt(type),
    messages: [{ role: 'user', content: buildUserMessage(entity) }]
  });
  const textBlock = response.content.filter(b => b.type === 'text').pop();
  if (!textBlock) throw new Error('No response from meta-category classifier');

  const raw = parseObject(textBlock.text);
  const answer = typeof raw.meta_category === 'string' ? raw.meta_category.trim() : '';
  if (!answer || answer.toUpperCase() === 'NONE') return null;
  // Hallucination guard, same posture as entityResolution's verbatim-canonical
  // check: an answer that isn't in the closed list is discarded, not coerced.
  return normalizeMetaCategory(type, answer);
}

// The one entry point the save path uses: static table first (every
// already-approved decision, no token spend), model only on a miss, null when
// nothing fits. Never throws — a classification failure must leave the entity
// unfiled, never block the save (same posture as resolveEntities itself).
async function resolveMetaCategory(type, { name, description, categoryPath } = {}) {
  if (!type || !META_CATEGORIES[type] || !name) return null;

  // A single-shelf type has nothing to decide: every member of the type belongs
  // on its one shelf whatever its extracted path says. Short-circuit ahead of
  // both the tables and the model — asking Haiku to choose from a list of one
  // is pure token spend, and its "NONE" escape would wrongly leave the row null.
  const shelves = META_CATEGORIES[type];
  if (shelves.length === 1) return shelves[0];

  const rawLabel = Array.isArray(categoryPath) ? categoryPath[0] : '';
  const hit = categoryFor(type, name, rawLabel);
  if (hit) return normalizeMetaCategory(type, hit[1]);

  try {
    return await classifyWithModel(type, { name, description, categoryPath });
  } catch (err) {
    console.error(`[entityMetaCategories] Classification failed for "${name}" (${type}), leaving meta_category null:`, err.message);
    return null;
  }
}

module.exports = {
  META_CATEGORIES,
  LABEL_DEFAULT,
  ENTITY_OVERRIDE,
  categoryFor,
  getMetaCategories,
  normalizeMetaCategory,
  resolveMetaCategory,
};
