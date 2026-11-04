const { test } = require('node:test');
const assert = require('node:assert');
const { shortcodeOf } = require('../lib/instagram/reels');

// The library stores one shape and Apify answers with another, so results are
// matched on the shortcode rather than the URL.
test('reads the shortcode from every shape the same post arrives in', () => {
  for (const url of [
    'https://instagram.com/reel/DfQqbIkNxSg',
    'https://www.instagram.com/p/DfQqbIkNxSg/',
    'https://www.instagram.com/reels/DfQqbIkNxSg/',
    'https://instagram.com/tv/DfQqbIkNxSg/',
    'https://instagram.com/reel/DfQqbIkNxSg/?igsh=abc123',
  ]) {
    assert.strictEqual(shortcodeOf(url), 'DfQqbIkNxSg', url);
  }
});

test('keeps hyphens and underscores, which real shortcodes contain', () => {
  assert.strictEqual(shortcodeOf('https://instagram.com/reel/DeJ_gTHs-FB'), 'DeJ_gTHs-FB');
});

test('returns null for anything that is not a post', () => {
  assert.strictEqual(shortcodeOf('https://instagram.com/nick_saraev/'), null);
  assert.strictEqual(shortcodeOf('https://instagram.com/stories/x/123/'), null);
  assert.strictEqual(shortcodeOf('https://example.com/reel/ABC'), null);
  assert.strictEqual(shortcodeOf('not a url'), null);
  assert.strictEqual(shortcodeOf(null), null);
});

// A lookalike host must not pass: instagram.com.evil.test is not Instagram.
test('refuses a lookalike host', () => {
  assert.strictEqual(shortcodeOf('https://instagram.com.evil.test/reel/ABC'), null);
});
