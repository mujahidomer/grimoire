const crypto = require('crypto');
const { getSupabase, defaultUserId } = require('./supabase');

// Resolve the authenticated user for an API request. Two real credentials are
// accepted:
//
//   Authorization: Bearer <supabase-jwt>    — web + iOS app users
//   Authorization: Bearer grim_<token>      — server-to-server callers, checked
//                                             against the api_tokens table
//
// The x-user-id / GRIMOIRE_USER_ID fallback is a DEV-ONLY convenience: it names
// a user without proving anything, so anything that honours it is unauthenticated
// by definition. It stays off unless ALLOW_DEV_USER_FALLBACK=true is set on a
// non-production NODE_ENV — deliberately fail-safe, so a deploy that simply
// forgets to set NODE_ENV is still closed.

const API_TOKEN_PREFIX = 'grim_';

function devFallbackAllowed() {
  return (
    process.env.ALLOW_DEV_USER_FALLBACK === 'true' &&
    process.env.NODE_ENV !== 'production'
  );
}

function hashApiToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function unauthorized(message) {
  const err = new Error(message);
  err.status = 401;
  return err;
}

// Look up a `grim_`-prefixed token by hash. Only the hash is ever stored, so a
// leaked database dump does not yield usable credentials.
async function resolveApiToken(token) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('api_tokens')
    .select('id, user_id, revoked_at')
    .eq('token_hash', hashApiToken(token))
    .maybeSingle();

  if (error) {
    console.error('[auth] api_tokens lookup failed:', error.message);
    throw new Error('token_lookup_failed');
  }
  if (!data || data.revoked_at) throw unauthorized('invalid_token');

  // Best-effort usage stamp; never block or fail the request on it.
  supabase
    .from('api_tokens')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', data.id)
    .then(({ error: updateError }) => {
      if (updateError) console.warn('[auth] last_used_at update failed:', updateError.message);
    });

  return data.user_id;
}

async function resolveSupabaseJwt(token) {
  const supabase = getSupabase();
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) throw unauthorized('invalid_token');
  return user.id;
}

async function resolveRequestUserId(req) {
  const authHeader = req.get('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    if (!token) throw unauthorized('invalid_token');
    return token.startsWith(API_TOKEN_PREFIX)
      ? resolveApiToken(token)
      : resolveSupabaseJwt(token);
  }

  if (devFallbackAllowed()) {
    const headerUserId = req.get('x-user-id');
    if (headerUserId) return headerUserId;

    try {
      const userId = defaultUserId();
      warnFallbackUserId(req, userId);
      return userId;
    } catch {
      throw unauthorized('unauthorized');
    }
  }

  throw unauthorized('unauthorized');
}

function warnFallbackUserId(req, userId) {
  if (req.path?.startsWith('/api/')) {
    console.warn(
      `[auth] ${req.method} ${req.path} has no Bearer token — using the dev ` +
      `GRIMOIRE_USER_ID fallback (${userId}). This is dev-only; production ` +
      'callers must send a Supabase JWT or a grim_ API token.',
    );
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

// Loud one-line boot banner so an accidentally-open deployment is visible in the
// Railway logs rather than silently serving the whole library to the internet.
function logAuthMode() {
  if (devFallbackAllowed()) {
    console.warn(
      '⚠️  [auth] DEV USER FALLBACK ENABLED — unauthenticated requests resolve to ' +
      'GRIMOIRE_USER_ID and x-user-id is trusted without verification. Never set ' +
      'ALLOW_DEV_USER_FALLBACK=true on a deployed environment.',
    );
  } else {
    console.log('[auth] Bearer credentials required (Supabase JWT or grim_ API token).');
  }
}

module.exports = {
  resolveRequestUserId,
  requireAuth,
  logAuthMode,
  hashApiToken,
  API_TOKEN_PREFIX,
};
