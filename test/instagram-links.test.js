const { test } = require('node:test');
const assert = require('node:assert');
const { extractUrls, isHubPage, pickBestUrl, resolveUrl } = require('../lib/instagram/links');

test('extractUrls finds a url in message text', () => {
  const ev = { message: { text: 'Here you go https://mnch.at/abc123 enjoy' } };
  assert.deepStrictEqual(extractUrls(ev), ['https://mnch.at/abc123']);
});

test('extractUrls finds urls in attachment and quick_reply payloads', () => {
  const ev = { message: {
    text: 'tap below',
    attachments: [{ payload: { url: 'https://example.com/a' } }],
    quick_reply: { payload: 'https://example.com/b' },
  } };
  assert.deepStrictEqual(extractUrls(ev), ['https://example.com/a', 'https://example.com/b']);
});

test('extractUrls returns an empty array for a message with no urls', () => {
  assert.deepStrictEqual(extractUrls({ message: { text: 'reply DONE to get it' } }), []);
});

test('isHubPage flags linktree and instagram profiles', () => {
  assert.strictEqual(isHubPage('https://linktr.ee/someone'), true);
  assert.strictEqual(isHubPage('https://instagram.com/someone'), true);
  assert.strictEqual(isHubPage('https://example.com/the-real-article'), false);
});

// Review Focus 3: several urls in one message
test('pickBestUrl skips the profile link and takes the article', () => {
  const urls = ['https://instagram.com/thecreator', 'https://example.com/guide', 'https://linktr.ee/x'];
  assert.strictEqual(pickBestUrl(urls), 'https://example.com/guide');
});

test('pickBestUrl returns null when every candidate is a hub page', () => {
  assert.strictEqual(pickBestUrl(['https://linktr.ee/x', 'https://instagram.com/y']), null);
});

test('resolveUrl follows a redirect chain to the destination', async () => {
  const fetchImpl = async (u) => ({
    ok: true,
    url: u === 'https://mnch.at/a' ? 'https://example.com/final' : u,
  });
  assert.deepStrictEqual(await resolveUrl('https://mnch.at/a', { fetchImpl }),
    { url: 'https://example.com/final', hops: 1 });
});

test('resolveUrl returns null when the fetch throws', async () => {
  const fetchImpl = async () => { throw new Error('ENOTFOUND'); };
  assert.strictEqual(await resolveUrl('https://mnch.at/a', { fetchImpl }), null);
});
