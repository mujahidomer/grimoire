require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { extractContent } = require('./lib/extractor');
const { processContent, researchUrl, processLinkedResource, extractEntities } = require('./lib/classifier');
const { normalizeTagsPg } = require('./lib/tags-pg');
const {
  upsertItem, upsertItemTags, upsertLinkedResource, mergeItemEntities, getItemById,
  promotedArtifactUrl, updateItemStatus, getSubcategoryVocabulary
} = require('./lib/repository');
const { normalizeUrl } = require('./lib/url');
const { embedItemInBackground } = require('./lib/embeddings');
const { resolveEntities } = require('./lib/entityResolution');
const { verifyItemEntitiesInBackground } = require('./lib/passageVerification');
const { geocodeItemEntitiesInBackground } = require('./lib/placeGeocoding');
const { resolveEntityUrlsInBackground } = require('./lib/entityUrlResolution');
const { registerApiRoutes } = require('./lib/routes');
const { defaultUserId } = require('./lib/supabase');
const { refreshTopCategories } = require('./lib/topCategories');
const { requireAuth, logAuthMode } = require('./lib/request-auth');
const { seedUserLibrary } = require('./lib/seed');

const app = express();
// CORS for the web UI (Doc B paste-box + chat panel). The throwaway viewer runs
// on a separate origin (Next dev server on :3000, or the deployed UI), so browser
// calls need explicit cross-origin permission.
app.use(cors({
  origin: process.env.WEB_ORIGIN || true,
  allowedHeaders: ['Content-Type', 'Authorization', 'x-user-id'],
}));
app.use(express.json());

// Reported by /health so a deployment can be checked for a complete env. No
// route resolves a user from this any more: callers authenticate with a Supabase
// JWT or a grim_ API token, and only the dev fallback in lib/request-auth.js
// still reads GRIMOIRE_USER_ID.
const USER_ID = (() => {
  try { return defaultUserId(); }
  catch (err) { console.error('⚠️', err.message); return null; }
})();

// ─── Core Pipeline (writes to Postgres, not Drive/Sheets) ─────────────────────
// Normalize tags against the canonical `tags` table, persist the item + tags +
// any linked resources, then kick off embedding in the background. Returns a
// lightweight saved record as soon as the DB write completes.
async function saveItem(item, sourceUrl, userId) {
  item.sourceUrl = sourceUrl;

  let finalTags = Array.isArray(item.tags) ? item.tags : [];
  finalTags = await normalizeTagsPg(finalTags, userId);
  item.tags = finalTags;

  const itemId = await upsertItem(item, { userId, source: item.source || 'unknown' });
  await upsertItemTags(itemId, userId, finalTags);

  // If artifact_url was just promoted from a linked resource, don't also write
  // that same URL as a linked_resources row (mirrors the Drive path's dedup).
  const promoted = promotedArtifactUrl(item);

  const resourceUrls = [];
  for (const lr of Array.isArray(item.linked_resources) ? item.linked_resources : []) {
    const lrUrl = normalizeUrl(typeof lr === 'string' ? lr : (lr.source_url || lr.sourceUrl || lr.url));
    if (promoted && lrUrl === promoted) continue;
    if (typeof lr === 'string') await upsertLinkedResource(itemId, userId, { source_url: lr });
    else await upsertLinkedResource(itemId, userId, lr);
    if (lrUrl) resourceUrls.push(lrUrl);
  }

  embedItemInBackground(item, itemId, userId);
  verifyItemEntitiesInBackground(itemId, userId);
  geocodeItemEntitiesInBackground(itemId, userId);
  // Give the save's new registry rows a canonical link + logo. Reads
  // item.entities post-resolveEntities, so the names are already canonical.
  // Detached: one metered web search per row the content didn't link itself.
  resolveEntityUrlsInBackground(item.entities);
  // Mine the save's own linked resources for digest entries too — same rule
  // as the attach-a-resource endpoint, just deferred so the save stays fast.
  attachSavedResourceEntitiesInBackground(itemId, userId, resourceUrls);

  return { itemId, title: item.title, category: item.category, type: item.type,
    summary: item.summary, has_lead_magnet_cta: item.has_lead_magnet_cta };
}

// ─── Linked-resource digest entries ───────────────────────────────────────────
// A linked resource is an extension of the save it hangs off, not an item of
// its own (Muji 2026-07-25): it gets the same extraction → entity → canonical
// resolution → verification/geocoding treatment as a save, but its entities
// land on the PARENT item's blob, so they show up in that item's Digest tab
// and in the global Digest. Its summary/takeaways are not kept — only the
// digest entries.
//
// Never throws: failing to mine entities out of a follow-up link must not fail
// the attach (or the save) that triggered it.
async function attachResourceEntities(itemId, userId, sourceUrl, text) {
  if (!text || !text.trim()) return 0;
  try {
    const subcategoryVocab = await getSubcategoryVocabulary();
    const entities = await extractEntities(text, sourceUrl, subcategoryVocab);
    if (entities.length === 0) return 0;

    // Canonicalize before the write, same ordering constraint as the main
    // pipeline: `entities` is one jsonb blob, so resolution has to land
    // before it's persisted, not after.
    await resolveEntities(entities);
    const { added } = await mergeItemEntities(itemId, userId, entities);
    if (added > 0) {
      verifyItemEntitiesInBackground(itemId, userId);
      geocodeItemEntitiesInBackground(itemId, userId);
      resolveEntityUrlsInBackground(entities);
    }
    console.log(`[linkedResource] ${sourceUrl} → ${added} new entit${added === 1 ? 'y' : 'ies'} on item ${itemId}`);
    return added;
  } catch (err) {
    console.error(`[linkedResource] entity extraction failed for ${sourceUrl}:`, err.message);
    return 0;
  }
}

// Same treatment for linked resources that arrived with the original save
// (URLs the classifier pulled out of the content). Detached and sequential:
// each URL is a full extractContent (Supadata/Apify — seconds to minutes, and
// metered), so this must not sit inside the save's own latency, and the URLs
// must not all fire at once.
function attachSavedResourceEntitiesInBackground(itemId, userId, urls) {
  if (!Array.isArray(urls) || urls.length === 0) return;
  (async () => {
    for (const url of urls) {
      let extracted = null;
      try { extracted = await extractContent(url); }
      catch (err) {
        console.warn(`[linkedResource] extraction failed for ${url}: ${err.message}`);
        continue;
      }
      await attachResourceEntities(itemId, userId, url, extracted && extracted.text);
    }
  })().catch(err => console.error('[linkedResource] background pass failed:', err));
}

async function researchAndSave(sourceUrl, userId) {
  const subcategoryVocab = await getSubcategoryVocabulary();
  const items = await researchUrl(sourceUrl, subcategoryVocab);
  if (!items || items.length === 0) return [];
  for (const item of items) await resolveEntities(item.entities);
  const saved = [];
  for (const item of items) saved.push(await saveItem(item, sourceUrl, userId));
  return saved;
}

async function runPipeline(rawText, sourceUrl, hashtags, parts = {}, userId) {
  const subcategoryVocab = await getSubcategoryVocabulary();
  const items = await processContent(rawText, sourceUrl, hashtags, parts, subcategoryVocab);
  if (!items || items.length === 0) return [];
  // Resolve entity identity against the canonical registry (lib/entityResolution.js)
  // before the item is persisted — entities is a single jsonb blob written once
  // by upsertItem, so canonicalization has to land before that write, same as
  // reconcileSubcategory() does for topic_subcategory inside processContent().
  for (const item of items) await resolveEntities(item.entities);
  const saved = [];
  for (const item of items) saved.push(await saveItem(item, sourceUrl, userId));
  return saved;
}

// Extract content from a URL and save. Falls back to web-search classification
// when scraping/transcript extraction fails or returns nothing.
async function saveFromUrl(url, userId) {
  let extracted = null;
  try {
    extracted = await extractContent(url);
  } catch (err) {
    console.warn(`[saveFromUrl] Extraction failed (${err.message}), falling back to research...`);
    return researchAndSave(url, userId);
  }

  if (!extracted.text) {
    return researchAndSave(url, userId);
  }

  return runPipeline(extracted.text, url, extracted.hashtags,
    { caption: extracted.caption, transcript: extracted.transcript }, userId);
}

// Runs the actual extract → classify → save pipeline for POST /api/save AFTER
// the fast pending-row ack has already been sent to the client. Deliberately
// not awaited by the request handler — req/res must not be touched from here.
// itemId/url/userId are captured in closure at call time, before the response
// went out.
//
// KNOWN GAP: this is in-process continuation, not a real job queue. If the
// Railway container restarts (deploy, crash, OOM) while this is running, the
// save is lost outright — no retry, no re-enqueue — and the item stays stuck
// at status='pending'/'processing' forever. Acceptable for now; revisit if
// stuck items become a real problem.
async function processSaveInBackground(itemId, url, userId) {
  console.log(`[save:${itemId}] background processing started for ${url}`);
  try {
    await updateItemStatus(itemId, userId, 'processing');
    console.log(`[save:${itemId}] extracting content...`);
    const saved = await saveFromUrl(url, userId);

    if (!saved || saved.length === 0) {
      console.warn(`[save:${itemId}] no content extracted for ${url}, marking failed`);
      await updateItemStatus(itemId, userId, 'failed');
      return;
    }

    // saveFromUrl already persisted the classified item(s) via saveItem(), which
    // upserts on (user_id, source_url) — the same key as the pending row above,
    // so this overwrites it in place with status defaulting to 'completed'.
    // (A URL that yields multiple items collapses to the last one written —
    // pre-existing upsertItem behavior, not something this change introduces.)
    console.log(`[save:${itemId}] completed (${saved.length} item(s)) for ${url}`);
  } catch (err) {
    console.error(`[save:${itemId}] background processing failed for ${url}:`, err);
    try {
      await updateItemStatus(itemId, userId, 'failed');
    } catch (err2) {
      console.error(`[save:${itemId}] also failed to mark status=failed:`, err2);
    }
  }
}

// ─── REST API ─────────────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', user: !!USER_ID }));

// Retrieval + chat API (Doc A item 5): GET /api/items, GET /api/items/:id, POST /api/chat.
registerApiRoutes(app);

// POST /api/save — the web paste-box + iOS Shortcut/share-sheet save flow
// (Doc B). Body: { url }. Responds fast (target <500ms): validates the URL and
// writes a 'pending' placeholder row, then hands off extraction + classification
// to a detached background job (processSaveInBackground) so the HTTP response
// doesn't sit open for however long Jina/Supadata/Apify + classification take
// (seconds to several minutes on the Apify path) — that's what was letting iOS
// kill backgrounded-tab saves even with fetch keepalive, since keepalive isn't
// built to hold a connection open across a long, unbounded server-side wait.
// Returns { id, status: 'pending', url } immediately; the item's `status`
// column tracks pending → processing → completed/failed from here.
app.post('/api/save', requireAuth(async (req, res) => {
  const { url } = req.body || {};
  if (!url) return res.status(400).json({ error: 'url is required' });

  const userId = req.userId;
  let itemId;
  try {
    itemId = await upsertItem({ sourceUrl: url, status: 'pending' }, { userId, source: 'web' });
  } catch (err) {
    console.error('POST /api/save pending-row error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }

  console.log(`[save:${itemId}] pending row created for ${url}, request received`);
  res.json({ success: true, id: itemId, status: 'pending', url });

  processSaveInBackground(itemId, url, userId);
}));

// POST /api/seed — copy pre-processed starter-library items into the caller's
// library (the onboarding funnel). The user id is taken from the verified token,
// never the body. Awaits the copy so the client can refresh once items exist.
// Body: { selectedItemIds: string[] }.
app.post('/api/seed', requireAuth(async (req, res) => {
  try {
    const { selectedItemIds } = req.body || {};
    const ids = Array.isArray(selectedItemIds) ? selectedItemIds.slice(0, 50) : [];
    const { seeded, skipped } = await seedUserLibrary(req.userId, ids);
    res.json({ success: true, accepted: ids.length, seeded, skipped });
  } catch (err) {
    console.error('POST /api/seed error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
}));

// POST /api/items/:id/reclassify — re-run classification on stored transcript/caption.
// Useful when takeaways were empty or the classifier prompt improved.
app.post('/api/items/:id/reclassify', requireAuth(async (req, res) => {
  try {
    const item = await getItemById(req.params.id, req.userId);
    if (!item) return res.status(404).json({ error: 'not_found' });

    const text = (item.transcript || item.caption || '').trim();
    if (!text) {
      return res.status(422).json({
        error: 'no_content',
        message: 'No transcript or caption to reclassify from.'
      });
    }

    const subcategoryVocab = await getSubcategoryVocabulary();
    const [classified] = await processContent(text, item.source_url, [], {
      transcript: item.transcript,
      caption: item.caption
    }, subcategoryVocab);
    classified.sourceUrl = item.source_url;
    await resolveEntities(classified.entities);
    const itemId = await upsertItem(classified, { userId: req.userId, source: item.source });
    embedItemInBackground(classified, itemId, req.userId);

    const refreshed = await getItemById(itemId, req.userId);
    res.json({ success: true, item: refreshed });
  } catch (err) {
    console.error('POST /api/items/:id/reclassify error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
}));

// POST /api/items/:id/linked-resources — attach a follow-up link to an existing
// item (Doc B Screen 2). Body: { url }. Extracts + classifies the link, upserts it,
// mines it for digest entries that land on the parent item, then returns the
// item's refreshed linked_resources so the UI can update in place.
//
// The entity pass runs inline rather than detached: extractContent above
// already dominates this request's latency, and the client sits on a spinner
// then refetches the item — so finishing here is what makes the new digest
// entries visible on the page the user is already looking at.
app.post('/api/items/:id/linked-resources', requireAuth(async (req, res) => {
  const { url } = req.body || {};
  if (!url) return res.status(400).json({ error: 'url is required' });
  const userId = req.userId;
  try {
    const item = await getItemById(req.params.id, userId);
    if (!item) return res.status(404).json({ error: 'not_found' });

    let extracted = null;
    try { extracted = await extractContent(url); }
    catch (err) { console.error('Linked resource extraction failed:', err.message); }

    const processed = await processLinkedResource(extracted?.text || '', extracted?.title);
    await upsertLinkedResource(item.id, userId, {
      source_url: url,
      title: processed.title,
      type: processed.resource_type,
      body_content: processed.content
    });

    await attachResourceEntities(item.id, userId, url, extracted?.text);

    const refreshed = await getItemById(item.id, userId);
    res.json({ success: true, linked_resources: refreshed.linked_resources || [] });
  } catch (err) {
    console.error('POST /api/items/:id/linked-resources error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
}));

// Legacy capture endpoints (iOS Shortcut), now writing to Postgres. These used
// to run unauthenticated against GRIMOIRE_USER_ID, which let anyone on the
// internet write into the library and spend metered extraction/classification
// credit. They now take the same credentials as every other route — the
// Shortcut sends `Authorization: Bearer grim_…` (see scripts/mint-api-token.js)
// and the item lands in whichever user that token belongs to.
app.post('/process-url', requireAuth(async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'url is required' });
  try {
    const extracted = await extractContent(url);
    if (!extracted.text) return res.json({ success: false, error: 'no_transcript', message: 'No transcript available — paste text manually' });
    const saved = await runPipeline(extracted.text, url, extracted.hashtags,
      { caption: extracted.caption, transcript: extracted.transcript }, req.userId);
    res.json({ success: true, count: saved.length, items: saved.map(i => ({ id: i.itemId, title: i.title, category: i.category, type: i.type })) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}));

app.post('/process-text', requireAuth(async (req, res) => {
  const { text, source } = req.body;
  if (!text) return res.status(400).json({ error: 'text is required' });
  try {
    const saved = await runPipeline(text, source || 'manual', undefined, {}, req.userId);
    res.json({ success: true, count: saved.length, items: saved.map(i => ({ id: i.itemId, title: i.title, category: i.category, type: i.type })) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}));

// ─── Start Server ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

async function start() {
  logAuthMode();

  // Warm the top-category cache from the DB (top_categories table) once at
  // startup. Non-fatal: on failure the built-in seed list is used, so the app
  // still boots with the default categories.
  await refreshTopCategories();

  app.listen(PORT, () => {
    const supadata = process.env.SUPADATA_API_KEY?.trim() ? 'configured' : 'missing';
    console.log(`🔮 Grimoire running on port ${PORT} (Supadata: ${supadata})`);
  });
}

start().catch((err) => {
  console.error('Failed to start Grimoire:', err);
  process.exit(1);
});
