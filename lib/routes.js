const { getItems, getItemById } = require('./repository');
const { answerQuestion } = require('./chat');
const { renderItemAsMarkdown } = require('./render');
const { defaultUserId } = require('./supabase');

// Retrieval + chat API (Doc A item 5). Thin Express handlers over the service
// modules — the future MCP server calls the same functions directly, so no logic
// lives here. RLS-scoped: the user id comes from the `x-user-id` header, falling
// back to the single testing-phase user (GRIMOIRE_USER_ID). Real auth (Supabase
// JWT → auth.uid()) layers on later without touching these handlers.

function resolveUserId(req) {
  return req.get('x-user-id') || defaultUserId();
}

function registerApiRoutes(app) {
  // GET /api/items — list/filter by category, tag, free-text q.
  app.get('/api/items', async (req, res) => {
    try {
      const userId = resolveUserId(req);
      const { category, tag, q, limit } = req.query;
      const items = await getItems({
        userId,
        category: category || undefined,
        tag: tag || undefined,
        q: q || undefined,
        limit: limit ? parseInt(limit, 10) : undefined
      });
      res.json({ count: items.length, items });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/items/:id — full single item incl. tags + linked_resources.
  // ?format=markdown returns the rendered MD ("view raw" / export).
  app.get('/api/items/:id', async (req, res) => {
    try {
      const userId = resolveUserId(req);
      const item = await getItemById(req.params.id, userId);
      if (!item) return res.status(404).json({ error: 'not_found' });

      if (req.query.format === 'markdown') {
        res.type('text/markdown').send(renderItemAsMarkdown(item));
        return;
      }
      res.json({ item });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/chat — stateless library-wide chat. { question } → grounded answer
  // or an explicit empty state. Does NOT persist to chats/messages this phase.
  app.post('/api/chat', async (req, res) => {
    try {
      const userId = resolveUserId(req);
      const { question, item_id } = req.body || {};
      if (!question) return res.status(400).json({ error: 'question is required' });

      const result = await answerQuestion({
        userId,
        question,
        restrictToItemId: item_id || undefined
      });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}

module.exports = { registerApiRoutes };
