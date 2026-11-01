const { test } = require('node:test');
const assert = require('node:assert');
const {
  alreadyProcessed, normalizeUsername, buildCapturePatch, staleCutoff,
  toTimestamp, isUniqueViolation, NEEDS_USER_REASONS,
} = require('../lib/instagram/captures');

// Review Focus 2: Meta re-delivers on any non-2xx
test('alreadyProcessed is true for a message id already recorded', () => {
  const capture = { processed_message_ids: ['mid.AAA', 'mid.BBB'] };
  assert.strictEqual(alreadyProcessed(capture, 'mid.BBB'), true);
});

test('alreadyProcessed is false for an unseen message id', () => {
  assert.strictEqual(alreadyProcessed({ processed_message_ids: ['mid.AAA'] }, 'mid.ZZZ'), false);
});

test('alreadyProcessed handles a capture with no recorded ids', () => {
  assert.strictEqual(alreadyProcessed({}, 'mid.AAA'), false);
});

test('alreadyProcessed tolerates a null capture and a non-array column', () => {
  assert.strictEqual(alreadyProcessed(null, 'mid.AAA'), false);
  assert.strictEqual(alreadyProcessed({ processed_message_ids: null }, 'mid.AAA'), false);
});

test('normalizeUsername lowercases and strips a leading @', () => {
  assert.strictEqual(normalizeUsername('@Some_Creator '), 'some_creator');
});

test('normalizeUsername returns null for empty or non-string input', () => {
  assert.strictEqual(normalizeUsername(''), null);
  assert.strictEqual(normalizeUsername('@'), null);
  assert.strictEqual(normalizeUsername(undefined), null);
  assert.strictEqual(normalizeUsername(42), null);
});

test('buildCapturePatch keeps allowed fields and normalizes the username', () => {
  const out = buildCapturePatch({ state: 'replied', sender_username: '@Foo', reply_attempts: 1 });
  assert.deepStrictEqual(out, { state: 'replied', sender_username: 'foo', reply_attempts: 1 });
});

test('buildCapturePatch refuses to change identity columns', () => {
  for (const key of ['id', 'user_id', 'created_at', 'sender_igsid', 'processed_message_ids', 'updated_at']) {
    assert.throws(() => buildCapturePatch({ [key]: 'x' }), /not a patchable field/, key);
  }
});

test('buildCapturePatch rejects an unknown state', () => {
  assert.throws(() => buildCapturePatch({ state: 'done' }), /unknown state/);
});

test('buildCapturePatch accepts all five needs_user reasons and null', () => {
  assert.deepStrictEqual(NEEDS_USER_REASONS,
    ['follow_gate', 'freeform_gate', 'hub_page', 'unusable_link', 'no_match']);
  for (const reason of [...NEEDS_USER_REASONS, null]) {
    assert.deepStrictEqual(buildCapturePatch({ needs_user_reason: reason }), { needs_user_reason: reason });
  }
});

test('buildCapturePatch rejects an unknown needs_user_reason', () => {
  assert.throws(() => buildCapturePatch({ needs_user_reason: 'bored' }), /unknown needs_user_reason/);
});

test('buildCapturePatch rejects an empty patch, including one of only undefined values', () => {
  assert.throws(() => buildCapturePatch({}), /at least one field/);
  assert.throws(() => buildCapturePatch({ state: undefined }), /at least one field/);
  assert.throws(() => buildCapturePatch(null), /patch object/);
});

test('buildCapturePatch converts last_message_at to an ISO timestamp', () => {
  const out = buildCapturePatch({ last_message_at: 1767225600000 });
  assert.strictEqual(out.last_message_at, '2026-01-01T00:00:00.000Z');
});

test('toTimestamp accepts epoch ms, ISO strings and Dates, and nulls the rest', () => {
  assert.strictEqual(toTimestamp(0), '1970-01-01T00:00:00.000Z');
  assert.strictEqual(toTimestamp('2026-01-01T00:00:00Z'), '2026-01-01T00:00:00.000Z');
  assert.strictEqual(toTimestamp(new Date('2026-01-01T00:00:00Z')), '2026-01-01T00:00:00.000Z');
  assert.strictEqual(toTimestamp('not a date'), null);
  assert.strictEqual(toTimestamp(undefined), null);
  assert.strictEqual(toTimestamp(null), null);
});

test('staleCutoff subtracts whole days from now', () => {
  const now = new Date('2026-11-08T12:00:00.000Z');
  assert.strictEqual(staleCutoff(now, 7), '2026-11-01T12:00:00.000Z');
});

test('staleCutoff rejects a non-positive or non-numeric window', () => {
  const now = new Date();
  for (const bad of [0, -1, NaN, undefined, '7']) {
    assert.throws(() => staleCutoff(now, bad), /positive olderThanDays/, String(bad));
  }
});

test('isUniqueViolation recognises only Postgres 23505', () => {
  assert.strictEqual(isUniqueViolation({ code: '23505' }), true);
  assert.strictEqual(isUniqueViolation({ code: '23503' }), false);
  assert.strictEqual(isUniqueViolation(null), false);
});
