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

test('buildCapturePatch accepts all eight needs_user reasons and null', () => {
  assert.deepStrictEqual(NEEDS_USER_REASONS,
    ['follow_gate', 'freeform_gate', 'hub_page', 'unusable_link', 'no_match', 'reply_failed', 'unknown_sender',
      'reply_exhausted']);
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

// The tenant guard: dm_captures holds every user's conversations and the
// service-role client bypasses RLS, so a missing userId must throw before any
// query is built. The guard runs before getSupabase(), so no database is needed.
test('every query function refuses a falsy userId', async () => {
  const c = require('../lib/instagram/captures');
  const calls = {
    findActiveCapture: (u) => c.findActiveCapture(u, 'igsid-1'),
    createCapture: (u) => c.createCapture(u, { senderIgsid: 'igsid-1' }),
    updateCapture: (u) => c.updateCapture('cap-1', { state: 'matched' }, u),
    findPendingCaptures: (u) => c.findPendingCaptures(u, 'someone'),
    findRecentlyMatchedCapture: (u) => c.findRecentlyMatchedCapture(u, 'igsid-1'),
    expireStaleCaptures: (u) => c.expireStaleCaptures(u),
    recordProcessedMessage: (u) => c.recordProcessedMessage('cap-1', 'mid.AAA', u),
  };
  for (const [name, call] of Object.entries(calls)) {
    for (const bad of [null, undefined, '']) {
      await assert.rejects(() => call(bad), /requires a userId/, `${name}(${JSON.stringify(bad)})`);
    }
  }
});

test('ACTIVE_STATES is the one list of live states, exported', () => {
  const { ACTIVE_STATES } = require('../lib/instagram/captures');
  assert.deepStrictEqual([...ACTIVE_STATES].sort(), ['awaiting_link', 'needs_user', 'replied']);
});

test('toUpdateError turns the one-active-capture violation into a named error', () => {
  const { toUpdateError, CaptureConflictError } = require('../lib/instagram/captures');
  const raw = { code: '23505', message: 'duplicate key value violates unique constraint "dm_captures_one_active_idx"' };
  const err = toUpdateError(raw);
  assert.ok(err instanceof CaptureConflictError);
  assert.strictEqual(err.code, 'active_capture_exists');
  assert.doesNotMatch(err.message, /duplicate key/);
});

test('toUpdateError leaves any other database error as a plain failure', () => {
  const { toUpdateError, CaptureConflictError } = require('../lib/instagram/captures');
  const err = toUpdateError({ code: '23503', message: 'foreign key violation' });
  assert.ok(!(err instanceof CaptureConflictError));
  assert.match(err.message, /updateCapture failed: foreign key violation/);
});
