// Canonical URL + logo resolution for canonical_entities.
//
// This is the stage that was missing until 2026-07-26: entityResolution's
// insertNew() wrote every new row with url_status='unresolved', and the only
// thing that ever filled canonical_url/logo_url was a series of hand-run
// backfill batches (2026-07-21 / 07-23 / 07-24). Between batches the backlog
// grew unbounded — 192 rows by the time it was noticed — and the iOS Digest
// shows a Visit button and a logo only for url_status='resolved', so every
// entity saved after the last batch rendered bare.
//
// Same architecture as placeGeocoding: a pure save-time step plus an on-demand
// sweep, neither of which can fail a save.
//
//  1. seedFromEntityUrl()  — free and synchronous, runs inside insertNew().
//     If the content itself carried a usable link for the entity, that link IS
//     the canonical URL; no model call, no search, no latency.
//  2. resolveRowUrl()      — Haiku + server-side web_search, for rows the
//     content gave nothing for. Metered (one search per entity), so it runs
//     detached after the save and in the sweep, never inline.
//
// Policies encoded here come from the manual passes (see the 2026-07-23 and
// 07-24 batches): social-platform links are never a canonical URL; non-social
// marketplace/parent-repo links are acceptable with owned_domain=false; a
// DM-gated or unpublished creator skill with no public home is not_applicable,
// not unresolved.

const { getAnthropicClient } = require('./anthropicClient');
const { primaryLinkRank } = require('./url');

const client = getAnthropicClient();
const MODEL = 'claude-haiku-4-5-20251001';

// Types that never get an external link, so they never cost a search.
//  - place: the app reads live Google Place Details off entity.detail.location
//    (GET /api/places/:placeId), so a canonical_url would be a second, worse
//    source of truth. See placeGeocoding.js.
//  - the passage types: a dua/hadith/verse is text, not a destination. The
//    2026-07-21 pass already classified every one of them not_applicable.
const NO_LINK_TYPES = new Set(['place', 'dua', 'hadith', 'quranic_verse', 'islamic_concept']);

const NO_LINK_NOTE = {
  place: 'place — location comes from Google Place Details, not a canonical URL',
};

// Social platforms: a post, profile, or feed on one of these is never a
// canonical URL, whatever the path. Established 2026-07-23 (CampusX was marked
// not_applicable for having only a social link).
const SOCIAL_HOSTS = new Set([
  'twitter.com', 'x.com', 'instagram.com', 'tiktok.com', 'facebook.com',
  'threads.net', 'linkedin.com', 'lnkd.in', 't.co', 'reddit.com', 'pinterest.com',
]);

// Hosts that host OTHER people's things. A link here is still a good canonical
// URL (a repo, a listing, a doc), but the entity doesn't own the domain — so
// no logo may be derived from it. Mirrors the owned_domain=false split from the
// manual passes (GitHub / marketplace / hosted).
const HOSTED_HOSTS = new Set([
  'github.com', 'gist.github.com', 'gitlab.com', 'bitbucket.org',
  'medium.com', 'substack.com', 'dev.to', 'hashnode.dev',
  'notion.so', 'notion.site', 'gumroad.com', 'gitbook.io', 'readme.io',
  'docs.google.com', 'drive.google.com', 'sites.google.com',
  'npmjs.com', 'pypi.org', 'rubygems.org', 'crates.io',
  'huggingface.co', 'replicate.com', 'kaggle.com', 'colab.research.google.com',
  'apps.apple.com', 'play.google.com', 'chromewebstore.google.com',
  'producthunt.com', 'gitroom.com', 'vercel.app', 'netlify.app',
  'streamlit.app', 'glitch.me', 'herokuapp.com', 'pages.dev',
]);

function hostOf(url) {
  try {
    const u = new URL(/^https?:\/\//i.test(String(url)) ? String(url) : `https://${url}`);
    return u.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

function isSocial(url) {
  const host = hostOf(url);
  if (!host) return false;
  const bare = host.replace(/^m\./, '');
  if (SOCIAL_HOSTS.has(bare)) return true;
  return [...SOCIAL_HOSTS].some(h => bare.endsWith(`.${h}`));
}

// The entity owns its domain unless the link points at someone else's platform.
// Drives whether a logo can be derived from the URL — the iOS client only
// borrows a logo from canonical_url when owned_domain is true.
function ownsDomain(url) {
  const host = hostOf(url);
  if (!host) return false;
  if (HOSTED_HOSTS.has(host)) return false;
  if ([...HOSTED_HOSTS].some(h => host.endsWith(`.${h}`))) return false;
  return true;
}

// The client appends its own publishable token; storing the bare CDN URL keeps
// the convention the 2026-07-21 pass established.
function logoUrlFor(url, owned) {
  if (!owned) return null;
  const host = hostOf(url);
  return host ? `https://img.logo.dev/${host}` : null;
}

function resolvedFields(url, note) {
  const owned = ownsDomain(url);
  return {
    canonical_url: url,
    logo_url: logoUrlFor(url, owned),
    url_status: 'resolved',
    owned_domain: owned,
    resolution_note: note,
  };
}

function notApplicableFields(note) {
  return {
    canonical_url: null,
    logo_url: null,
    url_status: 'not_applicable',
    owned_domain: null,
    resolution_note: note,
  };
}

function unresolvedFields(note) {
  return {
    canonical_url: null,
    logo_url: null,
    url_status: 'unresolved',
    owned_domain: null,
    resolution_note: note,
  };
}

// ─── Step 1: the free seed (no network, runs inside insertNew) ────────────────

// When the saved content itself linked the entity, that link is the answer —
// no search can beat the source. Returns the column patch, or null to leave the
// row for the search pass.
//
// Deliberately synchronous: insertNew() sits inside the save path, so this may
// not do I/O. A shortened link (t.co, lnkd.in) is therefore left alone rather
// than expanded — the search pass finds the real home by name anyway.
function seedFromEntityUrl(entityType, entity) {
  if (NO_LINK_TYPES.has(entityType)) {
    return notApplicableFields(NO_LINK_NOTE[entityType] || `${entityType} — no external link applies`);
  }
  const url = entity && typeof entity.url === 'string' ? entity.url.trim() : '';
  if (!url) return null;
  if (isSocial(url)) return null;
  // Rank 0 is the unusable set: unparseable, localhost, bare IP, social post.
  if (primaryLinkRank(url) === 0) return null;
  return resolvedFields(url, 'from the link in the source content');
}

// ─── Step 2: search resolution (metered — detached or swept, never inline) ────

const RESOLUTION_PROMPT = `You find the canonical home page for one entity in a personal bookmarking library, using web search.

You are given the entity's name, type, description, and category path. Search the web, then decide where — if anywhere — the user should be sent when they tap it.

Return exactly one outcome:

- "resolved": you found the official, canonical page for THIS specific thing. Set "url".
- "not_applicable": no external link makes sense for it, or none exists. Set "url" to null.
- "unresolved": a link probably exists but you could not confidently identify it. Set "url" to null.

What counts as a canonical URL:
- The entity's own product home page, docs site, or official landing page. Best.
- A GitHub/GitLab repo, a plugin or marketplace listing, a package page (npm, PyPI), or a docs page hosted by someone else. Acceptable — the destination is right even though the entity doesn't own the domain.
- When the entity IS the platform (e.g. an entity literally named "YouTube"), that platform's own home page is correct.

What is NEVER a canonical URL:
- Any social media link — x.com, twitter.com, instagram.com, tiktok.com, facebook.com, threads.net, linkedin.com, reddit.com, pinterest.com — including profiles, posts, and threads. If the ONLY presence you can find is social, the outcome is "not_applicable", not "resolved".
- A page for a DIFFERENT thing that happens to share the name. Read the description: match the specific mechanism, product, or content described, not just the name string. If the only candidates are same-name-different-product, the outcome is "unresolved".
- A search results page, an aggregator listing, a news article about the thing, or a video review of it.
- A link you are inferring or constructing rather than one you actually saw in search results.

Use "not_applicable" (not "unresolved") when the thing genuinely has no public home:
- A creator's skill/tool/resource distributed only by DM, comment-gated lead magnet, paid community, or newsletter — an established pattern in this library.
- A generic concept, technique, or in-house artifact with no product behind it.

Return ONLY a raw JSON object — no markdown fences, no preamble:
{ "outcome": "resolved" | "not_applicable" | "unresolved", "url": "<url or null>", "reason": "<one short sentence, under 20 words>" }`;

// Same bracket-depth extraction the rest of this codebase uses (classifier,
// entityResolution, subcategoryConsolidation), with one difference: a
// web-search turn interleaves prose with the verdict, and prose can contain
// braces. So rather than anchoring on the first or last "{" — either of which
// can land on the wrong one — every candidate start is tried and the first
// balanced object that actually carries an "outcome" wins.
function balancedObjectAt(s, start) {
  let depth = 0, inString = false, escape = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) {
      try { return JSON.parse(s.substring(start, i + 1)); } catch { return null; }
    }
  }
  return null;
}

function parseObject(text) {
  const s = String(text || '').replace(/```json\n?/gi, '').replace(/```\n?/g, '').trim();
  let fallback = null;
  for (let i = s.indexOf('{'); i !== -1; i = s.indexOf('{', i + 1)) {
    const parsed = balancedObjectAt(s, i);
    if (!parsed || typeof parsed !== 'object') continue;
    if (typeof parsed.outcome === 'string') return parsed;
    if (!fallback) fallback = parsed;
  }
  if (fallback) return fallback;
  throw new Error(`No JSON verdict found: ${s.substring(0, 200)}`);
}

function describeRow(row) {
  const path = Array.isArray(row.category_path) && row.category_path.length
    ? row.category_path.join(' > ')
    : null;
  const lines = [`Name: ${row.canonical_name}`, `Type: ${row.entity_type}`];
  if (row.description) lines.push(`Description: ${row.description}`);
  if (path) lines.push(`Category: ${path}`);
  if (Array.isArray(row.aliases) && row.aliases.length) {
    lines.push(`Also seen as: ${row.aliases.join(', ')}`);
  }
  return lines.join('\n');
}

// A model can name a plausible URL that 404s. One cheap request keeps dead
// links out of the registry. Ambiguous replies (403/405 — bot walls) count as
// alive: the page exists, it just won't talk to us.
async function urlIsLive(url) {
  const attempt = async (method) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(url, { method, redirect: 'follow', signal: controller.signal });
      return res.status;
    } finally {
      clearTimeout(timer);
    }
  };
  try {
    let status = await attempt('HEAD');
    if (status === 404 || status === 405 || status === 501) status = await attempt('GET');
    return status !== 404 && status !== 410;
  } catch {
    return false;
  }
}

// Resolve one canonical row. Returns the column patch to write. Never throws —
// a failed lookup leaves the row unresolved for a later sweep.
async function resolveRowUrl(row) {
  if (NO_LINK_TYPES.has(row.entity_type)) {
    return notApplicableFields(NO_LINK_NOTE[row.entity_type] || `${row.entity_type} — no external link applies`);
  }

  let verdict;
  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1500,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 4 }],
      system: RESOLUTION_PROMPT,
      messages: [{ role: 'user', content: `${describeRow(row)}\n\nFind its canonical URL.` }],
    });
    const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
    verdict = parseObject(text);
  } catch (err) {
    return unresolvedFields(`lookup failed: ${err.message.slice(0, 180)}`);
  }

  const reason = typeof verdict.reason === 'string' ? verdict.reason.slice(0, 240) : 'no reason given';
  if (verdict.outcome === 'not_applicable') return notApplicableFields(reason);
  if (verdict.outcome !== 'resolved' || !verdict.url) return unresolvedFields(reason);

  const url = String(verdict.url).trim();
  // The prompt forbids social links, but the registry contract is enforced
  // here too — a policy this load-bearing shouldn't live only in a prompt.
  if (isSocial(url)) return notApplicableFields(`only a social-platform link exists (${hostOf(url)})`);
  if (primaryLinkRank(url) === 0) return unresolvedFields(`unusable link proposed (${url.slice(0, 80)})`);
  if (!(await urlIsLive(url))) return unresolvedFields(`proposed link is dead: ${url.slice(0, 120)}`);

  return resolvedFields(url, reason);
}

// ─── Write paths ─────────────────────────────────────────────────────────────

async function writeRow(sb, row, patch) {
  const { error } = await sb.from('canonical_entities').update(patch).eq('id', row.id);
  if (error) throw new Error(`canonical_entities url update failed: ${error.message}`);
}

const ROW_COLUMNS = 'id, entity_type, canonical_name, aliases, category_path, description, url_status, resolution_note';

// Fire-and-forget save-time hook (mirrors geocodeItemEntitiesInBackground):
// after resolveEntities() has canonicalized a save's entities, resolve URLs for
// whichever of their registry rows are still unresolved. Detached because each
// row costs a metered web search — the save must not wait on it, and must not
// fail if it breaks.
function resolveEntityUrlsInBackground(entities) {
  const refs = (Array.isArray(entities) ? entities : [])
    .filter(e => e && typeof e.type === 'string' && typeof e.name === 'string')
    .map(e => ({ type: e.type, name: e.name }));
  if (refs.length === 0) return;

  (async () => {
    const { getSupabase } = require('./supabase');
    const sb = getSupabase();
    for (const ref of refs) {
      const { data: row, error } = await sb
        .from('canonical_entities')
        .select(ROW_COLUMNS)
        .eq('entity_type', ref.type)
        .eq('canonical_name', ref.name)
        .maybeSingle();
      if (error || !row || row.url_status !== 'unresolved') continue;
      // A note on an unresolved row means a search already ran and came back
      // empty. Re-searching it on every later save that mentions the entity
      // just burns quota for the same answer — same reason placeGeocoding
      // treats "not_found" as terminal. The sweep still retries these.
      if (row.resolution_note) continue;

      const patch = await resolveRowUrl(row);
      await writeRow(sb, row, patch);
      console.log(`[entityUrl] ${row.entity_type} "${row.canonical_name}" → ${patch.url_status}${patch.canonical_url ? ` (${patch.canonical_url})` : ''}`);
    }
  })().catch(err => console.error(`[entityUrl] background resolution failed: ${err.message}`));
}

// On-demand sweep over the unresolved backlog (the URL twin of
// geocodePendingPlaces). Serves the one-off backfill and any future stragglers
// — a row that fails today is simply picked up by the next sweep.
//
// `limit` bounds a run because every non-passage, non-place row costs a metered
// search; the caller can drain the queue in batches.
async function resolvePendingEntityUrls({ limit = 50, type = null } = {}) {
  const { getSupabase } = require('./supabase');
  const sb = getSupabase();

  let query = sb
    .from('canonical_entities')
    .select(ROW_COLUMNS)
    .eq('url_status', 'unresolved')
    .order('first_seen_at', { ascending: true })
    .limit(Math.max(1, Math.min(500, Number(limit) || 50)));
  if (type) query = query.eq('entity_type', type);

  const { data: rows, error } = await query;
  if (error) throw new Error(`url sweep read failed: ${error.message}`);

  let scanned = 0, resolved = 0, notApplicable = 0, stillUnresolved = 0;
  for (const row of rows || []) {
    scanned += 1;
    const patch = await resolveRowUrl(row);
    await writeRow(sb, row, patch);
    if (patch.url_status === 'resolved') resolved += 1;
    else if (patch.url_status === 'not_applicable') notApplicable += 1;
    else stillUnresolved += 1;
    console.log(`[entityUrl] ${row.entity_type} "${row.canonical_name}" → ${patch.url_status}${patch.canonical_url ? ` (${patch.canonical_url})` : ''}`);
  }

  const { count: remaining } = await sb
    .from('canonical_entities')
    .select('id', { count: 'exact', head: true })
    .eq('url_status', 'unresolved');

  return { scanned, resolved, notApplicable, stillUnresolved, remaining: remaining ?? null };
}

module.exports = {
  seedFromEntityUrl,
  resolveRowUrl,
  resolveEntityUrlsInBackground,
  resolvePendingEntityUrls,
  ownsDomain,
  isSocial,
  NO_LINK_TYPES,
};
