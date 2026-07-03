const { getSupabase } = require('./supabase');
const { getAnthropicClient } = require('./anthropicClient');
const { getTopCategories, normalizeTopCategory } = require('./topCategories');

// Dashboard action: propose (and optionally apply) merges of near-duplicate
// subcategory labels within each top_category — e.g. 'Dua'/'Duas',
// 'AI Tools'/'Ai Tools'. Never touches items the user has manually
// recategorized (category_manually_set = true) — that flag is a promise made
// elsewhere in the codebase (lib/repository.js upsertItem) that a manual move
// sticks, so this consolidation pass must honor it too.

const client = getAnthropicClient();
const MODEL = 'claude-haiku-4-5-20251001';

const MERGE_PROMPT = `You are cleaning up a personal bookmarking library's subcategory labels. You will be given a list of subcategory labels with item counts, all belonging to the same top-level category.

Propose merges ONLY for labels that are genuinely near-duplicates of each other — plural/singular variants, casing differences, trivial synonyms (e.g. "Dua" / "Duas", "AI Tools" / "Ai Tools"). Do NOT merge labels that are merely related or thematically similar; they must be near-duplicates referring to the same shelf.

For each merge group, "to" must be the label with the HIGHEST item count among the group (the survivor). "from" lists every other label in that group (never include "to" in "from").

Return ONLY a JSON array — no markdown fences, no preamble. Each element:
{ "from": ["label1", "label2"], "to": "survivor label" }

Return [] if nothing should be merged. Every label you reference (in "from" or "to") MUST be copied verbatim from the input list.`;

function buildUserMessage(labelCounts) {
  const lines = labelCounts.map(({ name, count }) => `- "${name}" (${count})`).join('\n');
  return `Labels (with item counts) for one top-level category:\n${lines}\n\nPropose near-duplicate merges as a JSON array.`;
}

function parseJsonArray(text) {
  const s = String(text || '').replace(/```json\n?/gi, '').replace(/```\n?/g, '').trim();
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

// One Haiku call proposing merges for a single top_category's label list.
// Retries once on an unparseable/invalid response; returns { merges, warning }
// where merges is [] and warning is set when both attempts fail.
async function proposeMerges(topCategory, labelCounts) {
  const validNames = new Set(labelCounts.map(l => l.name));
  const countByName = new Map(labelCounts.map(l => [l.name, l.count]));

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 1000,
        system: MERGE_PROMPT,
        messages: [{ role: 'user', content: buildUserMessage(labelCounts) }]
      });

      const textBlock = response.content.filter(b => b.type === 'text').pop();
      if (!textBlock) throw new Error('No response from merge classifier');

      const raw = parseJsonArray(textBlock.text);
      if (!Array.isArray(raw)) throw new Error('Response is not a JSON array');

      const merges = [];
      for (const entry of raw) {
        if (!entry || typeof entry !== 'object') continue;
        const to = typeof entry.to === 'string' ? entry.to : null;
        const fromRaw = Array.isArray(entry.from) ? entry.from : [];
        if (!to || !validNames.has(to)) continue;

        const from = [...new Set(fromRaw.filter(f => typeof f === 'string'))]
          .filter(f => validNames.has(f) && f !== to);
        if (from.length === 0) continue;

        const itemCount = from.reduce((sum, name) => sum + (countByName.get(name) || 0), 0);
        merges.push({ from, to, itemCount });
      }

      return { merges, warning: null };
    } catch (err) {
      if (attempt === 1) {
        return { merges: [], warning: `Merge proposal failed for "${topCategory}": ${err.message}` };
      }
      // fall through to retry once
    }
  }
  return { merges: [], warning: `Merge proposal failed for "${topCategory}"` };
}

// Gather distinct (top_category, category) pairs with counts, restricted to
// non-manually-set items with a classified top_category. This same filter
// (category_manually_set = false) is repeated in the UPDATE when applying, so
// a manual move can never be swept up by consolidation either at proposal
// time or apply time.
async function gatherLabelCounts(userId, topCategoryFilter) {
  const sb = getSupabase();
  let query = sb
    .from('items')
    .select('top_category, topic_subcategory')
    .eq('user_id', userId)
    .eq('category_manually_set', false)
    .not('top_category', 'is', null);
  if (topCategoryFilter) query = query.eq('top_category', topCategoryFilter);

  const { data, error } = await query;
  if (error) throw new Error(`gatherLabelCounts failed: ${error.message}`);

  const byTopCategory = new Map();
  for (const row of data || []) {
    const label = row.topic_subcategory;
    if (!label) continue;
    let labels = byTopCategory.get(row.top_category);
    if (!labels) {
      labels = new Map();
      byTopCategory.set(row.top_category, labels);
    }
    labels.set(label, (labels.get(label) || 0) + 1);
  }
  return byTopCategory;
}

// Apply one merge: move every item in `from` labels to `to`, honoring the same
// manual-skip guard as the proposal query. Returns the number of rows updated.
async function applyMerge(userId, topCategory, merge) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('items')
    .update({ topic_subcategory: merge.to })
    .eq('user_id', userId)
    .eq('top_category', topCategory)
    .in('topic_subcategory', merge.from)
    .eq('category_manually_set', false)
    .select('id');
  if (error) throw new Error(`applyMerge failed: ${error.message}`);
  return (data || []).length;
}

// Sanitize a client-submitted preview (groups from an earlier apply:false
// response) so confirming applies EXACTLY what the user saw, not a fresh —
// and possibly different — LLM proposal. Only shape and top_category validity
// are checked here; the applyMerge query is inherently safe regardless of the
// label strings (user-scoped, manual-skip, and `.in('topic_subcategory', from)` only
// moves rows that still carry those labels).
function sanitizeSubmittedGroups(groups) {
  if (!Array.isArray(groups)) return null;
  const out = [];
  for (const group of groups) {
    if (!group || typeof group !== 'object') continue;
    const top = normalizeTopCategory(group.top_category);
    if (!top) continue;
    const merges = (Array.isArray(group.merges) ? group.merges : [])
      .filter(m => m && typeof m === 'object' && typeof m.to === 'string' && m.to)
      .map(m => ({
        to: m.to,
        from: [...new Set((Array.isArray(m.from) ? m.from : []).filter(f => typeof f === 'string' && f && f !== m.to))]
      }))
      .filter(m => m.from.length > 0);
    if (merges.length > 0) out.push({ top_category: top, merges });
  }
  return out.length > 0 ? out : null;
}

// Preview or apply subcategory-label consolidation for one user. When
// topCategory is provided (already validated by the caller via
// normalizeTopCategory), only that category is considered; otherwise all 13.
// When applying, callers should pass back the previewed `groups` so the user
// confirms exactly what they saw; without them, a fresh proposal is generated
// and applied (kept as a fallback for direct API use).
async function consolidateSubcategories({ userId, topCategory, apply = false, groups: submittedGroups } = {}) {
  if (apply === true) {
    const sanitized = sanitizeSubmittedGroups(submittedGroups);
    if (sanitized) {
      let totalUpdated = 0;
      const applied = [];
      for (const group of sanitized) {
        const merges = [];
        for (const merge of group.merges) {
          const updated = await applyMerge(userId, group.top_category, merge);
          totalUpdated += updated;
          // Report the count actually moved, which may differ from the
          // preview if items changed in between — the response is the
          // authoritative after-summary.
          merges.push({ from: merge.from, to: merge.to, itemCount: updated });
        }
        applied.push({ top_category: group.top_category, merges });
      }
      return { applied: true, groups: applied, totalUpdated, warnings: [] };
    }
  }

  const byTopCategory = await gatherLabelCounts(userId, topCategory);

  const groups = [];
  const warnings = [];

  const categoriesToCheck = topCategory ? [topCategory] : getTopCategories();
  for (const top of categoriesToCheck) {
    const labelMap = byTopCategory.get(top);
    if (!labelMap || labelMap.size < 2) continue;

    const labelCounts = [...labelMap.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

    const { merges, warning } = await proposeMerges(top, labelCounts);
    if (warning) warnings.push(warning);
    if (merges.length > 0) groups.push({ top_category: top, merges });
  }

  let totalUpdated = 0;
  if (apply === true) {
    for (const group of groups) {
      for (const merge of group.merges) {
        totalUpdated += await applyMerge(userId, group.top_category, merge);
      }
    }
  }

  return { applied: apply === true, groups, totalUpdated, warnings };
}

module.exports = { consolidateSubcategories };
