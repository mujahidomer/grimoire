const { getSupabase, defaultUserId } = require('./supabase');

// Resolve the authenticated user for an API request. Prefers a verified Supabase
// JWT (Authorization: Bearer …); falls back to x-user-id / GRIMOIRE_USER_ID for
// local dev and the Telegram capture bot.
async function resolveRequestUserId(req) {
  const authHeader = req.get('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    const supabase = getSupabase();
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) {
      const err = new Error('invalid_token');
      err.status = 401;
      throw err;
    }
    return user.id;
  }

  const headerUserId = req.get('x-user-id');
  if (headerUserId) return headerUserId;

  try {
    return defaultUserId();
  } catch {
    const err = new Error('unauthorized');
    err.status = 401;
    throw err;
  }
}

function requireAuth(handler) {
  return async (req, res) => {
    try {
      req.userId = await resolveRequestUserId(req);
      return handler(req, res);
    } catch (err) {
      const status = err.status || 500;
      if (status === 401) {
        return res.status(401).json({ error: 'unauthorized', message: err.message });
      }
      console.error('Auth error:', err);
      return res.status(500).json({ error: err.message });
    }
  };
}

module.exports = { resolveRequestUserId, requireAuth };
