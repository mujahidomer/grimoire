const { createClient } = require('@supabase/supabase-js');

// Server-side Supabase client using the SERVICE ROLE key. This bypasses RLS, so
// it is ONLY ever used by trusted server code (the capture pipeline, the
// migration script, the retrieval service). Never ship this key to a client.
//
// Because the service role bypasses RLS, every query the server runs MUST scope
// by user_id itself — the repository layer does this on every call.

let client = null;

function getSupabase() {
  if (client) return client;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (see .env.example).'
    );
  }

  client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  return client;
}

// The single hardcoded user during the testing phase. Multi-user is enforced at
// the schema/RLS level from day one; the app may skip a login screen for now and
// fall back to this id (Doc A §Auth). Routes prefer an explicit x-user-id header.
function defaultUserId() {
  const id = process.env.GRIMOIRE_USER_ID;
  if (!id) {
    throw new Error('GRIMOIRE_USER_ID is not set (the single testing-phase user).');
  }
  return id;
}

module.exports = { getSupabase, defaultUserId };
