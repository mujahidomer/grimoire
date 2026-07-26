#!/usr/bin/env node
// Mint an API token for a server-to-server caller (the iOS Shortcut capture
// endpoints, a future MCP server, cron jobs) — anything that cannot hold a
// Supabase session but needs to act as one user.
//
//   node scripts/mint-api-token.js "iOS Shortcut"
//   node scripts/mint-api-token.js "iOS Shortcut" --user <uuid>
//
// Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY. Without --user the token is
// bound to GRIMOIRE_USER_ID. Only the SHA-256 hash is stored, so the plaintext
// token is printed once and cannot be recovered afterwards — if it is lost,
// revoke the row and mint a new one.
//
// Revoke:  update api_tokens set revoked_at = now() where name = 'iOS Shortcut';

require('dotenv').config();
const crypto = require('crypto');
const { getSupabase, defaultUserId } = require('../lib/supabase');
const { hashApiToken, API_TOKEN_PREFIX } = require('../lib/request-auth');

function parseArgs(argv) {
  const args = argv.slice(2);
  const userFlag = args.indexOf('--user');
  let userId = null;
  if (userFlag !== -1) {
    userId = args[userFlag + 1];
    if (!userId) throw new Error('--user needs a uuid');
    args.splice(userFlag, 2);
  }
  return { name: args.join(' ').trim(), userId };
}

async function main() {
  const { name, userId: explicitUserId } = parseArgs(process.argv);
  if (!name) {
    console.error('Usage: node scripts/mint-api-token.js "<name>" [--user <uuid>]');
    process.exit(1);
  }

  const userId = explicitUserId || defaultUserId();
  const token = API_TOKEN_PREFIX + crypto.randomBytes(32).toString('base64url');

  const { error } = await getSupabase()
    .from('api_tokens')
    .insert({ user_id: userId, token_hash: hashApiToken(token), name });

  if (error) throw new Error(`insert failed: ${error.message}`);

  console.log(`\n✅ Minted "${name}" for user ${userId}\n`);
  console.log('Send it as a header — shown once, store it now:\n');
  console.log(`  Authorization: Bearer ${token}\n`);
}

main().catch((err) => {
  console.error('❌', err.message);
  process.exit(1);
});
