const OpenAI = require('openai');
const { createAnthropicClient } = require('./anthropicClient');
const { getSupabase } = require('./supabase');

// Boot-time credential check.
//
// A revoked provider key produces no alert anywhere in this app. The save
// pipeline runs detached from its HTTP response (processSaveInBackground), so
// a 401 from Anthropic lands in the logs and nowhere else: the row stays
// 'Untitled' at status='failed' and the user finds out by scrolling their
// library. 2026-11-01 that cost three saves — Railway was holding an
// ANTHROPIC_API_KEY that had been rotated in the local .env weeks earlier,
// and the only visible symptom was the chat tab refusing to answer.
//
// So: ping every provider once at startup and say plainly which ones answered.
// The checks are the real call each provider is used for (one token, one
// embedding), not a key-shaped-string check — only the provider can say
// whether a key is live.
//
// Deliberately NOT fatal. A dead Anthropic key breaks saves and chat, but
// browsing, the Digest and every read path still work off Supabase, and
// exiting here would turn a degraded app into a crash-loop that serves
// nothing. The result is logged loudly and reported by /health instead.

const PROBE_MODEL = 'claude-haiku-5-5';
const EMBED_MODEL = 'text-embedding-3-small';

// A 401/403 means the credential is wrong — that is the failure worth shouting
// about. Anything else (network, 5xx, timeout) is the provider having a bad
// minute, which says nothing about the key and must not be reported as if it
// did.
function classify(err) {
  const status = err?.status ?? err?.response?.status ?? null;
  if (status === 401 || status === 403) {
    return { kind: 'rejected', detail: `credentials rejected (HTTP ${status})` };
  }
  if (status) return { kind: 'unreachable', detail: `HTTP ${status}` };
  return { kind: 'unreachable', detail: err?.message || 'request failed' };
}

async function checkAnthropic() {
  const name = 'anthropic';
  if (!process.env.ANTHROPIC_API_KEY?.trim()) {
    return { name, ok: false, kind: 'missing', detail: 'ANTHROPIC_API_KEY is not set' };
  }
  try {
    await createAnthropicClient().messages.create({
      model: PROBE_MODEL,
      max_tokens: 1,
      messages: [{ role: 'user', content: 'ping' }],
    });
    return { name, ok: true, kind: 'ok', detail: PROBE_MODEL };
  } catch (err) {
    return { name, ok: false, ...classify(err) };
  }
}

async function checkOpenAI() {
  const name = 'openai';
  if (!process.env.OPENAI_API_KEY?.trim()) {
    return { name, ok: false, kind: 'missing', detail: 'OPENAI_API_KEY is not set' };
  }
  try {
    // The embeddings endpoint rather than /v1/models: it is the only thing this
    // app asks OpenAI for, and it also proves the key can reach THIS model, not
    // merely that it authenticates.
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    await client.embeddings.create({ model: EMBED_MODEL, input: 'ping' });
    return { name, ok: true, kind: 'ok', detail: EMBED_MODEL };
  } catch (err) {
    return { name, ok: false, ...classify(err) };
  }
}

async function checkSupabase() {
  const name = 'supabase';
  try {
    const { error } = await getSupabase().from('items').select('id').limit(1);
    if (error) throw Object.assign(new Error(error.message), { status: error.status });
    return { name, ok: true, kind: 'ok', detail: 'items readable' };
  } catch (err) {
    return { name, ok: false, ...classify(err) };
  }
}

// What a failed check means for the user, so the log says which part of the
// app is now broken rather than only which HTTP call failed.
const IMPACT = {
  anthropic: 'saves and chat answers will fail',
  openai: 'semantic search and chat retrieval will fail',
  supabase: 'nothing will work',
};

let lastResult = null;

async function runPreflight() {
  const checks = await Promise.all([checkAnthropic(), checkOpenAI(), checkSupabase()]);
  const failed = checks.filter(c => !c.ok);
  lastResult = { ok: failed.length === 0, checkedAt: new Date().toISOString(), checks };

  if (failed.length === 0) {
    console.log(`✅ [preflight] ${checks.map(c => c.name).join(', ')} — all reachable`);
    return lastResult;
  }

  console.error('');
  console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.error('⛔ [preflight] PROVIDER CHECK FAILED — the app is running degraded');
  for (const check of failed) {
    console.error(`   ✗ ${check.name}: ${check.detail}`);
    console.error(`     → ${IMPACT[check.name] || 'this provider is unavailable'}`);
  }
  if (failed.some(c => c.kind === 'rejected' || c.kind === 'missing')) {
    console.error('');
    console.error('   A rejected key is usually deployment drift: the key was rotated');
    console.error('   locally and the deployed copy was never updated. Compare them');
    console.error('   before assuming the key itself is dead.');
  }
  console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.error('');
  return lastResult;
}

// Null until the first run finishes — /health is live before the probes are.
function lastPreflight() {
  return lastResult;
}

module.exports = { runPreflight, lastPreflight };
