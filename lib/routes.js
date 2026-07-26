const {
  getItems,
  getItemById,
  getDigest,
  getEntities,
  deleteItemById,
  getDashboard,
  getSubcategories,
  setItemTopCategory,
  setEntityHidden
} = require('./repository');
const { answerQuestion } = require('./chat');
const { renderItemAsMarkdown } = require('./render');
const { getLinkPreview, fetchPreviewImage } = require('./link-preview');
const crypto = require('crypto');
const { getSupabase } = require('./supabase');
const { requireAuth, hashApiToken, API_TOKEN_PREFIX } = require('./request-auth');
const { getUsage, checkLimit, incrementUsage } = require('./queryLimits');
const { listChats, listMessages } = require('./chatHistory');
const { normalizeTopCategory, getTopCategoryRecords, refreshTopCategories } = require('./topCategories');
const { consolidateSubcategories } = require('./subcategoryConsolidation');
const { listReviews, applyReviewDecision, sweepEntities } = require('./entityResolution');
const { getPlaceDetails, geocodePendingPlaces } = require('./placeGeocoding');
const { resolvePendingEntityUrls } = require('./entityUrlResolution');

// Retrieval + chat API (Doc A item 5). Thin Express handlers over the service
// modules — the future MCP server calls the same functions directly, so no logic
// lives here. User id comes from a verified Supabase JWT or the dev fallback.

function registerApiRoutes(app) {
  // GET /api/items — list/filter by category, tag, free-text q. top_category
  // filters the fixed 13-value column; subcategory is an explicit alias for the
  // same free-text `category` column (kept alongside `category` for back-compat).
  app.get('/api/items', requireAuth(async (req, res) => {
    try {
      const { category, top_category, subcategory, tag, q, limit } = req.query;
      const items = await getItems({
        userId: req.userId,
        category: category || undefined,
        topCategory: top_category || undefined,
        subcategory: subcategory || undefined,
        tag: tag || undefined,
        q: q || undefined,
        limit: limit ? parseInt(limit, 10) : undefined
      });
      res.json({ count: items.length, items });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }));

  // GET /api/dashboard — category dashboard summary: one entry per fixed
  // top_category (all 13) with count + latest item, plus the 8 most recent
  // items overall (full shape, so processing cards render).
  app.get('/api/dashboard', requireAuth(async (req, res) => {
    try {
      const dashboard = await getDashboard({ userId: req.userId });
      res.json(dashboard);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }));

  // GET /api/top-categories — the live, ordered top-level category list
  // (name, slug, emoji, sort_order) from the data-driven top_categories table.
  // Public reference data (no auth) so server components can fetch it during
  // render. Re-reads the DB each call so a newly added category appears without
  // a server restart; falls back to the built-in seed list if the DB/table is
  // unavailable.
  app.get('/api/top-categories', async (_req, res) => {
    try {
      await refreshTopCategories();
      res.json({ categories: getTopCategoryRecords() });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/subcategories?top_category=X — subcategory breakdown within one
  // top_category, sorted by count desc.
  app.get('/api/subcategories', requireAuth(async (req, res) => {
    try {
      const topCategory = normalizeTopCategory(req.query.top_category);
      if (!topCategory) return res.status(400).json({ error: 'top_category is required and must be a valid category' });

      const result = await getSubcategories({ userId: req.userId, topCategory });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }));

  // PATCH /api/items/:id/category — manually move an item to a new top_category.
  // Resets its subcategory to 'General' and marks category_manually_set so the
  // save pipeline never overwrites this again.
  app.patch('/api/items/:id/category', requireAuth(async (req, res) => {
    try {
      const topCategory = normalizeTopCategory(req.body && req.body.top_category);
      if (!topCategory) return res.status(400).json({ error: 'top_category is required and must be a valid category' });

      const updated = await setItemTopCategory(req.params.id, req.userId, topCategory);
      if (!updated) return res.status(404).json({ error: 'not_found' });

      const item = await getItemById(req.params.id, req.userId);
      res.json({ item });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }));

  // PATCH /api/items/:id/entities/visibility — set one entity's hidden flag
  // (matched by type + name) on the parent item. Same semantics as the web
  // dashboard's direct-Supabase hide/unhide; exposed for API-only clients.
  app.patch('/api/items/:id/entities/visibility', requireAuth(async (req, res) => {
    try {
      const { type, name, hidden } = req.body || {};
      if (typeof type !== 'string' || !type.trim() || typeof name !== 'string' || !name.trim() || typeof hidden !== 'boolean') {
        return res.status(400).json({ error: 'type, name, and hidden (boolean) are required' });
      }

      const updated = await setEntityHidden(req.params.id, req.userId, { type, name, hidden });
      if (!updated) return res.status(404).json({ error: 'not_found' });

      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }));

  // POST /api/subcategories/consolidate — preview (default) or apply
  // (apply: true) merges of near-duplicate subcategory labels, optionally
  // scoped to one top_category.
  app.post('/api/subcategories/consolidate', requireAuth(async (req, res) => {
    try {
      const { top_category, apply, groups } = req.body || {};
      let topCategory;
      if (top_category !== undefined && top_category !== null && top_category !== '') {
        topCategory = normalizeTopCategory(top_category);
        if (!topCategory) return res.status(400).json({ error: 'top_category must be a valid category' });
      }

      const result = await consolidateSubcategories({
        userId: req.userId,
        topCategory,
        apply: apply === true,
        // When confirming, the client passes back the previewed groups so we
        // apply exactly what the user saw rather than re-proposing.
        groups
      });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }));

  // GET /api/digest — structured artifacts grouped by artifact_type for the
  // Library Digest page. Excludes raw saves (artifact_type='none').
  app.get('/api/digest', requireAuth(async (req, res) => {
    try {
      const digest = await getDigest({ userId: req.userId });
      res.json(digest);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }));

  // GET /api/entities — the canonical entity registry (meta_category,
  // category_path, resolved url/logo, url_status). The Digest tab joins these
  // to /api/digest client-side; no server-side counts (client owns hidden
  // state). Global registry, so no user scoping.
  app.get('/api/entities', requireAuth(async (_req, res) => {
    try {
      const entities = await getEntities();
      res.json(entities);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }));

  // GET /api/entities/review — the manual review queue: every needs_review
  // row paired with its best current match (recalled fresh from the stored
  // embedding; the UNCERTAIN path stores no candidate by design).
  app.get('/api/entities/review', requireAuth(async (_req, res) => {
    try {
      const reviews = await listReviews();
      res.json(reviews);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }));

  // POST /api/entities/:id/review — submit one same/different decision from
  // the Review Matches sheet. body: { decision: 'different' } or
  // { decision: 'same', canonical_id }. "same" runs the shared merge core +
  // rewrites the user's items + deletes the absorbed row.
  app.post('/api/entities/:id/review', requireAuth(async (req, res) => {
    try {
      const { decision, canonical_id } = req.body || {};
      if (decision !== 'same' && decision !== 'different') {
        return res.status(400).json({ error: "decision must be 'same' or 'different'" });
      }
      const result = await applyReviewDecision({
        userId: req.userId,
        id: req.params.id,
        decision,
        canonicalId: canonical_id
      });
      res.json(result);
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
  }));

  // POST /api/entities/sweep — the meta-category page's magic-wand button.
  // body: { type }. Registers every item-entity reference of that type that
  // has no canonical row yet (the rows the Digest shows as "Uncategorized")
  // through the save-time resolver — which also assigns meta_category on
  // insert — then re-resolves meta_category on any rows of the type still
  // lacking one. Synchronous: personal-scale sweeps are seconds, not minutes,
  // and the client wants the final counts to refresh against.
  app.post('/api/entities/sweep', requireAuth(async (req, res) => {
    try {
      const { type } = req.body || {};
      const result = await sweepEntities({ userId: req.userId, type });
      res.json(result);
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
  }));

  // POST /api/entities/resolve-urls — drain the unresolved canonical_url
  // backlog. body: { limit, type }. The URL twin of POST /api/places/geocode:
  // every row still lacking a link gets one lookup, and rows that fail are
  // simply picked up by the next run.
  //
  // Batched rather than all-at-once because each non-passage, non-place row
  // costs a metered web search — the caller drains the queue and watches
  // `remaining` fall to zero.
  app.post('/api/entities/resolve-urls', requireAuth(async (req, res) => {
    try {
      const { limit, type } = req.body || {};
      const result = await resolvePendingEntityUrls({ limit, type });
      res.json(result);
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
  }));

  // GET /api/places/:placeId — live Google Place Details (rating, hours,
  // photo, links) proxied so the Maps API key stays server-side; 24h cache.
  // The placeId comes from the entity's detail.location written at geocode
  // time. 503 until GOOGLE_MAPS_API_KEY is configured.
  app.get('/api/places/:placeId', requireAuth(async (req, res) => {
    try {
      const details = await getPlaceDetails(req.params.placeId);
      res.json(details);
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
  }));

  // POST /api/places/geocode — geocode every place entity still lacking a
  // resolved location (the geo twin of POST /api/entities/sweep). Synchronous
  // for the same reason the sweep is: personal-scale counts, and the caller
  // wants totals to refresh against.
  app.post('/api/places/geocode', requireAuth(async (req, res) => {
    try {
      const result = await geocodePendingPlaces({ userId: req.userId });
      res.json(result);
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
  }));

  // GET /api/link-preview?url=... — OG metadata for a saved source URL.
  app.get('/api/link-preview', async (req, res) => {
    try {
      const { url } = req.query;
      if (!url) return res.status(400).json({ error: 'url is required' });
      const preview = await getLinkPreview(String(url));
      res.json({ preview });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/link-preview/image?url=... — proxy thumbnail bytes (avoids hotlink blocks).
  app.get('/api/link-preview/image', async (req, res) => {
    try {
      const { url } = req.query;
      if (!url) return res.status(400).json({ error: 'url is required' });
      const { data, contentType } = await fetchPreviewImage(String(url));
      res.set('Content-Type', contentType);
      res.set('Cache-Control', 'public, max-age=86400');
      res.send(data);
    } catch (err) {
      res.status(404).json({ error: err.message });
    }
  });

  // DELETE /api/items/:id — permanently remove a saved link.
  app.delete('/api/items/:id', requireAuth(async (req, res) => {
    try {
      const deleted = await deleteItemById(req.params.id, req.userId);
      if (!deleted) return res.status(404).json({ error: 'not_found' });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }));

  // GET /api/items/:id — full single item incl. tags + linked_resources.
  // ?format=markdown returns the rendered MD ("view raw" / export).
  app.get('/api/items/:id', requireAuth(async (req, res) => {
    try {
      const item = await getItemById(req.params.id, req.userId);
      if (!item) return res.status(404).json({ error: 'not_found' });

      if (req.query.format === 'markdown') {
        res.type('text/markdown').send(renderItemAsMarkdown(item));
        return;
      }
      res.json({ item });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }));

  // GET /api/chat/usage — today's chat credit usage for this user. Polled by the
  // frontend usage bar on mount and after every query completes.
  app.get('/api/chat/usage', requireAuth(async (req, res) => {
    try {
      res.json(await getUsage(req.userId));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }));

  // POST /api/chat — stateless library-wide chat streamed as SSE. { question } →
  // progress events, streamed answer text, sources, or an explicit empty state.
  // POST /api/tokens/shortcut — mint the caller's long-lived save token.
  // Kitabi's SaveToKitabi share extension can't reuse the app's Supabase
  // session (separate sandbox, hourly-expiring JWT), so right after sign-in
  // the app calls this under the user's JWT and parks the returned grim_
  // token in the shared keychain for the extension to save with. Self-service
  // on purpose: every signed-in user gets their own token, scoped to their own
  // library. Deliberately does NOT revoke earlier tokens — each device mints
  // its own on first sign-in, and revoking siblings would break the share
  // sheet on every other device. Plaintext goes out once; only the hash is kept.
  const MINTABLE_TOKEN_NAMES = new Set(['Kitabi Share', 'iOS Shortcut']);
  app.post('/api/tokens/shortcut', requireAuth(async (req, res) => {
    const name = req.body?.name || 'iOS Shortcut';
    if (!MINTABLE_TOKEN_NAMES.has(name)) {
      return res.status(400).json({ error: 'invalid_name' });
    }
    try {
      const supabase = getSupabase();
      const token = API_TOKEN_PREFIX + crypto.randomBytes(32).toString('base64url');

      const { error } = await supabase
        .from('api_tokens')
        .insert({ user_id: req.userId, token_hash: hashApiToken(token), name });
      if (error) throw new Error(error.message);

      res.json({ token });
    } catch (err) {
      console.error('POST /api/tokens/shortcut error:', err);
      res.status(500).json({ error: 'mint_failed' });
    }
  }));

  // GET /api/chats — recent library chats for the history sidebar, newest first.
  app.get('/api/chats', requireAuth(async (req, res) => {
    try {
      res.json({ chats: await listChats(req.userId) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }));

  // GET /api/chats/:chatId/messages — full transcript of one chat, oldest first.
  app.get('/api/chats/:chatId/messages', requireAuth(async (req, res) => {
    try {
      res.json({ messages: await listMessages(req.userId, req.params.chatId) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }));

  app.post('/api/chat', requireAuth(async (req, res) => {
    const { question, item_id, chatId, isDeep: isDeepRaw } = req.body || {};
    if (!question) return res.status(400).json({ error: 'question is required' });
    const isDeep = isDeepRaw === true;

    try {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      if (res.flushHeaders) res.flushHeaders();

      // Rate limit before any work. If the user is out of credits, emit the
      // limit SSE event and close the stream — answerQuestion never runs.
      const limit = await checkLimit(req.userId, isDeep);
      if (!limit.allowed) {
        res.write(`data: ${JSON.stringify({ type: 'limit', remaining: limit.remaining, resetAt: limit.resetAt })}\n\n`);
        res.write('data: [DONE]\n\n');
        return res.end();
      }
      await incrementUsage(req.userId, isDeep);

      await answerQuestion({
        userId: req.userId,
        question,
        chatId: chatId || undefined,
        restrictToItemId: item_id || undefined,
        isDeep,
        write: (chunk) => res.write(chunk),
        end: () => res.end()
      });
    } catch (err) {
      if (!res.headersSent) {
        res.status(500).json({ error: err.message });
      } else {
        res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
      }
    }
  }));
}

module.exports = { registerApiRoutes };
