// The "needs you" tray routes over real HTTP on an ephemeral port, with fake
// deps (no database). Auth is the real requireAuth via the dev fallback header.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const express = require('express');
const { registerDmCaptureRoutes } = require('../lib/routes');

const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const CAP = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ITEM = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

let server, base, calls, rows, items, envBackup;

function request(method, path, { user = ME, body } = {}) {
  return new Promise((resolve, reject) => {
    const headers = { 'content-type': 'application/json' };
    if (user) headers['x-user-id'] = user;
    const req = http.request(base + path, { method, headers }, (res) => {
      let text = '';
      res.on('data', (c) => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode, json: text ? JSON.parse(text) : null }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(JSON.stringify(body));
    req.end();
  });
}

const deps = {
  expireStaleCaptures: async (u) => { calls.push(['expire', u]); },
  listNeedsUserCaptures: async (u) => {
    calls.push(['list', u]);
    return rows.filter((r) => r.user_id === u && r.state === 'needs_user');
  },
  findCaptureById: async (id, u) => rows.find((r) => r.id === id && r.user_id === u) || null,
  updateCapture: async (id, patch, u) => { calls.push(['update', id, patch, u]); return {}; },
  getItemById: async (id, u) => items.find((i) => i.id === id && i.user_id === u) || null,
  attachLinkedResource: async (itemId, u, url) => {
    calls.push(['attach', itemId, u, url]);
    return { linked_resources: [{ source_url: url }] };
  },
};

before(async () => {
  const app = express();
  app.use(express.json());
  registerDmCaptureRoutes(app, deps);
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  envBackup = process.env.ALLOW_DEV_USER_FALLBACK;
  process.env.ALLOW_DEV_USER_FALLBACK = 'true';
});
after(() => {
  if (envBackup === undefined) delete process.env.ALLOW_DEV_USER_FALLBACK;
  else process.env.ALLOW_DEV_USER_FALLBACK = envBackup;
  return new Promise((r) => server.close(r));
});
beforeEach(() => {
  calls = [];
  rows = [
    { id: CAP, user_id: ME, state: 'needs_user', needs_user_reason: 'no_match', sender_username: 'creator',
      resolved_url: 'https://example.com/a', links_seen: ['https://l.instagram.com/x'],
      last_message_at: '2026-11-01T10:00:00Z', sender_igsid: 'secret-igsid', processed_message_ids: ['m1'] },
    { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', user_id: OTHER, state: 'needs_user',
      needs_user_reason: 'follow_gate', sender_username: 'theirs', resolved_url: null, links_seen: [] },
  ];
  items = [{ id: ITEM, user_id: ME }];
});

test('GET lists only the caller\'s parked captures, expiring first, without internals', async () => {
  const res = await request('GET', '/api/dm-captures');
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(calls.map((c) => c[0]), ['expire', 'list']);
  assert.deepStrictEqual(calls.map((c) => c[1]), [ME, ME]);
  assert.strictEqual(res.json.captures.length, 1);
  assert.deepStrictEqual(Object.keys(res.json.captures[0]).sort(),
    ['id', 'last_message_at', 'links_seen', 'needs_user_reason', 'resolved_url', 'sender_username']);
  assert.strictEqual(res.json.captures[0].sender_username, 'creator');
});

test('GET keeps unknown_sender rows that have no username', async () => {
  rows.push({ id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', user_id: ME, state: 'needs_user',
    needs_user_reason: 'unknown_sender', sender_username: null, resolved_url: null });
  const res = await request('GET', '/api/dm-captures');
  const unknown = res.json.captures.find((c) => c.needs_user_reason === 'unknown_sender');
  assert.ok(unknown);
  assert.strictEqual(unknown.sender_username, null);
  assert.deepStrictEqual(unknown.links_seen, []);
});

test('GET still lists when the expiry sweep fails', async () => {
  const orig = deps.expireStaleCaptures;
  deps.expireStaleCaptures = async () => { throw new Error('boom'); };
  const realErr = console.error; console.error = () => {};
  try {
    const res = await request('GET', '/api/dm-captures');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.json.captures.length, 1);
  } finally { deps.expireStaleCaptures = orig; console.error = realErr; }
});

test('both routes refuse an unauthenticated caller', async () => {
  const saved = process.env.ALLOW_DEV_USER_FALLBACK;
  process.env.ALLOW_DEV_USER_FALLBACK = 'false';
  try {
    assert.strictEqual((await request('GET', '/api/dm-captures', { user: null })).status, 401);
    assert.strictEqual((await request('POST', `/api/dm-captures/${CAP}/attach`,
      { user: null, body: { itemId: ITEM } })).status, 401);
    assert.strictEqual(calls.length, 0);
  } finally { process.env.ALLOW_DEV_USER_FALLBACK = saved; }
});

test('attach links the stored article, then marks the capture matched', async () => {
  const res = await request('POST', `/api/dm-captures/${CAP}/attach`, { body: { itemId: ITEM } });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.json.success, true);
  assert.deepStrictEqual(calls, [
    ['attach', ITEM, ME, 'https://example.com/a'],
    ['update', CAP, { state: 'matched', matched_item_id: ITEM, needs_user_reason: null }, ME],
  ]);
});

test('attach: someone else\'s capture is a 404 and does nothing', async () => {
  const res = await request('POST', `/api/dm-captures/${CAP}/attach`, { user: OTHER, body: { itemId: ITEM } });
  assert.strictEqual(res.status, 404);
  assert.strictEqual(calls.length, 0);
});

test('attach: an item that is not the caller\'s is a 404 and does nothing', async () => {
  items = [{ id: ITEM, user_id: OTHER }];
  const res = await request('POST', `/api/dm-captures/${CAP}/attach`, { body: { itemId: ITEM } });
  assert.strictEqual(res.status, 404);
  assert.strictEqual(res.json.error, 'item_not_found');
  assert.strictEqual(calls.length, 0);
});

test('attach: a capture with no article is a 409', async () => {
  rows[0].resolved_url = null;
  const res = await request('POST', `/api/dm-captures/${CAP}/attach`, { body: { itemId: ITEM } });
  assert.strictEqual(res.status, 409);
  assert.strictEqual(res.json.error, 'no_article');
  assert.strictEqual(calls.length, 0);
});

test('attach: a capture that is no longer parked is a 409', async () => {
  rows[0].state = 'matched';
  const res = await request('POST', `/api/dm-captures/${CAP}/attach`, { body: { itemId: ITEM } });
  assert.strictEqual(res.status, 409);
  assert.strictEqual(calls.length, 0);
});

test('attach: malformed ids and a missing itemId are rejected before any query', async () => {
  assert.strictEqual((await request('POST', `/api/dm-captures/${CAP}/attach`, { body: {} })).status, 400);
  assert.strictEqual((await request('POST', `/api/dm-captures/${CAP}/attach`, { body: { itemId: 'nope' } })).status, 400);
  assert.strictEqual((await request('POST', '/api/dm-captures/not-a-uuid/attach', { body: { itemId: ITEM } })).status, 404);
  assert.strictEqual(calls.length, 0);
});

test('attach: a failing attach leaves the capture parked and reports 500', async () => {
  const orig = deps.attachLinkedResource;
  deps.attachLinkedResource = async () => { const e = new Error('upstream'); e.status = 401; throw e; };
  try {
    const res = await request('POST', `/api/dm-captures/${CAP}/attach`, { body: { itemId: ITEM } });
    assert.strictEqual(res.status, 500);
    assert.ok(!calls.some((c) => c[0] === 'update'));
  } finally { deps.attachLinkedResource = orig; }
});
