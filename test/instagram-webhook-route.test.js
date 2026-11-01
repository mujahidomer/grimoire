// The Instagram webhook route, exercised over real HTTP on an ephemeral
// localhost port: no database, no external network. The express.json() line
// below mirrors index.js; if index.js loses its verify hook the route answers
// 403 and logs a wiring error (covered here by the "no rawBody" test).
const { test, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const http = require('node:http');
const express = require('express');
const { verifySignature, messagingEvents, registerInstagramWebhook } = require('../lib/instagram/webhook');

const SECRET = 'route-test-secret';
const TOKEN = 'route-test-verify-token';
const sign = (b, secret = SECRET) => 'sha256=' + crypto.createHmac('sha256', secret).update(b).digest('hex');

let server, base, received, onEvent, logged, realError, realWarn, envBackup;

function request(method, path, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(base + path, { method, headers }, (res) => {
      let text = '';
      res.on('data', (c) => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode, text, headers: res.headers }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

const signedPost = (obj, { secret = SECRET, contentType = 'application/json' } = {}) => {
  const raw = Buffer.from(JSON.stringify(obj));
  return request('POST', '/webhooks/instagram', {
    headers: { 'content-type': contentType, 'x-hub-signature-256': sign(raw, secret) },
    body: raw,
  });
};

const settle = () => new Promise((r) => setTimeout(r, 40));

before(async () => {
  const app = express();
  app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } })); // same as index.js
  registerInstagramWebhook(app, { onEvent: (e) => onEvent(e) });
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise((r) => server.close(r)));

beforeEach(() => {
  envBackup = { s: process.env.IG_APP_SECRET, t: process.env.IG_WEBHOOK_VERIFY_TOKEN };
  process.env.IG_APP_SECRET = SECRET;
  process.env.IG_WEBHOOK_VERIFY_TOKEN = TOKEN;
  received = [];
  logged = [];
  onEvent = async (e) => { received.push(e); };
  realError = console.error; realWarn = console.warn;
  console.error = (...a) => logged.push(a.join(' '));
  console.warn = (...a) => logged.push(a.join(' '));
});
afterEach(() => {
  console.error = realError; console.warn = realWarn;
  for (const [k, v] of [['IG_APP_SECRET', envBackup.s], ['IG_WEBHOOK_VERIFY_TOKEN', envBackup.t]]) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});

// ─── verifySignature: inputs that must reject, never throw ───────────────────

test('verifySignature returns false (does not throw) for malformed headers', () => {
  const body = Buffer.from('{}');
  const good = sign(body);
  const bad = [
    '', 'sha256=', 'sha256=zz', 'sha256=' + 'g'.repeat(64), // not hex
    good.slice(0, -2), good + '00',                          // wrong length
    good.replace('sha256=', 'sha1='), good.replace('sha256=', ''),
    42, null, {}, [good],
  ];
  for (const h of bad) assert.strictEqual(verifySignature(body, h, SECRET), false, String(h));
});

test('verifySignature rejects when the body or the secret is missing', () => {
  const body = Buffer.from('{}');
  assert.strictEqual(verifySignature(undefined, sign(body), SECRET), false);
  assert.strictEqual(verifySignature(body, sign(body), undefined), false);
  // An empty secret is a valid HMAC key; it must not be accepted.
  assert.strictEqual(verifySignature(body, sign(body, ''), ''), false);
});

test('verifySignature rejects a body signed with the wrong secret', () => {
  const body = Buffer.from('{}');
  assert.strictEqual(verifySignature(body, sign(body, 'other-secret'), SECRET), false);
});

// ─── echo filter: shapes the happy-path test does not cover ──────────────────

test('messagingEvents tolerates malformed bodies without throwing', () => {
  for (const b of [null, undefined, 'x', 7, {}, { entry: 'x' }, { entry: [null, 1, {}] },
    { entry: [{ messaging: 'x' }] }, { entry: [{ messaging: [null, 'x', 3] }] }]) {
    assert.deepStrictEqual(messagingEvents(b), []);
  }
});

test('messagingEvents drops an echo whichever entry it arrives in', () => {
  const body = { entry: [
    { messaging: [{ message: { text: 'a' } }] },
    { messaging: [{ message: { is_echo: true, text: 'DONE' } }, { message: { text: 'b' } }] },
    { messaging: [{ message: { is_echo: true, text: 'DONE' } }] },
  ] };
  assert.deepStrictEqual(messagingEvents(body).map((e) => e.message.text), ['a', 'b']);
});

test('messagingEvents treats any truthy is_echo as an echo (fail closed)', () => {
  const body = { entry: [{ messaging: [
    { message: { is_echo: 'true', text: 'x' } }, { message: { is_echo: 1, text: 'y' } },
    { message: { is_echo: false, text: 'kept' } },
  ] }] };
  assert.deepStrictEqual(messagingEvents(body).map((e) => e.message.text), ['kept']);
});

test('messagingEvents keeps events that carry no message (receipts, postbacks)', () => {
  const body = { entry: [{ messaging: [{ read: { mid: '1' } }, { postback: { payload: 'p' } }] }] };
  assert.strictEqual(messagingEvents(body).length, 2);
});

// ─── GET handshake ───────────────────────────────────────────────────────────

test('GET echoes the challenge for a correct subscribe handshake', async () => {
  const r = await request('GET', `/webhooks/instagram?hub.mode=subscribe&hub.verify_token=${TOKEN}&hub.challenge=12345`);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.text, '12345');
  assert.match(r.headers['content-type'], /^text\/plain/);
});

test('GET rejects a wrong token, wrong mode, or missing challenge with 403', async () => {
  for (const q of [
    `hub.mode=subscribe&hub.verify_token=nope&hub.challenge=1`,
    `hub.mode=unsubscribe&hub.verify_token=${TOKEN}&hub.challenge=1`,
    `hub.mode=subscribe&hub.verify_token=${TOKEN}`,
    `hub.mode=subscribe&hub.verify_token=${TOKEN}&hub.verify_token=${TOKEN}&hub.challenge=1`, // array
    ``,
  ]) {
    const r = await request('GET', `/webhooks/instagram?${q}`);
    assert.strictEqual(r.status, 403, q);
  }
});

test('GET with the verify token unset rejects even when the caller sends none', async () => {
  delete process.env.IG_WEBHOOK_VERIFY_TOKEN;
  const r = await request('GET', `/webhooks/instagram?hub.mode=subscribe&hub.challenge=1`);
  assert.strictEqual(r.status, 403);
});

// ─── POST ────────────────────────────────────────────────────────────────────

test('POST with a good signature answers 200 and delivers only inbound events', async () => {
  const r = await signedPost({ object: 'instagram', entry: [{ messaging: [
    { message: { is_echo: true, text: 'DONE' } },
    { message: { text: 'https://example.com/guide' } },
  ] }] });
  assert.strictEqual(r.status, 200);
  await settle();
  assert.deepStrictEqual(received.map((e) => e.message.text), ['https://example.com/guide']);
});

test('POST made only of echoes delivers nothing', async () => {
  const r = await signedPost({ object: 'instagram', entry: [{ messaging: [
    { message: { is_echo: true, text: 'DONE' } },
  ] }] });
  assert.strictEqual(r.status, 200);
  await settle();
  assert.strictEqual(received.length, 0);
});

test('POST with a bad signature is 403 and delivers nothing', async () => {
  const r = await signedPost({ object: 'instagram', entry: [{ messaging: [{ message: { text: 'x' } }] }] }, { secret: 'wrong' });
  assert.strictEqual(r.status, 403);
  await settle();
  assert.strictEqual(received.length, 0);
});

test('POST with no signature header is 403', async () => {
  const raw = Buffer.from(JSON.stringify({ object: 'instagram', entry: [{ messaging: [{ message: { text: 'x' } }] }] }));
  const r = await request('POST', '/webhooks/instagram', { headers: { 'content-type': 'application/json' }, body: raw });
  assert.strictEqual(r.status, 403);
  await settle();
  assert.strictEqual(received.length, 0);
});

test('POST with a malformed signature header is 403, not a 500', async () => {
  const raw = Buffer.from('{"object":"instagram"}');
  for (const h of ['sha256=zz', 'garbage', 'sha256=' + 'a'.repeat(10)]) {
    const r = await request('POST', '/webhooks/instagram', {
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': h }, body: raw });
    assert.strictEqual(r.status, 403, h);
  }
});

test('POST is rejected when IG_APP_SECRET is unset, even with an HMAC keyed by the empty string', async () => {
  delete process.env.IG_APP_SECRET;
  const r = await signedPost({ object: 'instagram', entry: [{ messaging: [{ message: { text: 'x' } }] }] }, { secret: '' });
  assert.strictEqual(r.status, 403);
  await settle();
  assert.strictEqual(received.length, 0);
});

test('POST without a raw body (verify hook missing / non-JSON) is 403 and logs a wiring error', async () => {
  const r = await signedPost({ object: 'instagram' }, { contentType: 'text/plain' });
  assert.strictEqual(r.status, 403);
  assert.ok(logged.some((l) => /rawBody/.test(l)), logged.join('|'));
});

test('POST for a non-instagram object is acknowledged but delivers nothing', async () => {
  const r = await signedPost({ object: 'page', entry: [{ messaging: [{ message: { text: 'x' } }] }] });
  assert.strictEqual(r.status, 200);
  await settle();
  assert.strictEqual(received.length, 0);
});

test('a rejecting onEvent is logged, the response is still 200, and nothing goes unhandled', async () => {
  const unhandled = [];
  const listener = (reason) => unhandled.push(reason);
  process.on('unhandledRejection', listener);
  try {
    onEvent = async () => { throw new Error('boom async'); };
    const r1 = await signedPost({ object: 'instagram', entry: [{ messaging: [{ message: { text: 'x' } }] }] });
    onEvent = () => { throw new Error('boom sync'); };
    const r2 = await signedPost({ object: 'instagram', entry: [{ messaging: [{ message: { text: 'x' } }] }] });
    await settle();
    assert.strictEqual(r1.status, 200);
    assert.strictEqual(r2.status, 200);
    assert.ok(logged.some((l) => l.includes('boom async')));
    assert.ok(logged.some((l) => l.includes('boom sync')));
    assert.deepStrictEqual(unhandled, []);
  } finally {
    process.off('unhandledRejection', listener);
  }
});

test('one failing event does not stop the rest of the batch, and order is kept', async () => {
  const seen = [];
  onEvent = async (e) => { seen.push(e.message.text); if (e.message.text === 'b') throw new Error('x'); };
  await signedPost({ object: 'instagram', entry: [{ messaging: [
    { message: { text: 'a' } }, { message: { text: 'b' } }, { message: { text: 'c' } },
  ] }] });
  await settle();
  assert.deepStrictEqual(seen, ['a', 'b', 'c']);
});

test('the 200 is sent before onEvent finishes', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  let finished = false;
  onEvent = async () => { await gate; finished = true; };
  const r = await signedPost({ object: 'instagram', entry: [{ messaging: [{ message: { text: 'x' } }] }] });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(finished, false);
  release();
  await settle();
  assert.strictEqual(finished, true);
});

test('registerInstagramWebhook refuses to mount without an onEvent function', () => {
  assert.throws(() => registerInstagramWebhook(express(), {}), TypeError);
  assert.throws(() => registerInstagramWebhook(express()), TypeError);
});
