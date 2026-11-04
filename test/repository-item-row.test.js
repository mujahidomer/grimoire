// test/repository-item-row.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { toItemRow } = require('../lib/repository');

const USER = '00000000-0000-0000-0000-000000000001';

test('toItemRow maps source_author through', () => {
  const row = toItemRow({ source_url: 'https://instagram.com/reel/ABC', source_author: 'thecreator' }, USER, 'web');
  assert.strictEqual(row.source_author, 'thecreator');
});

test('toItemRow accepts the legacy author key', () => {
  const row = toItemRow({ source_url: 'https://x.com/a/status/1', author: 'someone' }, USER, 'web');
  assert.strictEqual(row.source_author, 'someone');
});

test('toItemRow leaves source_author null when absent', () => {
  const row = toItemRow({ source_url: 'https://example.com/a' }, USER, 'web');
  assert.strictEqual(row.source_author, null);
});

const { keepStoredSourceAuthor } = require('../lib/repository');

test('an upsert with no author preserves the stored source_author', () => {
  const row = toItemRow({ source_url: 'https://instagram.com/reel/ABC' }, USER, 'web');
  assert.strictEqual(row.source_author, null);
  keepStoredSourceAuthor(row, { category_manually_set: false, source_author: 'thecreator' });
  // Absent from the write entirely, so the upsert leaves the column untouched.
  assert.strictEqual('source_author' in row, false);
});

test('a non-empty incoming author overwrites the stored source_author', () => {
  const row = toItemRow({ source_url: 'https://instagram.com/reel/ABC', source_author: 'corrected' }, USER, 'web');
  keepStoredSourceAuthor(row, { category_manually_set: false, source_author: 'thecreator' });
  assert.strictEqual(row.source_author, 'corrected');
});

test('with no existing row or stored author, the null stays in the write', () => {
  const a = toItemRow({ source_url: 'https://example.com/a' }, USER, 'web');
  keepStoredSourceAuthor(a, null);
  assert.strictEqual(a.source_author, null);
  const b = toItemRow({ source_url: 'https://example.com/b' }, USER, 'web');
  keepStoredSourceAuthor(b, { category_manually_set: false, source_author: null });
  assert.strictEqual(b.source_author, null);
});
