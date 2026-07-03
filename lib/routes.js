const {
  getItems,
  getItemById,
  getDigest,
  deleteItemById,
  getDashboard,
  getSubcategories,
  setItemTopCategory
} = require('./repository');
const { answerQuestion } = require('./chat');
const { renderItemAsMarkdown } = require('./render');
const { getLinkPreview, fetchPreviewImage } = require('./link-preview');
const { requireAuth } = require('./request-auth');
const { getUsage, checkLimit, incrementUsage } = require('./queryLimits');
const { listChats, listMessages } = require('./chatHistory');
const { normalizeTopCategory, getTopCategoryRecords, refreshTopCategories } = require('./topCategories');
const { consolidateSubcategories } = require('./subcategoryConsolidation');

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
