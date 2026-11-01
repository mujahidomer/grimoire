const { test } = require('node:test');
const assert = require('node:assert');
const {
  handleEvent, sendReply, lookupUsername, rematchPendingCaptures, resolveIgUserId, isInstagramUrl,
} = require('../lib/instagram/capture');
const { buildCapturePatch } = require('../lib/instagram/captures');

const USER = '00000000-0000-0000-0000-000000000001';
const reel = { id: 'item-1', source_author: 'thecreator',
  source_url: 'https://instagram.com/reel/ABC', created_at: '2026-11-01T10:00:00Z' };

const liveCapture = (over = {}) => ({ id: 'cap-1', sender_username: 'thecreator',
  reply_attempts: 0, state: 'awaiting_link', processed_message_ids: [], ...over });

// Every collaborator is a fake that records its call, in order, in calls.order.
function deps(over = {}) {
  const calls = { attached: [], replied: [], updated: [], recorded: [], created: [], looked: [], order: [], users: [], logs: [], errors: [] };
  return { calls, ...{
    log: (m) => calls.logs.push(m),
    logError: (m) => calls.errors.push(m),
    findActiveCapture: async (u) => { calls.users.push(u); return liveCapture(); },
    createCapture: async (u, c) => { calls.users.push(u); calls.created.push(c); calls.order.push('create');
      return { id: 'cap-new', ...c, sender_username: c.senderUsername, reply_attempts: 0, processed_message_ids: [] }; },
    updateCapture: async (id, patch, u) => { calls.users.push(u); calls.updated.push([id, patch]);
      calls.order.push(`update:${patch.state || (patch.reply_attempts !== undefined ? 'attempt' : 'other')}`);
      return { id, ...patch }; },
    recordProcessedMessage: async (id, mid, u) => { calls.users.push(u); calls.recorded.push([id, mid]);
      calls.order.push('record'); return true; },
    recentInstagramItems: async (u) => { calls.users.push(u); return [reel]; },
    resolveUrl: async (u) => ({ url: u, hops: 1 }),
    lookupUsername: async (igsid) => { calls.looked.push(igsid); return { ok: true, username: 'stranger' }; },
    attachLinkedResource: async (itemId, u, url) => { calls.users.push(u); calls.attached.push([itemId, url]);
      calls.order.push('attach'); return {}; },
    sendReply: async (igsid, text) => { calls.replied.push([igsid, text]); calls.order.push('send'); return { ok: true }; },
  }, ...over };
}

const dm = (text, mid = 'mid.A', extra = {}) => ({ sender: { id: 'igsid-1' }, message: { mid, text }, ...extra });

// ─── The brief's six ──────────────────────────────────────────────────────────

test('handleEvent attaches the article to the matched reel', async () => {
  const d = deps();
  const action = await handleEvent(dm('https://example.com/guide'), { userId: USER, deps: d });
  assert.strictEqual(action.kind, 'attach');
  assert.deepStrictEqual(d.calls.attached, [['item-1', 'https://example.com/guide']]);
});

// Review Focus 2: a Meta retry must not attach twice
test('handleEvent ignores a message id it has already processed', async () => {
  const d = deps({ findActiveCapture: async () => liveCapture({ processed_message_ids: ['mid.A'] }) });
  const action = await handleEvent(dm('https://example.com/guide'), { userId: USER, deps: d });
  assert.strictEqual(action.kind, 'ignore');
  assert.deepStrictEqual(d.calls.attached, []);
});

test('handleEvent sends the allowlisted reply and counts the attempt', async () => {
  const d = deps();
  await handleEvent(dm('reply DONE to get the link', 'mid.B'), { userId: USER, deps: d });
  assert.deepStrictEqual(d.calls.replied, [['igsid-1', 'DONE']]);
  assert.strictEqual(d.calls.updated.some(([, p]) => p.reply_attempts === 1), true);
});

// Review Focus 5: the 24h window has closed
test('handleEvent parks the capture when the reply fails', async () => {
  const d = deps({ sendReply: async () => ({ ok: false, error: 'outside_window' }) });
  const action = await handleEvent(dm('reply DONE', 'mid.C'), { userId: USER, deps: d });
  assert.strictEqual(action.kind, 'park');
  assert.strictEqual(d.calls.updated.some(([, p]) => p.state === 'needs_user'), true);
});

test('handleEvent writes no capture for a stranger with no link', async () => {
  const d = deps({ findActiveCapture: async () => null, recentInstagramItems: async () => [] });
  const action = await handleEvent(dm('hey are you free', 'mid.D'), { userId: USER, deps: d });
  assert.strictEqual(action.kind, 'ignore');
  assert.deepStrictEqual(d.calls.replied, []);
  assert.deepStrictEqual(d.calls.created, [], 'no row for a stranger with no link');
});

test('handleEvent parks a link from a stranger instead of dropping it', async () => {
  const d = deps({ findActiveCapture: async () => null, recentInstagramItems: async () => [] });
  const action = await handleEvent(dm('https://example.com/guide', 'mid.E'), { userId: USER, deps: d });
  assert.strictEqual(action.kind, 'park');
  assert.deepStrictEqual(d.calls.replied, []);
  assert.strictEqual(d.calls.created.length, 1);
});

// ─── Filtering: events that are not messages ──────────────────────────────────

test('handleEvent ignores read, delivery and reaction events before touching anything', async () => {
  const boom = () => { throw new Error('a collaborator was called for a non-message event'); };
  const d = deps({ findActiveCapture: boom, createCapture: boom, updateCapture: boom,
    recordProcessedMessage: boom, recentInstagramItems: boom, resolveUrl: boom,
    lookupUsername: boom, attachLinkedResource: boom, sendReply: boom });
  for (const ev of [
    { sender: { id: 'igsid-1' }, read: { mid: 'mid.R' } },
    { sender: { id: 'igsid-1' }, delivery: { mids: ['mid.R'] } },
    { sender: { id: 'igsid-1' }, reaction: { mid: 'mid.R', action: 'react', reaction: 'love' } },
    { sender: { id: 'igsid-1' }, postback: { mid: 'mid.R', payload: 'x' } },
    { sender: { id: 'igsid-1' } },
    {}, null, undefined,
  ]) {
    const action = await handleEvent(ev, { userId: USER, deps: d });
    assert.deepStrictEqual(action, { kind: 'ignore', reason: 'not_a_message' });
  }
});

test('handleEvent refuses to run without a userId', async () => {
  await assert.rejects(handleEvent(dm('x'), { deps: deps() }), /requires a userId/);
  await assert.rejects(handleEvent(dm('x'), { userId: '', deps: deps() }), /requires a userId/);
});

test('handleEvent passes the same explicit userId to every collaborator', async () => {
  const d = deps();
  await handleEvent(dm('https://example.com/guide'), { userId: USER, deps: d });
  assert.ok(d.calls.users.length >= 5, 'find, candidates, attach, update and record all took a user id');
  assert.deepStrictEqual([...new Set(d.calls.users)], [USER]);
});

// ─── Ordering: the message id is recorded LAST ────────────────────────────────

test('attach: the message id is recorded after the attach and the state write', async () => {
  const d = deps();
  await handleEvent(dm('https://example.com/guide'), { userId: USER, deps: d });
  assert.deepStrictEqual(d.calls.order, ['attach', 'update:matched', 'record']);
  assert.deepStrictEqual(d.calls.recorded, [['cap-1', 'mid.A']]);
});

test('reply: the attempt is reserved before the send, the id recorded after both', async () => {
  const d = deps();
  await handleEvent(dm('reply DONE', 'mid.B'), { userId: USER, deps: d });
  assert.deepStrictEqual(d.calls.order, ['update:attempt', 'send', 'update:replied', 'record']);
});

test('a crash during the work leaves the message id unrecorded so a redelivery redoes it', async () => {
  const d = deps({ attachLinkedResource: async () => { throw new Error('db down'); } });
  const action = await handleEvent(dm('https://example.com/guide'), { userId: USER, deps: d });
  assert.strictEqual(action.kind, 'park');
  assert.strictEqual(action.cause, 'attach_failed');
  assert.deepStrictEqual(d.calls.recorded, [], 'failed work is never recorded as done');
  assert.match(d.calls.errors[0], /attach failed \(capture cap-1, item item-1\): Error: db down/);
  const [, patch] = d.calls.updated[0];
  assert.strictEqual(patch.state, 'needs_user');
  assert.strictEqual(patch.resolved_url, 'https://example.com/guide', 'the raw url is kept for a retry');
});

test('a throw from a write propagates and nothing is recorded', async () => {
  const d = deps({ updateCapture: async () => { throw new Error('write failed'); } });
  await assert.rejects(handleEvent(dm('https://example.com/guide'), { userId: USER, deps: d }), /write failed/);
  assert.deepStrictEqual(d.calls.recorded, []);
});

test('ignore records nothing: there was no work to claim', async () => {
  const d = deps({ findActiveCapture: async () => null, recentInstagramItems: async () => [] });
  await handleEvent(dm('hey are you free', 'mid.D'), { userId: USER, deps: d });
  assert.deepStrictEqual(d.calls.recorded, []);
});

// ─── The four action kinds ────────────────────────────────────────────────────

test('attach: the capture becomes matched and keeps the item and the resolved url', async () => {
  const d = deps();
  await handleEvent(dm('https://example.com/guide'), { userId: USER, deps: d });
  const [id, patch] = d.calls.updated[0];
  assert.strictEqual(id, 'cap-1');
  assert.strictEqual(patch.state, 'matched');
  assert.strictEqual(patch.matched_item_id, 'item-1');
  assert.strictEqual(patch.resolved_url, 'https://example.com/guide');
  assert.deepStrictEqual(patch.links_seen, ['https://example.com/guide']);
  assert.strictEqual(patch.last_message_id, 'mid.A');
});

test('resolveUrl returns { url, hops }: the FINAL url is what gets attached', async () => {
  const d = deps({ resolveUrl: async () => ({ url: 'https://example.com/final-article', hops: 3 }) });
  await handleEvent(dm('https://mnch.at/abc'), { userId: USER, deps: d });
  assert.deepStrictEqual(d.calls.attached, [['item-1', 'https://example.com/final-article']]);
});

test('an unresolvable link (resolveUrl null) parks as unusable_link and attaches nothing', async () => {
  const d = deps({ resolveUrl: async () => null });
  const action = await handleEvent(dm('https://example.com/guide'), { userId: USER, deps: d });
  assert.deepStrictEqual([action.kind, action.reason], ['park', 'unusable_link']);
  assert.deepStrictEqual(d.calls.attached, []);
});

test('a short link that resolves to a hub page parks as hub_page and attaches nothing', async () => {
  const d = deps({ resolveUrl: async () => ({ url: 'https://linktr.ee/thecreator', hops: 2 }) });
  const action = await handleEvent(dm('https://mnch.at/abc'), { userId: USER, deps: d });
  assert.deepStrictEqual([action.kind, action.reason], ['park', 'hub_page']);
  assert.deepStrictEqual(d.calls.attached, []);
});

test('the hub verdict is decide()\'s: capture.js passes the resolved url through untouched', async () => {
  const seen = [];
  const d = deps({ resolveUrl: async () => ({ url: 'https://linktr.ee/thecreator', hops: 2 }),
    recentInstagramItems: async () => { seen.push('candidates'); return [reel]; } });
  const action = await handleEvent(dm('https://mnch.at/abc'), { userId: USER, deps: d });
  assert.strictEqual(action.reason, 'hub_page');
  assert.deepStrictEqual(seen, ['candidates'], 'the orchestrator no longer short-circuits before decide()');
});

test('a hub resolved url is never written as resolved_url', async () => {
  const d = deps({ resolveUrl: async () => ({ url: 'https://linktr.ee/thecreator', hops: 2 }) });
  await handleEvent(dm('https://mnch.at/abc'), { userId: USER, deps: d });
  for (const [, patch] of d.calls.updated) assert.ok(!('resolved_url' in buildCapturePatch(patch)));
});

test('a short link that resolves to a media file parks as unusable_link', async () => {
  const d = deps({ resolveUrl: async () => ({ url: 'https://scontent.cdninstagram.com/v/x.jpg', hops: 1 }) });
  const action = await handleEvent(dm('https://mnch.at/abc'), { userId: USER, deps: d });
  assert.deepStrictEqual([action.kind, action.reason], ['park', 'unusable_link']);
});

test('a resolved article from a creator with no saved reel parks as no_match and keeps the url', async () => {
  const d = deps({ recentInstagramItems: async () => [] });
  const action = await handleEvent(dm('https://example.com/guide'), { userId: USER, deps: d });
  assert.deepStrictEqual([action.kind, action.reason], ['park', 'no_match']);
  const [, patch] = d.calls.updated[0];
  assert.strictEqual(patch.needs_user_reason, 'no_match');
  assert.strictEqual(patch.resolved_url, 'https://example.com/guide');
});

test('park: a freeform prompt from a matched creator goes to the tray with its reason', async () => {
  const d = deps();
  const action = await handleEvent(dm('what is your favourite colour?'), { userId: USER, deps: d });
  assert.deepStrictEqual([action.kind, action.reason], ['park', 'freeform_gate']);
  assert.deepStrictEqual(d.calls.replied, []);
});

test('reply: success moves the capture to replied', async () => {
  const d = deps();
  const action = await handleEvent(dm('reply DONE', 'mid.B'), { userId: USER, deps: d });
  assert.strictEqual(action.kind, 'reply');
  assert.strictEqual(d.calls.updated.at(-1)[1].state, 'replied');
});

test('reply: a failed send is parked as reply_failed, not thrown and not freeform_gate', async () => {
  const d = deps({ sendReply: async () => ({ ok: false, error: 'http_400 code=10' }) });
  const action = await handleEvent(dm('reply DONE', 'mid.C'), { userId: USER, deps: d });
  assert.deepStrictEqual([action.kind, action.reason, action.error], ['park', 'reply_failed', 'http_400 code=10']);
  const last = d.calls.updated.at(-1)[1];
  assert.deepStrictEqual([last.state, last.needs_user_reason], ['needs_user', 'reply_failed']);
  assert.deepStrictEqual(d.calls.recorded, [['cap-1', 'mid.C']], 'parked visibly, so the message is handled');
  assert.match(d.calls.errors[0], /reply failed \(capture cap-1\): http_400 code=10/);
  assert.strictEqual(d.calls.updated.some(([, p]) => p.reply_attempts === 1), true, 'the attempt still counts');
});

test('reply: with the budget spent nothing is sent and the capture is parked', async () => {
  const d = deps({ findActiveCapture: async () => liveCapture({ reply_attempts: 2 }) });
  const action = await handleEvent(dm('reply DONE', 'mid.F'), { userId: USER, deps: d });
  assert.strictEqual(action.kind, 'park');
  assert.deepStrictEqual(d.calls.replied, []);
});

test('reply: never sent to a sender who matches no saved reel', async () => {
  const d = deps({ findActiveCapture: async () => null, recentInstagramItems: async () => [] });
  const action = await handleEvent(dm('reply DONE', 'mid.G'), { userId: USER, deps: d });
  assert.strictEqual(action.kind, 'ignore');
  assert.deepStrictEqual(d.calls.replied, []);
});

// ─── Username resolution ──────────────────────────────────────────────────────

test('the username comes from the capture when it has one: no lookup', async () => {
  const d = deps();
  await handleEvent(dm('https://example.com/guide'), { userId: USER, deps: d });
  assert.deepStrictEqual(d.calls.looked, []);
});

test('with no capture the username is looked up and the new row carries it', async () => {
  const d = deps({ findActiveCapture: async () => null,
    lookupUsername: async (igsid) => ({ ok: true, username: '@TheCreator' }) });
  const action = await handleEvent(dm('https://example.com/guide'), { userId: USER, deps: d });
  assert.strictEqual(action.kind, 'attach', 'the looked-up handle matched the saved reel');
  assert.strictEqual(d.calls.created[0].senderUsername, 'thecreator', 'normalized before the row is written');
});

test('lookup failure: the DM is parked as unknown_sender with a null username, not thrown away', async () => {
  const d = deps({ findActiveCapture: async () => null,
    lookupUsername: async () => ({ ok: false, error: 'http_503' }) });
  const action = await handleEvent(dm('https://example.com/guide', 'mid.X'), { userId: USER, deps: d });
  assert.deepStrictEqual([action.kind, action.reason, action.cause], ['park', 'unknown_sender', 'username_lookup_failed']);
  assert.strictEqual(action.error, 'http_503');
  assert.strictEqual(d.calls.created.length, 1);
  assert.strictEqual(d.calls.created[0].senderUsername, null);
  assert.strictEqual(d.calls.created[0].senderIgsid, 'igsid-1');
  const [id, patch] = d.calls.updated[0];
  assert.strictEqual(id, 'cap-new');
  assert.deepStrictEqual([patch.state, patch.needs_user_reason], ['needs_user', 'unknown_sender']);
  assert.deepStrictEqual(patch.links_seen, ['https://example.com/guide']);
  assert.strictEqual(patch.resolved_url, 'https://example.com/guide', 'a real article stays attachable from the tray');
  assert.deepStrictEqual(d.calls.recorded, [['cap-new', 'mid.X']], 'visibly parked, so handled');
  assert.deepStrictEqual(d.calls.replied, [], 'never a reply to a sender we cannot name');
  assert.strictEqual(d.calls.errors.length, 1, 'the only trace of a lost DM goes through the injected sink');
  assert.match(d.calls.errors[0], /mid\.X.*http_503.*unknown_sender/);
  assert.deepStrictEqual(d.calls.attached, [], 'and never an attach: no handle, no match');
});

test('lookup failure does not keep a hub url as resolved_url', async () => {
  const d = deps({ findActiveCapture: async () => null,
    lookupUsername: async () => ({ ok: false, error: 'http_503' }),
    resolveUrl: async () => ({ url: 'https://linktr.ee/thecreator', hops: 1 }) });
  await handleEvent(dm('https://mnch.at/abc'), { userId: USER, deps: d });
  assert.strictEqual('resolved_url' in d.calls.updated[0][1], false);
});

test('lookup failure on a link-less DM still parks it rather than dropping it', async () => {
  const d = deps({ findActiveCapture: async () => null,
    lookupUsername: async () => ({ ok: false, error: 'http_503' }) });
  const action = await handleEvent(dm('reply DONE', 'mid.Y'), { userId: USER, deps: d });
  assert.strictEqual(action.reason, 'unknown_sender');
  assert.deepStrictEqual(d.calls.replied, []);
});

test('lookup returning an empty handle is a failure too: parked, never a silent null-username capture', async () => {
  const d = deps({ findActiveCapture: async () => null,
    lookupUsername: async () => ({ ok: true, username: '  @ ' }) });
  const action = await handleEvent(dm('https://example.com/guide'), { userId: USER, deps: d });
  assert.strictEqual(action.reason, 'unknown_sender');
  assert.strictEqual(d.calls.updated[0][1].needs_user_reason, 'unknown_sender');
});

test('lookup failure on an existing handle-less capture updates it instead of creating a second', async () => {
  const d = deps({ findActiveCapture: async () => liveCapture({ sender_username: null }),
    lookupUsername: async () => ({ ok: false, error: 'http_503' }) });
  const action = await handleEvent(dm('https://example.com/guide'), { userId: USER, deps: d });
  assert.strictEqual(action.reason, 'unknown_sender');
  assert.deepStrictEqual(d.calls.created, []);
  assert.strictEqual(d.calls.updated[0][0], 'cap-1');
});

test('lookup failure after real retries still ends in a parked capture, not a throw', async () => {
  let attempts = 0;
  const failing = async () => { attempts += 1; throw new Error('socket hang up'); };
  const d = deps({ findActiveCapture: async () => null,
    lookupUsername: (igsid) => lookupUsername(igsid, { fetchImpl: failing, token: 't', sleepImpl: async () => {} }) });
  const action = await handleEvent(dm('https://example.com/guide', 'mid.Z'), { userId: USER, deps: d });
  assert.strictEqual(attempts, 3);
  assert.strictEqual(action.reason, 'unknown_sender');
  assert.match(action.error, /socket hang up/);
});

test('an existing capture with no username is backfilled once the lookup works', async () => {
  const d = deps({ findActiveCapture: async () => liveCapture({ sender_username: null }),
    lookupUsername: async () => ({ ok: true, username: 'thecreator' }) });
  await handleEvent(dm('https://example.com/guide'), { userId: USER, deps: d });
  assert.strictEqual(d.calls.updated[0][1].sender_username, 'thecreator');
});

test('lookupUsername retries a transient failure and then succeeds', async () => {
  let n = 0;
  const fetchImpl = async () => (++n === 1
    ? { ok: false, status: 503, json: async () => ({}) }
    : { ok: true, status: 200, json: async () => ({ username: 'TheCreator' }) });
  const slept = [];
  const result = await lookupUsername('igsid-1', { fetchImpl, token: 't', sleepImpl: async (ms) => slept.push(ms) });
  assert.deepStrictEqual(result, { ok: true, username: 'thecreator' });
  assert.strictEqual(n, 2);
  assert.strictEqual(slept.length, 1);
});

test('lookupUsername gives up after its attempts and reports why, without throwing', async () => {
  let n = 0;
  const fetchImpl = async () => { n += 1; throw new Error('socket hang up'); };
  const result = await lookupUsername('igsid-1', { fetchImpl, token: 't', sleepImpl: async () => {} });
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /socket hang up/);
  assert.strictEqual(n, 3);
});

test('lookupUsername does not retry a 4xx', async () => {
  let n = 0;
  const fetchImpl = async () => { n += 1; return { ok: false, status: 400, json: async () => ({ error: { code: 100, message: 'bad' } }) }; };
  const result = await lookupUsername('igsid-1', { fetchImpl, token: 't', sleepImpl: async () => {} });
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /http_400 code=100/);
  assert.strictEqual(n, 1);
});

test('lookupUsername with no token fails without a request', async () => {
  const fetchImpl = async () => { throw new Error('must not be called'); };
  assert.deepStrictEqual(await lookupUsername('igsid-1', { fetchImpl, token: '' }), { ok: false, error: 'no_access_token' });
});

test('lookupUsername sends the token as a header, never in the url', async () => {
  let seen;
  const fetchImpl = async (url, init) => { seen = { url, init }; return { ok: true, json: async () => ({ username: 'a' }) }; };
  await lookupUsername('igsid/1', { fetchImpl, token: 'SECRET' });
  assert.ok(!seen.url.includes('SECRET'));
  assert.strictEqual(seen.init.headers.Authorization, 'Bearer SECRET');
  assert.ok(seen.url.includes('igsid%2F1'), 'the id is encoded into the path');
});

// ─── sendReply ────────────────────────────────────────────────────────────────

test('sendReply posts the recipient and the word, with the token in a header', async () => {
  let seen;
  const fetchImpl = async (url, init) => { seen = { url, init }; return { ok: true, status: 200 }; };
  const result = await sendReply('igsid-1', 'DONE', { fetchImpl, token: 'SECRET' });
  assert.deepStrictEqual(result, { ok: true });
  assert.strictEqual(seen.init.method, 'POST');
  assert.deepStrictEqual(JSON.parse(seen.init.body), { recipient: { id: 'igsid-1' }, message: { text: 'DONE' } });
  assert.strictEqual(seen.init.headers.Authorization, 'Bearer SECRET');
  assert.ok(!seen.url.includes('SECRET'));
});

test('sendReply returns ok:false for a closed messaging window instead of throwing', async () => {
  const fetchImpl = async () => ({ ok: false, status: 400,
    json: async () => ({ error: { code: 10, error_subcode: 2534022, message: 'outside of allowed window' } }) });
  const result = await sendReply('igsid-1', 'DONE', { fetchImpl, token: 'SECRET' });
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /http_400 code=10\/2534022 outside of allowed window/);
  assert.ok(!result.error.includes('SECRET'));
});

test('sendReply returns ok:false when the network throws, and when the body is not JSON', async () => {
  const thrown = await sendReply('igsid-1', 'DONE', { fetchImpl: async () => { throw new Error('ECONNRESET'); }, token: 't' });
  assert.strictEqual(thrown.ok, false);
  assert.match(thrown.error, /ECONNRESET/);
  const notJson = await sendReply('igsid-1', 'DONE', { token: 't',
    fetchImpl: async () => ({ ok: false, status: 502, json: async () => { throw new SyntaxError('x'); } }) });
  assert.deepStrictEqual(notJson, { ok: false, error: 'http_502' });
});

test('sendReply refuses anything that is not an allowlisted word, without a request', async () => {
  const fetchImpl = async () => { throw new Error('must not be called'); };
  for (const text of ['Hello there', 'done', '', undefined, 'DONE please', null]) {
    assert.deepStrictEqual(await sendReply('igsid-1', text, { fetchImpl, token: 't' }), { ok: false, error: 'not_allowlisted' });
  }
});

test('sendReply with no token or no recipient fails without a request', async () => {
  const fetchImpl = async () => { throw new Error('must not be called'); };
  assert.deepStrictEqual(await sendReply('igsid-1', 'DONE', { fetchImpl, token: '' }), { ok: false, error: 'no_access_token' });
  assert.deepStrictEqual(await sendReply('', 'DONE', { fetchImpl, token: 't' }), { ok: false, error: 'no_igsid' });
});

// ─── userId resolution ────────────────────────────────────────────────────────

test('resolveIgUserId prefers IG_USER_ID and falls back to the default user', () => {
  const fallback = () => 'default-user';
  assert.strictEqual(resolveIgUserId({ env: { IG_USER_ID: 'ig-user' }, fallback }), 'ig-user');
  assert.strictEqual(resolveIgUserId({ env: { IG_USER_ID: ' ig-user ' }, fallback }), 'ig-user');
  assert.strictEqual(resolveIgUserId({ env: {}, fallback }), 'default-user');
  assert.strictEqual(resolveIgUserId({ env: { IG_USER_ID: '' }, fallback }), 'default-user');
});

test('resolveIgUserId throws rather than return a falsy id', () => {
  assert.throws(() => resolveIgUserId({ env: {}, fallback: () => { throw new Error('GRIMOIRE_USER_ID is not set'); } }), /GRIMOIRE_USER_ID/);
  assert.throws(() => resolveIgUserId({ env: {}, fallback: () => undefined }), /no user id/);
});

// ─── Re-match after a save ────────────────────────────────────────────────────

function rematchDeps(captures, over = {}) {
  const calls = { attached: [], updated: [], pending: [] };
  return { calls, ...{
    findPendingCaptures: async (u, name) => { calls.pending.push([u, name]); return captures; },
    recentInstagramItems: async () => [reel],
    attachLinkedResource: async (itemId, u, url) => { calls.attached.push([itemId, u, url]); return {}; },
    updateCapture: async (id, patch, u) => { calls.updated.push([id, patch, u]); return {}; },
  }, ...over };
}
const waiting = (over = {}) => ({ id: 'cap-9', sender_username: 'thecreator', state: 'needs_user',
  needs_user_reason: 'no_match', resolved_url: 'https://example.com/guide', ...over });

test('rematch attaches a waiting no_match article once the reel is saved', async () => {
  const d = rematchDeps([waiting()]);
  assert.strictEqual(await rematchPendingCaptures(USER, 'TheCreator', { deps: d }), 1);
  assert.deepStrictEqual(d.calls.attached, [['item-1', USER, 'https://example.com/guide']]);
  assert.deepStrictEqual(d.calls.updated, [['cap-9', { state: 'matched', matched_item_id: 'item-1', needs_user_reason: null }, USER]]);
});

test('rematch leaves alone a capture with no article, and one already matched to an item', async () => {
  const d = rematchDeps([
    waiting({ id: 'a', resolved_url: null }),
    waiting({ id: 'b', resolved_url: '' }),
    waiting({ id: 'c', matched_item_id: 'item-0' }),
  ]);
  assert.strictEqual(await rematchPendingCaptures(USER, 'thecreator', { deps: d }), 0);
  assert.deepStrictEqual(d.calls.attached, []);
});

test('rematch rules on state, not on the reason label: a replied capture still holding its article is found', async () => {
  const d = rematchDeps([
    waiting({ id: 'replied', state: 'replied', needs_user_reason: null }),
    waiting({ id: 'gate', needs_user_reason: 'freeform_gate' }),
    waiting({ id: 'hub', needs_user_reason: 'hub_page' }),
    waiting({ id: 'waiting', state: 'awaiting_link', needs_user_reason: null }),
  ]);
  assert.strictEqual(await rematchPendingCaptures(USER, 'thecreator', { deps: d }), 4);
  assert.deepStrictEqual(d.calls.updated.map(([id]) => id), ['replied', 'gate', 'hub', 'waiting']);
});

test('rematch failures go through the injected sink and name the cause', async () => {
  const errors = [];
  const d = rematchDeps([waiting()], { logError: (m) => errors.push(m),
    attachLinkedResource: async () => { throw 'plain string rejection'; } });
  assert.strictEqual(await rematchPendingCaptures(USER, 'thecreator', { deps: d }), 0);
  assert.strictEqual(errors.length, 1);
  assert.match(errors[0], /rematch failed \(capture cap-9, item item-1\): plain string rejection/);
});

test('rematch skips a capture whose creator still has no recent reel', async () => {
  const d = rematchDeps([waiting({ sender_username: 'someoneelse' })]);
  assert.strictEqual(await rematchPendingCaptures(USER, 'someoneelse', { deps: d }), 0);
});

test('rematch: one capture failing does not stop the next', async () => {
  let n = 0;
  const d = rematchDeps([waiting({ id: 'a' }), waiting({ id: 'b' })], { logError: () => {},
    attachLinkedResource: async () => { if (++n === 1) throw new Error('boom'); return {}; },
  });
  assert.strictEqual(await rematchPendingCaptures(USER, 'thecreator', { deps: d }), 1);
  assert.deepStrictEqual(d.calls.updated.map(([id]) => id), ['b']);
});

test('rematch with no handle does nothing and never queries', async () => {
  const d = rematchDeps([waiting()]);
  assert.strictEqual(await rematchPendingCaptures(USER, null, { deps: d }), 0);
  assert.deepStrictEqual(d.calls.pending, []);
  await assert.rejects(rematchPendingCaptures('', 'x', { deps: d }), /requires a userId/);
});

test('isInstagramUrl is a hostname check', () => {
  assert.strictEqual(isInstagramUrl('https://www.instagram.com/reel/ABC/'), true);
  assert.strictEqual(isInstagramUrl('https://instagram.com/reel/ABC'), true);
  assert.strictEqual(isInstagramUrl('https://example.com/?u=instagram.com'), false);
  assert.strictEqual(isInstagramUrl('https://notinstagram.com/x'), false);
  assert.strictEqual(isInstagramUrl('manual'), false);
  assert.strictEqual(isInstagramUrl(undefined), false);
});

// ─── A parked article survives later messages ─────────────────────────────────

// A tiny in-memory dm_captures row whose writes go through the REAL
// buildCapturePatch, so a key that is undefined is skipped exactly as in
// production and cannot clear a column by accident.
function store(initial) {
  const row = { id: 'cap-1', sender_username: 'thecreator', state: 'needs_user', needs_user_reason: 'no_match',
    reply_attempts: 0, links_seen: [], resolved_url: null, matched_item_id: null, processed_message_ids: [], ...initial };
  const writes = [];
  return { row, writes, fakes: {
    findActiveCapture: async () => row,
    updateCapture: async (id, patch) => { const fields = buildCapturePatch(patch); writes.push(fields); Object.assign(row, fields); return row; },
    recordProcessedMessage: async () => true,
  } };
}
const ARTICLE = 'https://example.com/the-article';

test('a capture holding a parked article keeps it when a link-less gate arrives', async () => {
  const st = store({ resolved_url: ARTICLE, links_seen: [ARTICLE] });
  const d = deps({ ...st.fakes });
  const action = await handleEvent(dm('what is your favourite colour?', 'mid.2'), { userId: USER, deps: d });
  assert.strictEqual(action.reason, 'freeform_gate');
  assert.strictEqual(st.row.resolved_url, ARTICLE, 'the article is still on the row');
  assert.strictEqual(st.row.matched_item_id, null);
});

test('a later hub link neither replaces the parked article nor erases the earlier raw url', async () => {
  const st = store({ resolved_url: ARTICLE, links_seen: [ARTICLE] });
  const d = deps({ ...st.fakes, recentInstagramItems: async () => [],
    resolveUrl: async () => ({ url: 'https://linktr.ee/thecreator', hops: 1 }) });
  const action = await handleEvent(dm('https://mnch.at/abc', 'mid.3'), { userId: USER, deps: d });
  assert.strictEqual(action.reason, 'hub_page');
  assert.strictEqual(st.row.resolved_url, ARTICLE);
  assert.deepStrictEqual(st.row.links_seen, [ARTICLE, 'https://mnch.at/abc']);
});

test('links_seen accumulates across messages and does not duplicate', async () => {
  const st = store();
  const d = deps({ ...st.fakes, recentInstagramItems: async () => [] });
  await handleEvent(dm('https://example.com/one', 'mid.1'), { userId: USER, deps: d });
  await handleEvent(dm('https://example.com/two', 'mid.2'), { userId: USER, deps: d });
  await handleEvent(dm('https://example.com/one', 'mid.3'), { userId: USER, deps: d });
  assert.deepStrictEqual(st.row.links_seen, ['https://example.com/one', 'https://example.com/two']);
  assert.strictEqual(st.row.resolved_url, 'https://example.com/one', 'the latest real article is the one kept');
});

test('a message with no links leaves links_seen untouched', async () => {
  const st = store({ links_seen: [ARTICLE], resolved_url: ARTICLE });
  const d = deps({ ...st.fakes });
  await handleEvent(dm('hello?', 'mid.4'), { userId: USER, deps: d });
  assert.ok(st.writes.every((w) => !('links_seen' in w)));
});

test('unknown_sender parking also merges links_seen and keeps a stored article', async () => {
  const st = store({ resolved_url: ARTICLE, links_seen: [ARTICLE], sender_username: null });
  const d = deps({ ...st.fakes, lookupUsername: async () => ({ ok: false, error: 'http_503' }),
    resolveUrl: async () => ({ url: 'https://linktr.ee/x', hops: 1 }) });
  await handleEvent(dm('https://mnch.at/abc', 'mid.5'), { userId: USER, deps: d });
  assert.strictEqual(st.row.resolved_url, ARTICLE);
  assert.deepStrictEqual(st.row.links_seen, [ARTICLE, 'https://mnch.at/abc']);
});

test('end to end: an article parked, then a successful reply, is still re-matched on the next save', async () => {
  const st = store({ resolved_url: ARTICLE, links_seen: [ARTICLE] });
  const d = deps({ ...st.fakes });
  const action = await handleEvent(dm('reply DONE', 'mid.6'), { userId: USER, deps: d });
  assert.strictEqual(action.kind, 'reply');
  assert.strictEqual(st.row.state, 'replied');
  assert.strictEqual(st.row.needs_user_reason, null, 'the reason label is gone');
  assert.strictEqual(st.row.resolved_url, ARTICLE);
  const r = rematchDeps([st.row], { updateCapture: st.fakes.updateCapture });
  assert.strictEqual(await rematchPendingCaptures(USER, 'thecreator', { deps: r }), 1);
  assert.deepStrictEqual(r.calls.attached, [['item-1', USER, ARTICLE]]);
  assert.strictEqual(st.row.state, 'matched');
});

// ─── Error text and sinks ─────────────────────────────────────────────────────

test('errors fall back to the log sink when no logError is injected', async () => {
  const logs = [];
  const d = deps({ logError: undefined, log: (m) => logs.push(m), findActiveCapture: async () => null,
    lookupUsername: async () => ({ ok: false, error: 'http_503' }) });
  await handleEvent(dm('x', 'mid.9'), { userId: USER, deps: d });
  assert.ok(logs.some((m) => /unknown_sender/.test(m)));
});

test('a non-Error rejection keeps its text instead of "undefined: undefined"', async () => {
  const fromSend = await sendReply('igsid-1', 'DONE', { token: 't', fetchImpl: async () => { throw 'ECONNRESET string'; } });
  assert.deepStrictEqual(fromSend, { ok: false, error: 'ECONNRESET string' });
  const fromLookup = await lookupUsername('igsid-1', { token: 't', attempts: 1, fetchImpl: async () => { throw { code: 'E_ODD' }; } });
  assert.strictEqual(fromLookup.ok, false);
  assert.ok(!/undefined/.test(fromLookup.error), fromLookup.error);
  assert.deepStrictEqual(await sendReply('igsid-1', 'DONE', { token: 't', fetchImpl: async () => { throw undefined; } }),
    { ok: false, error: 'undefined' });
  const d = deps({ attachLinkedResource: async () => { throw 'plain string'; } });
  await handleEvent(dm('https://example.com/guide'), { userId: USER, deps: d });
  assert.match(d.calls.errors[0], /: plain string$/);
});

test('lookupUsername does not retry a 200 whose body is not JSON', async () => {
  let n = 0;
  const fetchImpl = async () => { n += 1; return { ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token <'); } }; };
  const slept = [];
  const result = await lookupUsername('igsid-1', { fetchImpl, token: 't', sleepImpl: async (ms) => slept.push(ms) });
  assert.deepStrictEqual(result, { ok: false, error: 'invalid_json_response' });
  assert.strictEqual(n, 1);
  assert.deepStrictEqual(slept, []);
});
