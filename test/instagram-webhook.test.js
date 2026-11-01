const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const { verifySignature, isEcho, messagingEvents } = require('../lib/instagram/webhook');

const SECRET = 'test-app-secret';
const sign = (b) => 'sha256=' + crypto.createHmac('sha256', SECRET).update(b).digest('hex');

test('verifySignature accepts a correctly signed body', () => {
  const body = Buffer.from(JSON.stringify({ object: 'instagram' }));
  assert.strictEqual(verifySignature(body, sign(body), SECRET), true);
});

test('verifySignature rejects a tampered body', () => {
  const body = Buffer.from(JSON.stringify({ object: 'instagram' }));
  const header = sign(body);
  assert.strictEqual(verifySignature(Buffer.from('{"object":"evil"}'), header, SECRET), false);
});

test('verifySignature rejects a missing header', () => {
  assert.strictEqual(verifySignature(Buffer.from('{}'), undefined, SECRET), false);
});

// Review Focus 1: our own reply comes back as an event
test('isEcho is true for our own outgoing message', () => {
  assert.strictEqual(isEcho({ message: { is_echo: true, text: 'DONE' } }), true);
});

test('isEcho is false for an inbound message', () => {
  assert.strictEqual(isEcho({ message: { text: 'here is your link' } }), false);
});

test('messagingEvents drops echoes so a reply cannot retrigger itself', () => {
  const body = { object: 'instagram', entry: [{ messaging: [
    { message: { is_echo: true, text: 'DONE' } },
    { message: { text: 'https://example.com/guide' } },
  ] }] };
  const events = messagingEvents(body);
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].message.text, 'https://example.com/guide');
});

test('messagingEvents returns an empty array for a body with no entries', () => {
  assert.deepStrictEqual(messagingEvents({ object: 'instagram' }), []);
});
