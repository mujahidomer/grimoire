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

// Test doubles for resolveUrl. Under redirect:'manual' a redirect is a 3xx
// response with a Location header, so the fake fetch speaks that.
const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];
const redirectTo = (location, status = 301) => ({
  ok: false, status, headers: new Headers({ location }),
});
const finalPage = (status = 200) => ({ ok: status < 400, status, headers: new Headers() });
// A fake fetch over a { url: response } table that records every URL requested.
const fakeFetch = (table) => {
  const calls = [];
  const fn = async (u) => {
    calls.push(u);
    if (!(u in table)) throw new Error(`unexpected fetch ${u}`);
    return table[u];
  };
  fn.calls = calls;
  return fn;
};

test('resolveUrl follows a redirect chain to the destination', async () => {
  const fetchImpl = fakeFetch({
    'https://mnch.at/a': redirectTo('https://example.com/final'),
    'https://example.com/final': finalPage(),
  });
  assert.deepStrictEqual(await resolveUrl('https://mnch.at/a', { fetchImpl, lookupImpl: publicLookup }),
    { url: 'https://example.com/final', hops: 1 });
});

test('resolveUrl returns null when the fetch throws', async () => {
  const fetchImpl = async () => { throw new Error('ENOTFOUND'); };
  assert.strictEqual(await resolveUrl('https://mnch.at/a', { fetchImpl, lookupImpl: publicLookup }), null);
});

// --- hop counting ---

const chain = (n) => {
  const table = {};
  for (let i = 0; i < n; i++) table[`https://s.example/${i}`] = redirectTo(`https://s.example/${i + 1}`);
  table[`https://s.example/${n}`] = finalPage();
  return table;
};

test('resolveUrl counts hops truthfully and allows exactly maxHops', async () => {
  const result = await resolveUrl('https://s.example/0', {
    fetchImpl: fakeFetch(chain(5)), lookupImpl: publicLookup,
  });
  assert.deepStrictEqual(result, { url: 'https://s.example/5', hops: 5 });
});

test('resolveUrl returns null once the chain exceeds maxHops', async () => {
  const fetchImpl = fakeFetch(chain(6));
  assert.strictEqual(await resolveUrl('https://s.example/0', { fetchImpl, lookupImpl: publicLookup }), null);
  assert.strictEqual(fetchImpl.calls.length, 6, 'stops following at the cap instead of walking the whole chain');
});

test('resolveUrl honours a custom maxHops', async () => {
  assert.strictEqual(await resolveUrl('https://s.example/0', {
    maxHops: 2, fetchImpl: fakeFetch(chain(3)), lookupImpl: publicLookup,
  }), null);
  assert.deepStrictEqual(await resolveUrl('https://s.example/0', {
    maxHops: 2, fetchImpl: fakeFetch(chain(2)), lookupImpl: publicLookup,
  }), { url: 'https://s.example/2', hops: 2 });
});

test('resolveUrl reports zero hops when the url does not redirect', async () => {
  const fetchImpl = fakeFetch({ 'https://example.com/a': finalPage() });
  assert.deepStrictEqual(await resolveUrl('https://example.com/a', { fetchImpl, lookupImpl: publicLookup }),
    { url: 'https://example.com/a', hops: 0 });
});

test('resolveUrl resolves relative and path-absolute Location headers against the current url', async () => {
  const fetchImpl = fakeFetch({
    'https://example.com/a/b': redirectTo('c'),
    'https://example.com/a/c': redirectTo('/d?x=1'),
    'https://example.com/d?x=1': finalPage(),
  });
  assert.deepStrictEqual(await resolveUrl('https://example.com/a/b', { fetchImpl, lookupImpl: publicLookup }),
    { url: 'https://example.com/d', hops: 2 });
});

test('resolveUrl returns null for a redirect with no Location header', async () => {
  const fetchImpl = fakeFetch({ 'https://example.com/a': { ok: false, status: 302, headers: new Headers() } });
  assert.strictEqual(await resolveUrl('https://example.com/a', { fetchImpl, lookupImpl: publicLookup }), null);
});

test('resolveUrl returns null when the DNS lookup fails', async () => {
  const lookupImpl = async () => { throw new Error('ENOTFOUND'); };
  const fetchImpl = fakeFetch({});
  assert.strictEqual(await resolveUrl('https://nope.example/a', { fetchImpl, lookupImpl }), null);
  assert.strictEqual(fetchImpl.calls.length, 0);
});

// --- a non-ok destination still tells us what the destination is ---

test('resolveUrl still yields the url when the destination answers 403', async () => {
  const fetchImpl = fakeFetch({
    'https://mnch.at/a': redirectTo('https://paywalled.example/story?utm=x'),
    'https://paywalled.example/story?utm=x': finalPage(403),
  });
  assert.deepStrictEqual(await resolveUrl('https://mnch.at/a', { fetchImpl, lookupImpl: publicLookup }),
    { url: 'https://paywalled.example/story', hops: 1 });
});

// --- SSRF guard ---

const assertRejected = async (url, opts = {}) => {
  const fetchImpl = opts.fetchImpl || fakeFetch({});
  const lookupImpl = opts.lookupImpl || publicLookup;
  assert.strictEqual(await resolveUrl(url, { fetchImpl, lookupImpl }), null, url);
  return fetchImpl;
};

test('resolveUrl rejects loopback, private, link-local, unique-local and unspecified IP literals without fetching', async () => {
  for (const url of [
    'http://127.0.0.1/', 'http://127.1.2.3/x', 'http://[::1]/',
    'http://10.0.0.5/', 'http://172.16.0.1/', 'http://172.31.255.255/', 'http://192.168.1.1/',
    'http://169.254.169.254/latest/meta-data/', 'http://[fe80::1]/',
    'http://[fd12:3456::1]/', 'http://[fc00::1]/',
    'http://0.0.0.0/', 'http://[::]/',
    'http://2130706433/', // decimal form of 127.0.0.1
    'http://[::ffff:127.0.0.1]/', // IPv4-mapped IPv6
  ]) {
    const fetchImpl = await assertRejected(url);
    assert.strictEqual(fetchImpl.calls.length, 0, `${url} must not be fetched`);
  }
});

test('resolveUrl accepts addresses just outside the blocked ranges', async () => {
  for (const host of ['172.15.0.1', '172.32.0.1', '11.0.0.1', '192.169.0.1', '169.253.0.1']) {
    const fetchImpl = fakeFetch({ [`http://${host}/`]: finalPage() });
    assert.deepStrictEqual(await resolveUrl(`http://${host}/`, { fetchImpl, lookupImpl: publicLookup }),
      { url: `https://${host}`, hops: 0 }, host);
  }
});

test('resolveUrl rejects a hostname whose DNS lookup returns a private address', async () => {
  const lookupImpl = async () => [{ address: '10.1.2.3', family: 4 }];
  const fetchImpl = await assertRejected('https://innocent.example/a', { lookupImpl });
  assert.strictEqual(fetchImpl.calls.length, 0);
});

test('resolveUrl rejects localhost by what it resolves to', async () => {
  const lookupImpl = async () => [{ address: '127.0.0.1', family: 4 }];
  const fetchImpl = await assertRejected('http://localhost:3000/admin', { lookupImpl });
  assert.strictEqual(fetchImpl.calls.length, 0);
});

test('resolveUrl rejects when ANY resolved address is private, not only the first', async () => {
  const lookupImpl = async () => [
    { address: '93.184.216.34', family: 4 },
    { address: '169.254.169.254', family: 4 },
  ];
  const fetchImpl = await assertRejected('https://dual.example/a', { lookupImpl });
  assert.strictEqual(fetchImpl.calls.length, 0);
  const v6 = async () => [{ address: '93.184.216.34', family: 4 }, { address: 'fd12::1', family: 6 }];
  await assertRejected('https://dual6.example/a', { lookupImpl: v6 });
});

test('resolveUrl rejects non-http schemes', async () => {
  for (const url of ['file:///etc/passwd', 'ftp://example.com/a', 'gopher://example.com/', 'javascript:alert(1)', 'data:text/html,hi', 'not a url']) {
    const fetchImpl = await assertRejected(url);
    assert.strictEqual(fetchImpl.calls.length, 0, url);
  }
});

test('resolveUrl guards the destination of a redirect, not just the first url', async () => {
  const fetchImpl = fakeFetch({
    'https://mnch.at/a': redirectTo('http://169.254.169.254/latest/meta-data/'),
  });
  assert.strictEqual(await resolveUrl('https://mnch.at/a', { fetchImpl, lookupImpl: publicLookup }), null);
  assert.deepStrictEqual(fetchImpl.calls, ['https://mnch.at/a'], 'the metadata url is never requested');
});

test('resolveUrl guards a redirect to a hostname that resolves privately, mid-chain', async () => {
  const lookupImpl = async (host) => host === 'internal.example'
    ? [{ address: '10.0.0.9', family: 4 }]
    : [{ address: '93.184.216.34', family: 4 }];
  const fetchImpl = fakeFetch({
    'https://mnch.at/a': redirectTo('https://hop.example/b'),
    'https://hop.example/b': redirectTo('https://internal.example/secret'),
  });
  assert.strictEqual(await resolveUrl('https://mnch.at/a', { fetchImpl, lookupImpl }), null);
  assert.deepStrictEqual(fetchImpl.calls, ['https://mnch.at/a', 'https://hop.example/b']);
});

test('resolveUrl rejects a redirect to a non-http scheme', async () => {
  const fetchImpl = fakeFetch({ 'https://mnch.at/a': redirectTo('file:///etc/passwd') });
  assert.strictEqual(await resolveUrl('https://mnch.at/a', { fetchImpl, lookupImpl: publicLookup }), null);
});

// --- media CDNs are never the article ---

test('isHubPage and pickBestUrl treat Instagram and Facebook media CDNs as non-articles', () => {
  const cdn = 'https://scontent-lax3-1.cdninstagram.com/v/t51.2885-15/abc.jpg';
  const fb = 'https://scontent.xx.fbcdn.net/v/t39.30808-6/def.jpg';
  assert.strictEqual(isHubPage(cdn), true);
  assert.strictEqual(isHubPage(fb), true);
  assert.strictEqual(isHubPage('https://fbcdn.net.evil.example/x'), false);
  assert.strictEqual(pickBestUrl([cdn, fb]), null);
  assert.strictEqual(pickBestUrl([cdn, 'https://example.com/guide', fb]), 'https://example.com/guide');
});
