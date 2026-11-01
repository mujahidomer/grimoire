// The orchestrator for Instagram DM capture: the one place that turns a
// verified, echo-filtered messaging event into database writes, an outgoing DM,
// or an attached article.
//
// handleEvent() only SEQUENCES. Every decision is made by decide() (pure), every
// effect goes through `deps`, and this file's top-level imports are the pure
// modules only (links, captures, decide). The side-effecting collaborators
// (repository, linkedResources) are required lazily inside defaultDeps(), so
// the decision path can be exercised with no database and no network. If a rule
// seems to need an import here, the design has gone wrong: put the rule in
// decide() and the effect behind deps.
//
// Order of operations in handleEvent (the numbers are referenced below):
//   0. userId present (never defaulted).
//   1. no `message` object -> ignore. Before ANY lookup or write: receipts and
//      reactions for our own outgoing reply arrive here (webhook.js drops only
//      echoes) and must not fill the user's tray with noise.
//   2. load the live capture; alreadyProcessed -> ignore.
//   3. sender username: from the capture, else the Graph API lookup. If that
//      fails, THROW (see usernameOrThrow). Nothing is written.
//   4. extract + pick + resolve the link; judge the final URL.
//   5. load candidates; decide().
//   6. execute the action, persist the resulting state.
//   7. recordProcessedMessage, LAST. Only after the work for this message has
//      succeeded: recording first would turn a crash mid-processing into a
//      silently dropped DM. A redelivery that redoes finished work is harmless
//      (linked_resources is unique on (item_id, source_url) and the attach
//      upserts; replies are bounded by reply_attempts).

const { extractUrls, resolveUrl, isHubPage, isMediaUrl, pickBestUrl } = require('./links');
const { alreadyProcessed, normalizeUsername } = require('./captures');
const { decide, matchItem, REPLY_WORDS } = require('./decide');
const { defaultUserId } = require('../supabase');

const MATCH_WINDOW_DAYS = 7;
const GRAPH_HOST = 'https://graph.instagram.com';
// UNVERIFIED against a live account: Task 8 must confirm the version and that
// both endpoints below accept it. Overridable without a deploy of code.
const DEFAULT_GRAPH_VERSION = 'v21.0';
const REQUEST_TIMEOUT_MS = 10000;
const LOOKUP_ATTEMPTS = 3;
const LOOKUP_BACKOFF_MS = [500, 1500];

const ignore = (reason) => ({ kind: 'ignore', reason });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ─── User resolution ──────────────────────────────────────────────────────────

// Meta's webhook carries no user context and this deployment is single-user, so
// the owner comes from the environment. items/dm_captures hold every tester's
// rows: a wrong id writes into someone else's library. So this is resolved once
// per event by the caller, passed explicitly, and throws (loudly, via the
// webhook's onEvent catch) rather than ever returning something falsy.
function resolveIgUserId({ env = process.env, fallback = defaultUserId } = {}) {
  const fromEnv = typeof env.IG_USER_ID === 'string' ? env.IG_USER_ID.trim() : '';
  const id = fromEnv || fallback();
  if (!id) throw new Error('Instagram capture: no user id (set IG_USER_ID or GRIMOIRE_USER_ID)');
  return id;
}

// ─── Graph API: username lookup ───────────────────────────────────────────────

function graphBase(version) {
  return `${GRAPH_HOST}/${version || process.env.IG_GRAPH_VERSION || DEFAULT_GRAPH_VERSION}`;
}

// A short, token-free description of a failed Graph response.
async function describeFailure(response) {
  let detail = '';
  try {
    const body = await response.json();
    const err = body && body.error;
    if (err) detail = ` code=${err.code}${err.error_subcode ? `/${err.error_subcode}` : ''} ${String(err.message || '').slice(0, 200)}`;
  } catch { /* body was not JSON; the status is enough */ }
  return `http_${response.status}${detail}`;
}

// Resolve an IGSID to its @handle (the DM carries only the id). NEVER throws:
// {ok:true, username} or {ok:false, error}. Transient failures (network error,
// timeout, 429, 5xx) are retried; a 4xx is not, since asking again cannot help.
// The caller decides what a failure means.
async function lookupUsername(igsid, {
  fetchImpl = fetch, token = process.env.IG_ACCESS_TOKEN, version,
  attempts = LOOKUP_ATTEMPTS, backoffMs = LOOKUP_BACKOFF_MS, sleepImpl = sleep,
} = {}) {
  if (!igsid) return { ok: false, error: 'no_igsid' };
  if (!token) return { ok: false, error: 'no_access_token' };
  const url = `${graphBase(version)}/${encodeURIComponent(igsid)}?fields=username`;
  let lastError = 'unknown';
  for (let attempt = 1; attempt <= attempts; attempt++) {
    let retryable = true;
    try {
      const response = await fetchImpl(url, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (response.ok) {
        const body = await response.json();
        const username = normalizeUsername(body && body.username);
        if (username) return { ok: true, username };
        lastError = 'no_username_in_response';
        retryable = false; // the API answered; asking again gets the same answer
      } else {
        lastError = await describeFailure(response);
        retryable = response.status === 429 || response.status >= 500;
      }
    } catch (err) {
      lastError = `${err && err.name}: ${String(err && err.message).slice(0, 200)}`;
    }
    if (!retryable || attempt === attempts) break;
    await sleepImpl(backoffMs[Math.min(attempt - 1, backoffMs.length - 1)] || 0);
  }
  return { ok: false, error: lastError };
}

// ─── Graph API: send ──────────────────────────────────────────────────────────

// Send one allowlisted word as a DM. NEVER throws: a closed 24-hour messaging
// window, a revoked token and a network failure are all expected outcomes, and
// this runs detached, where a throw becomes an unhandled rejection.
//
// The allowlist is enforced here too, not only in decide(): the system never
// composes a sentence, and this is the last function before the text leaves the
// user's account.
async function sendReply(igsid, text, {
  fetchImpl = fetch, token = process.env.IG_ACCESS_TOKEN, version,
} = {}) {
  try {
    if (!igsid) return { ok: false, error: 'no_igsid' };
    if (!REPLY_WORDS.includes(text)) return { ok: false, error: 'not_allowlisted' };
    if (!token) return { ok: false, error: 'no_access_token' };
    const response = await fetchImpl(`${graphBase(version)}/me/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient: { id: String(igsid) }, message: { text } }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) return { ok: false, error: await describeFailure(response) };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `${err && err.name}: ${String(err && err.message).slice(0, 200)}` };
  }
}

// ─── Production wiring ────────────────────────────────────────────────────────

let cachedDeps = null;

// The real collaborators. Required lazily so that importing this module (and
// every test of handleEvent) never loads the database or the extraction stack.
function defaultDeps() {
  if (cachedDeps) return cachedDeps;
  const captures = require('./captures');
  const { recentInstagramItems } = require('../repository');
  const { attachLinkedResource } = require('../linkedResources');
  cachedDeps = {
    findActiveCapture: captures.findActiveCapture,
    createCapture: captures.createCapture,
    updateCapture: captures.updateCapture,
    findPendingCaptures: captures.findPendingCaptures,
    recordProcessedMessage: captures.recordProcessedMessage,
    recentInstagramItems,
    attachLinkedResource,
    resolveUrl,
    lookupUsername,
    sendReply,
    log: console.log,
  };
  return cachedDeps;
}

// ─── handleEvent ──────────────────────────────────────────────────────────────

class UsernameLookupError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UsernameLookupError';
  }
}

// The sender's @handle, or a thrown UsernameLookupError.
//
// ROUTE TAKEN when the lookup fails: retry (inside lookupUsername), then THROW
// with nothing written. A capture without a username is unmatchable forever
// (findPendingCaptures returns [] for an empty one, so no later save can ever
// find it), and the matcher cannot judge a sender it cannot name, so there is no
// honest row to write. The throw reaches the webhook's onEvent catch, which logs
// it at error level with the message id. The message id is NOT recorded.
async function usernameOrThrow(capture, igsid, mid, deps) {
  const known = normalizeUsername(capture && capture.sender_username);
  if (known) return known;
  const found = await deps.lookupUsername(igsid);
  const username = found && found.ok ? normalizeUsername(found.username) : null;
  if (!username) {
    throw new UsernameLookupError(
      `[ig-capture] could not resolve the sender's username (mid=${mid || 'none'}): `
      + `${(found && found.error) || 'empty result'}; no capture written, DM not processed`
    );
  }
  return username;
}

// handleEvent(event, { userId, deps }) -> the executed action:
//   { kind:'ignore', reason } | { kind:'reply', text } |
//   { kind:'attach', itemId, url } | { kind:'park', reason }
// plus captureId on every action that touched a row. A reply whose send failed
// comes back as a park (see the reply branch).
async function handleEvent(event, { userId, deps } = {}) {
  // Never let userId default to undefined anywhere below.
  if (!userId) throw new Error('handleEvent requires a userId');
  if (!deps) throw new TypeError('handleEvent requires deps');
  const log = typeof deps.log === 'function' ? deps.log : () => {};

  // 1. Not a message at all (read / delivery / reaction receipts, including
  // those generated by our own outgoing reply). Nothing to capture or park.
  const message = event && event.message;
  if (!message || typeof message !== 'object') return ignore('not_a_message');

  const igsid = event.sender && event.sender.id ? String(event.sender.id) : null;
  if (!igsid) return ignore('no_sender');
  const mid = typeof message.mid === 'string' && message.mid ? message.mid : null;
  if (!mid) log('[ig-capture] message has no mid: processing without dedupe or recording');

  // 2.
  let capture = await deps.findActiveCapture(userId, igsid);
  if (mid && alreadyProcessed(capture, mid)) return ignore('already_processed');

  // 3.
  const username = await usernameOrThrow(capture, igsid, mid, deps);

  // 4. Pick the best candidate, follow it to its end, and judge where it ended:
  // a short link can resolve to a hub page, and decide() trusts a resolvedUrl.
  const urls = extractUrls(event);
  const best = pickBestUrl(urls);
  let resolvedUrl = null;
  let hops = null;
  let rejected = null;
  if (best) {
    const resolved = await deps.resolveUrl(best); // { url, hops } | null
    if (resolved && typeof resolved.url === 'string' && resolved.url) {
      hops = resolved.hops;
      if (isHubPage(resolved.url)) rejected = 'hub_page';
      else if (isMediaUrl(resolved.url)) rejected = 'unusable_link';
      else resolvedUrl = resolved.url;
    }
  }

  // 5.
  let action;
  if (rejected) {
    action = { kind: 'park', reason: rejected };
  } else {
    const candidates = await deps.recentInstagramItems(userId, { days: MATCH_WINDOW_DAYS });
    const decideCapture = capture
      ? { ...capture, sender_username: username }
      : { sender_username: username, reply_attempts: 0 };
    action = decide({ capture: decideCapture, event, resolvedUrl, candidates });
  }

  // The two-gate rule: decide() returns ignore only when there is no link and
  // the sender matches nobody. That is the only case that writes no row.
  if (action.kind === 'ignore') return action;

  // 6. A row exists from here on.
  if (!capture) {
    capture = await deps.createCapture(userId, {
      senderIgsid: igsid, senderUsername: username, messageId: mid, messageAt: event.timestamp,
    });
  }
  const base = {
    ...(normalizeUsername(capture.sender_username) ? {} : { sender_username: username }),
    ...(urls.length > 0 ? { links_seen: urls } : {}),
    ...(mid ? { last_message_id: mid } : {}),
    ...(event.timestamp !== undefined ? { last_message_at: event.timestamp } : {}),
  };
  const update = (patch) => deps.updateCapture(capture.id, { ...base, ...patch }, userId);
  const done = (executed) => ({ ...executed, captureId: capture.id });
  const record = async () => {
    if (mid) await deps.recordProcessedMessage(capture.id, mid, userId); // 7. LAST
  };

  if (action.kind === 'attach') {
    try {
      await deps.attachLinkedResource(action.itemId, userId, action.url);
    } catch (err) {
      // The raw URL is kept on the row so the tray can retry it. The message id
      // is NOT recorded: the work failed, and a redelivery should try again.
      console.error(`[ig-capture] attach failed (capture ${capture.id}, item ${action.itemId}):`, err && err.message);
      await update({ state: 'needs_user', needs_user_reason: 'unusable_link', resolved_url: action.url });
      return done({ kind: 'park', reason: 'unusable_link', cause: 'attach_failed' });
    }
    await update({
      state: 'matched', matched_item_id: action.itemId, resolved_url: action.url, needs_user_reason: null,
    });
    await record();
    log(`[ig-capture] attached capture=${capture.id} item=${action.itemId} hops=${hops}`);
    return done(action);
  }

  if (action.kind === 'reply') {
    // Reserve the attempt BEFORE the irreversible send: if the process dies
    // between the send and the next write, the budget still counts it.
    const attempts = (Number.isInteger(capture.reply_attempts) ? capture.reply_attempts : 0) + 1;
    await update({ reply_attempts: attempts });
    const sent = await deps.sendReply(igsid, action.text);
    if (sent && sent.ok) {
      await update({ state: 'replied', needs_user_reason: null });
      await record();
      log(`[ig-capture] replied capture=${capture.id} attempt=${attempts}`);
      return done(action);
    }
    // Expected outcome (the 24h window closed, the token was revoked): park it
    // where the user can answer the gate by hand. NEEDS_USER_REASONS has no
    // reply-failed reason, and a gate we could not pass is closest to
    // freeform_gate. `cause` keeps the distinction in the returned action.
    const error = (sent && sent.error) || 'unknown';
    console.error(`[ig-capture] reply failed (capture ${capture.id}): ${error}`);
    await update({ state: 'needs_user', needs_user_reason: 'freeform_gate' });
    await record();
    return done({ kind: 'park', reason: 'freeform_gate', cause: 'reply_failed', error });
  }

  // park
  await update({
    state: 'needs_user', needs_user_reason: action.reason, resolved_url: resolvedUrl,
  });
  await record();
  log(`[ig-capture] parked capture=${capture.id} reason=${action.reason}`);
  return done(action);
}

// ─── Re-match after a save ────────────────────────────────────────────────────

function isInstagramUrl(url) {
  try {
    const host = new URL(String(url).trim()).hostname.toLowerCase();
    return host === 'instagram.com' || host.endsWith('.instagram.com');
  } catch {
    return false;
  }
}

// A creator's article can arrive BEFORE the reel is saved (the capture parks as
// no_match). When a new Instagram item from that creator is saved, attach the
// waiting article. Behaviour of record: this is what makes comment-first,
// save-later work. Returns how many captures were attached.
//
// Only needs_user/no_match captures that already hold a resolved URL qualify;
// anything else is waiting on something a save cannot supply. One capture
// failing never stops the others.
async function rematchPendingCaptures(userId, senderUsername, { deps = defaultDeps() } = {}) {
  if (!userId) throw new Error('rematchPendingCaptures requires a userId');
  if (!normalizeUsername(senderUsername)) return 0;
  const pending = await deps.findPendingCaptures(userId, senderUsername);
  const waiting = pending.filter((c) => c.state === 'needs_user'
    && c.needs_user_reason === 'no_match' && c.resolved_url);
  if (waiting.length === 0) return 0;

  const candidates = await deps.recentInstagramItems(userId, { days: MATCH_WINDOW_DAYS });
  let attached = 0;
  for (const capture of waiting) {
    const item = matchItem(candidates, capture.sender_username);
    if (!item) continue;
    try {
      await deps.attachLinkedResource(item.id, userId, capture.resolved_url);
      await deps.updateCapture(capture.id, {
        state: 'matched', matched_item_id: item.id, needs_user_reason: null,
      }, userId);
      attached += 1;
    } catch (err) {
      console.error(`[ig-capture] rematch failed (capture ${capture.id}, item ${item.id}):`, err && err.message);
    }
  }
  return attached;
}

// Fire-and-forget wrapper for the save path: it must never fail a save, and a
// rejection here must never go unhandled.
function rematchInBackground(userId, senderUsername, options) {
  rematchPendingCaptures(userId, senderUsername, options)
    .then((n) => { if (n > 0) console.log(`[ig-capture] rematched ${n} waiting capture(s)`); })
    .catch((err) => console.error('[ig-capture] rematch failed:', err && err.message ? err.message : err));
}

module.exports = {
  handleEvent,
  sendReply,
  lookupUsername,
  rematchPendingCaptures,
  rematchInBackground,
  resolveIgUserId,
  defaultDeps,
  isInstagramUrl,
  UsernameLookupError,
};
