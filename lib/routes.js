const { getItems, getItemById, getDigest, deleteItemById } = require('./repository');
const { answerQuestion } = require('./chat');
const { renderItemAsMarkdown } = require('./render');
const { getLinkPreview, fetchPreviewImage } = require('./link-preview');
const { requireAuth } = require('./request-auth');

// Retrieval + chat API (Doc A item 5). Thin Express handlers over the service
// modules — the future MCP server calls the same functions directly, so no logic
// lives here. User id comes from a verified Supabase JWT or the dev fallback.

function registerApiRoutes(app) {
  // GET /api/items — list/filter by category, tag, free-text q.
  app.get('/api/items', requireAuth(async (req, res) => {
    try {
      const { category, tag, q, limit } = req.query;
      const items = await getItems({
        userId: req.userId,
        category: category || undefined,
        tag: tag || undefined,
        q: q || undefined,
        limit: limit ? parseInt(limit, 10) : undefined
      });
      res.json({ count: items.length, items });
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

  // POST /api/chat — stateless library-wide chat. { question } → grounded answer
  // or an explicit empty state. Does NOT persist to chats/messages this phase.
  app.post('/api/chat', requireAuth(async (req, res) => {
    try {
      const { question, item_id } = req.body || {};
      if (!question) return res.status(400).json({ error: 'question is required' });

      const result = await answerQuestion({
        userId: req.userId,
        question,
        restrictToItemId: item_id || undefined
      });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }));
}

module.exports = { registerApiRoutes };
