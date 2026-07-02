const { google } = require('googleapis');
const { getAuth } = require('./auth');
const { getAnthropicClient } = require('./anthropicClient');

const client = getAnthropicClient();

const MODEL = 'claude-haiku-4-5-20251001';
const TAG_SHEET = 'Tag Registry';

// Confidence thresholds for semantic tag matching.
const REPLACE_THRESHOLD = 80; // >= : adopt the existing canonical tag automatically
const FLAG_THRESHOLD = 50;    // >= (and < REPLACE): keep new tag but flag with '?'

function getSheetsClient() {
  const auth = getAuth();
  return google.sheets({ version: 'v4', auth });
}

const SCORE_PROMPT = `You normalize content tags against an existing canonical tag registry.

For EACH new tag, find the single most semantically similar tag in the existing registry and rate the similarity on a 0-100 scale:
- 100: identical meaning, a synonym, or the same concept phrased differently
- 80-99: very close — safely interchangeable with the existing tag
- 50-79: clearly related but meaningfully distinct
- 0-49: unrelated

Rules:
- "closest" MUST be copied verbatim from the existing registry list, or null if no existing tag is even loosely related (in which case score is 0).
- Never invent a tag that is not in the existing list.
- Output one object per new tag, preserving the input order.

Return ONLY a raw JSON array — no markdown fences, no preamble:
[{ "tag": "<the new tag>", "closest": "<existing tag verbatim or null>", "score": <integer 0-100> }]`;

async function getTagRegistry(sheetId) {
  const sheets = getSheetsClient();
  let res;
  try {
    res = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: `${TAG_SHEET}!A2:C`
    });
  } catch (err) {
    // Tab may not exist yet on very old sheets — treat as empty registry.
    return [];
  }
  const rows = res.data.values || [];
  return rows
    .map((row, i) => ({
      tag: (row[0] || '').trim(),
      addedDate: row[1] || '',
      fileCount: parseInt(row[2], 10) || 0,
      rowNumber: i + 2
    }))
    .filter(r => r.tag);
}

// Extract the first complete JSON array from a model response.
function parseScoreArray(text) {
  const s = text.replace(/```json\n?/gi, '').replace(/```\n?/g, '').trim();
  const start = s.indexOf('[');
  if (start === -1) throw new Error(`No JSON array found: ${s.substring(0, 200)}`);

  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '[' || ch === '{') depth++;
    if (ch === ']' || ch === '}') {
      depth--;
      if (depth === 0) return JSON.parse(s.slice(start, i + 1));
    }
  }
  throw new Error(`Incomplete JSON array: ${s.substring(0, 200)}`);
}

// Ask Haiku to score every new tag against the existing registry. Returns a Map
// keyed by lowercased new tag → { closest, score }. Hallucinated canonical tags
// (not present verbatim in the registry) are discarded.
async function scoreTags(newTags, existingTags) {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1000,
    system: SCORE_PROMPT,
    messages: [{
      role: 'user',
      content: `Existing canonical tags:\n${existingTags.join('\n')}\n\nNew tags to score:\n${newTags.join('\n')}\n\nScore each new tag against the existing registry.`
    }]
  });

  const textBlock = response.content.filter(b => b.type === 'text').pop();
  if (!textBlock) throw new Error('No response from tag scorer');

  const parsed = parseScoreArray(textBlock.text);
  const canonicalByLower = new Map(existingTags.map(t => [t.toLowerCase(), t]));

  const scores = new Map();
  for (const entry of Array.isArray(parsed) ? parsed : []) {
    if (!entry || typeof entry.tag !== 'string') continue;
    const rawClosest = typeof entry.closest === 'string' ? entry.closest.trim() : '';
    const canonical = canonicalByLower.get(rawClosest.toLowerCase()) || null;
    let score = Math.round(Number(entry.score));
    if (!Number.isFinite(score)) score = 0;
    score = Math.max(0, Math.min(100, score));
    scores.set(entry.tag.toLowerCase(), {
      closest: canonical,
      score: canonical ? score : 0
    });
  }
  return scores;
}

// Persist registry side effects: bump File Count for adopted canonical tags and
// append brand-new (clean, sub-threshold) tags. Flagged ('?') tags are NOT added.
async function applyRegistryUpdates(sheetId, registry, results) {
  const sheets = getSheetsClient();
  const today = new Date().toISOString().split('T')[0];
  const byLower = new Map(registry.map(r => [r.tag.toLowerCase(), r]));

  const increments = new Map(); // rowNumber → next count
  const additions = [];         // tag strings to append

  const bump = (entry) => {
    const base = increments.has(entry.rowNumber) ? increments.get(entry.rowNumber) : entry.fileCount;
    increments.set(entry.rowNumber, base + 1);
  };

  for (const r of results) {
    if (r.status === 'replaced') {
      const entry = byLower.get(r.final.toLowerCase());
      if (entry) bump(entry);
    } else if (r.status === 'new') {
      const key = r.final.toLowerCase();
      const entry = byLower.get(key);
      if (entry) {
        bump(entry); // defensive: already exists despite low score
      } else if (!additions.some(t => t.toLowerCase() === key)) {
        additions.push(r.final);
      }
    }
    // 'flagged' results are intentionally left out of the registry.
  }

  const data = [];
  for (const [rowNumber, count] of increments) {
    data.push({ range: `${TAG_SHEET}!C${rowNumber}`, values: [[count]] });
  }
  if (data.length) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: { valueInputOption: 'RAW', data }
    });
  }
  if (additions.length) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: `${TAG_SHEET}!A:C`,
      valueInputOption: 'RAW',
      requestBody: { values: additions.map(t => [t, today, 1]) }
    });
  }
}

// Normalize a set of freshly generated tags against the canonical registry.
// Returns one result per input tag:
//   { original, final, status: 'replaced'|'flagged'|'new', closest, score }
// and updates the Tag Registry as a side effect.
async function normalizeTags(newTags, sheetId) {
  const tags = (Array.isArray(newTags) ? newTags : [])
    .map(t => (typeof t === 'string' ? t.trim() : ''))
    .filter(Boolean);
  if (tags.length === 0) return [];

  const registry = await getTagRegistry(sheetId);
  const existingTags = registry.map(r => r.tag);

  const scores = existingTags.length > 0
    ? await scoreTags(tags, existingTags)
    : new Map();

  const results = tags.map(tag => {
    const { closest = null, score = 0 } = scores.get(tag.toLowerCase()) || {};
    if (closest && score >= REPLACE_THRESHOLD) {
      return { original: tag, final: closest, status: 'replaced', closest, score };
    }
    if (closest && score >= FLAG_THRESHOLD) {
      return { original: tag, final: `${tag}?`, status: 'flagged', closest, score };
    }
    return { original: tag, final: tag, status: 'new', closest, score };
  });

  await applyRegistryUpdates(sheetId, registry, results);
  return results;
}

// Add a canonical tag to the registry, or bump its File Count if already present.
// Used when a user resolves a flagged tag via reply.
async function addOrIncrementTag(sheetId, tag) {
  const clean = (tag || '').trim();
  if (!clean) return;

  const sheets = getSheetsClient();
  const registry = await getTagRegistry(sheetId);
  const existing = registry.find(r => r.tag.toLowerCase() === clean.toLowerCase());

  if (existing) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `${TAG_SHEET}!C${existing.rowNumber}`,
      valueInputOption: 'RAW',
      requestBody: { values: [[existing.fileCount + 1]] }
    });
  } else {
    const today = new Date().toISOString().split('T')[0];
    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: `${TAG_SHEET}!A:C`,
      valueInputOption: 'RAW',
      requestBody: { values: [[clean, today, 1]] }
    });
  }
}

module.exports = { normalizeTags, getTagRegistry, addOrIncrementTag, scoreTags, REPLACE_THRESHOLD, FLAG_THRESHOLD };
