// State store for Instagram DM capture: one dm_captures row per in-flight
// conversation with a creator. The row is what lets the flow survive a restart
// and what keeps a re-delivered webhook from doing the same work twice.
//
// Layout: the rules (which fields may be patched, what a username looks like,
// when a capture is stale, whether a message was seen) are pure functions at
// the top, unit-tested without a database. The query functions below are thin
// wrappers that apply them.
//
// Multi-tenancy: the service-role client bypasses RLS and dm_captures holds
// every user's conversations, so EVERY query here carries an explicit
// .eq('user_id', userId) and every function refuses a falsy userId rather than
// letting it degrade into an unfiltered query.

const { getSupabase } = require('../supabase');

// Live conversations: the states a later message from the same creator can
// still resume. Mirrors the partial unique index dm_captures_one_active_idx
// (at most one row per user + sender in these states). One list on purpose:
// findActiveCapture, findPendingCaptures and expireStaleCaptures all mean
// "live", so they share it and cannot drift apart.
const ACTIVE_STATES = ['awaiting_link', 'replied', 'needs_user'];
const ALL_STATES = [...ACTIVE_STATES, 'matched', 'expired'];

// Why a capture is parked for the user. A comment in the DDL, not a CHECK
// constraint, so this list is the only enforcement.
//   reply_failed   we tried to answer a gate and Instagram refused (usually the
//                  24-hour window closed): the user answers it by hand.
//   unknown_sender a DM arrived but the sender's handle could not be looked up,
//                  so it cannot be attributed or re-matched by handle.
const NEEDS_USER_REASONS = [
  'follow_gate', 'freeform_gate', 'hub_page', 'unusable_link', 'no_match',
  'reply_failed', 'unknown_sender',
];

// Columns a caller may change through updateCapture. id, user_id and created_at
// are deliberately absent: a patch must never move a row between users.
// updated_at is absent because the set_updated_at trigger owns it.
const PATCHABLE_FIELDS = [
  'sender_username', 'state', 'reply_attempts', 'links_seen', 'resolved_url',
  'matched_item_id', 'needs_user_reason', 'last_message_id', 'last_message_at',
];

const PAGE_SIZE = 1000;
const POSTGRES_UNIQUE_VIOLATION = '23505';

// ─── Pure rules ───────────────────────────────────────────────────────────────

// True when Meta's message id was already recorded on this capture. Meta
// re-delivers a webhook on any non-2xx, so the same id can arrive repeatedly.
function alreadyProcessed(capture, messageId) {
  const seen = capture && capture.processed_message_ids;
  return Array.isArray(seen) && seen.includes(messageId);
}

// Instagram usernames are case-insensitive and may arrive as "@name". Store
// and match one canonical form. Compared with eq, never ilike: underscores are
// common in usernames and are single-character wildcards in a LIKE pattern.
function normalizeUsername(username) {
  if (typeof username !== 'string') return null;
  const cleaned = username.trim().replace(/^@+/, '').toLowerCase();
  return cleaned || null;
}

// Meta sends message timestamps as epoch milliseconds. Accept that, an ISO
// string or a Date; anything unparseable becomes null rather than a bad write.
function toTimestamp(value) {
  if (value === null || value === undefined || value === '') return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// Validate a caller's patch and return exactly the columns to write. Throws on
// an unknown or forbidden key (a typo should fail loudly, not be silently
// dropped), an unknown state, an unknown needs_user_reason, or an empty patch.
function buildCapturePatch(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new Error('updateCapture requires a patch object');
  }
  const out = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (!PATCHABLE_FIELDS.includes(key)) {
      throw new Error(`updateCapture: "${key}" is not a patchable field`);
    }
    out[key] = value;
  }
  if (Object.keys(out).length === 0) throw new Error('updateCapture requires at least one field to change');

  if ('state' in out && !ALL_STATES.includes(out.state)) {
    throw new Error(`updateCapture: unknown state "${out.state}"`);
  }
  if ('needs_user_reason' in out && out.needs_user_reason !== null
      && !NEEDS_USER_REASONS.includes(out.needs_user_reason)) {
    throw new Error(`updateCapture: unknown needs_user_reason "${out.needs_user_reason}"`);
  }
  if ('sender_username' in out) out.sender_username = normalizeUsername(out.sender_username);
  if ('last_message_at' in out) out.last_message_at = toTimestamp(out.last_message_at);
  return out;
}

// ISO cutoff for "stale": a capture last touched before this is abandoned.
function staleCutoff(now, olderThanDays) {
  if (!Number.isFinite(olderThanDays) || olderThanDays <= 0) {
    throw new Error('expireStaleCaptures requires a positive olderThanDays');
  }
  return new Date(now.getTime() - olderThanDays * 24 * 60 * 60 * 1000).toISOString();
}

function isUniqueViolation(error) {
  return !!error && error.code === POSTGRES_UNIQUE_VIOLATION;
}

// Raised by updateCapture when moving a capture into a live state would give
// the sender two live captures (the dm_captures_one_active_idx unique index),
// e.g. re-opening a matched/expired capture while a newer one is live. Named so
// a webhook handler can catch it instead of surfacing a raw constraint message.
class CaptureConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CaptureConflictError';
    this.code = 'active_capture_exists';
  }
}

// Map a Supabase error from the updateCapture write to what the caller sees.
function toUpdateError(error) {
  if (isUniqueViolation(error)) {
    return new CaptureConflictError(
      'updateCapture: this sender already has a live capture; cannot make another one live'
    );
  }
  return new Error(`updateCapture failed: ${error.message}`);
}

function requireUserId(fn, userId) {
  if (!userId) throw new Error(`${fn} requires a userId`);
}

// ─── Queries ──────────────────────────────────────────────────────────────────

// The live capture for this sender, or null. The partial unique index
// guarantees at most one row in an active state.
async function findActiveCapture(userId, senderIgsid) {
  requireUserId('findActiveCapture', userId);
  if (!senderIgsid) throw new Error('findActiveCapture requires a senderIgsid');
  const { data, error } = await getSupabase()
    .from('dm_captures')
    .select('*')
    .eq('user_id', userId)
    .eq('sender_igsid', senderIgsid)
    .in('state', ACTIVE_STATES)
    .maybeSingle();
  if (error) throw new Error(`findActiveCapture failed: ${error.message}`);
  return data || null;
}

// Open a capture in the default 'awaiting_link' state.
//
// senderUsername is optional because the webhook carries only the IGSID; the
// handle needs a separate Graph API lookup that can fail. BUT a capture with no
// username is invisible to findPendingCaptures (it matches on username and
// returns [] for an empty one), so a creator's later article can never find it:
// it is reachable only through findActiveCapture by IGSID. Do not create one
// casually; backfill the username with updateCapture as soon as it is known.
//
// Does NOT record messageId as processed: the caller does that through
// recordProcessedMessage once the work for that message has succeeded. If a
// concurrent delivery created the active capture first, the unique index
// rejects this insert and we return that existing row, so both deliveries land
// on one capture.
async function createCapture(userId, { senderIgsid, senderUsername, messageId, messageAt } = {}) {
  requireUserId('createCapture', userId);
  if (!senderIgsid) throw new Error('createCapture requires a senderIgsid');
  const { data, error } = await getSupabase()
    .from('dm_captures')
    .insert({
      user_id: userId,
      sender_igsid: senderIgsid,
      sender_username: normalizeUsername(senderUsername),
      last_message_id: messageId || null,
      last_message_at: toTimestamp(messageAt),
    })
    .select('*')
    .single();
  if (isUniqueViolation(error)) {
    const existing = await findActiveCapture(userId, senderIgsid);
    if (existing) return existing;
  }
  if (error) throw new Error(`createCapture failed: ${error.message}`);
  return data;
}

// Change fields on a capture. SIGNATURE DEVIATION from the brief's
// (captureId, patch): userId is a required third argument so the write is
// scoped by user_id like every other query here.
async function updateCapture(captureId, patch, userId) {
  requireUserId('updateCapture', userId);
  if (!captureId) throw new Error('updateCapture requires a captureId');
  const fields = buildCapturePatch(patch);
  const { data, error } = await getSupabase()
    .from('dm_captures')
    .update(fields)
    .eq('id', captureId)
    .eq('user_id', userId)
    .select('*')
    .maybeSingle();
  if (error) throw toUpdateError(error);
  if (!data) throw new Error(`updateCapture: capture ${captureId} not found for this user`);
  return data;
}

// Captures this creator could still be waiting on, oldest first. A list query,
// so it pages with an explicit .range() instead of trusting the 1000-row cap.
async function findPendingCaptures(userId, senderUsername) {
  requireUserId('findPendingCaptures', userId);
  const username = normalizeUsername(senderUsername);
  if (!username) return [];
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await getSupabase()
      .from('dm_captures')
      .select('*')
      .eq('user_id', userId)
      .eq('sender_username', username)
      .in('state', ACTIVE_STATES)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`findPendingCaptures failed: ${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return rows;
}

// Move abandoned live captures to 'expired' (freeing the sender to open a fresh
// one) and return how many. "Abandoned" = no update for olderThanDays; updated_at
// is bumped by the set_updated_at trigger on every write.
async function expireStaleCaptures(userId, olderThanDays = 7) {
  requireUserId('expireStaleCaptures', userId);
  const cutoff = staleCutoff(new Date(), olderThanDays);
  const { data, error, count } = await getSupabase()
    .from('dm_captures')
    .update({ state: 'expired' }, { count: 'exact' })
    .eq('user_id', userId)
    .in('state', ACTIVE_STATES)
    .lt('updated_at', cutoff)
    .select('id');
  if (error) throw new Error(`expireStaleCaptures failed: ${error.message}`);
  return typeof count === 'number' ? count : (data || []).length;
}

// Record a Meta message id on the capture, atomically, and report whether THIS
// call recorded it.
//
// ORDERING: call this only AFTER the work for the message has succeeded, never
// before. Use alreadyProcessed(capture, messageId) up front to skip a message
// that is known done. Duplicate work is harmless: attaching a linked resource
// is idempotent in the database (linked_resources unique (item_id, source_url)
// + upsert onConflict), and replies are bounded by reply_attempts. A message
// recorded as done but never actually handled (a crash between recording and
// working) is lost silently and unrecoverably: Meta's redelivery would be
// skipped and the article would never arrive. So the safe failure is "worked
// twice", not "never worked". Do not use the return value to claim a message
// before doing its work.
//
// The append is done in Postgres (append_dm_capture_message) as one UPDATE
// rather than read-modify-write here, because two close webhook deliveries
// would otherwise both read the array, both append, and one write would lose
// the other's id (after which a third delivery would be processed again).
// Returns true if this call newly recorded the id, false if it was already
// there (a concurrent or earlier delivery finished the same message first).
// Signature deviates from the brief in two ways: userId is a required third
// argument (coordinator-approved), and it returns a boolean, not void.
async function recordProcessedMessage(captureId, messageId, userId) {
  requireUserId('recordProcessedMessage', userId);
  if (!captureId) throw new Error('recordProcessedMessage requires a captureId');
  if (!messageId) throw new Error('recordProcessedMessage requires a messageId');
  const { data, error } = await getSupabase().rpc('append_dm_capture_message', {
    p_user_id: userId,
    p_capture_id: captureId,
    p_message_id: messageId,
  });
  if (error) throw new Error(`recordProcessedMessage failed: ${error.message}`);
  return data === true;
}

module.exports = {
  findActiveCapture,
  createCapture,
  updateCapture,
  findPendingCaptures,
  expireStaleCaptures,
  alreadyProcessed,
  recordProcessedMessage,
  // Pure helpers, exported for tests and for later tasks.
  normalizeUsername,
  buildCapturePatch,
  staleCutoff,
  toTimestamp,
  isUniqueViolation,
  toUpdateError,
  CaptureConflictError,
  NEEDS_USER_REASONS,
  ACTIVE_STATES,
};
