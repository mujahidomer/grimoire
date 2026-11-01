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
