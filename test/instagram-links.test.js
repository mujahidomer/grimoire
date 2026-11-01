const { test } = require('node:test');
const assert = require('node:assert');
const { extractUrls, isHubPage, isMediaUrl, pickBestUrl, resolveUrl } = require('../lib/instagram/links');

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
const quiet = () => {};
// resolveUrl with DNS and logging stubbed so tests need no network and print nothing.
const resolve = (url, opts = {}) => resolveUrl(url, { lookupImpl: publicLookup, logImpl: quiet, ...opts });
const captureLog = () => { const lines = []; const fn = (m) => lines.push(m); fn.lines = lines; return fn; };
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
  assert.deepStrictEqual(await resolve('https://mnch.at/a', { fetchImpl }),
    { url: 'https://example.com/final', hops: 1 });
});

test('resolveUrl returns null when the fetch throws', async () => {
  const fetchImpl = async () => { throw new Error('ENOTFOUND'); };
  assert.strictEqual(await resolve('https://mnch.at/a', { fetchImpl }), null);
});

// --- hop counting ---

const chain = (n) => {
  const table = {};
  for (let i = 0; i < n; i++) table[`https://s.example/${i}`] = redirectTo(`https://s.example/${i + 1}`);
  table[`https://s.example/${n}`] = finalPage();
  return table;
};

test('resolveUrl counts hops truthfully and allows exactly maxHops', async () => {
  const result = await resolve('https://s.example/0', {
    fetchImpl: fakeFetch(chain(5)),
  });
  assert.deepStrictEqual(result, { url: 'https://s.example/5', hops: 5 });
});

test('resolveUrl returns null once the chain exceeds maxHops', async () => {
  const fetchImpl = fakeFetch(chain(6));
  assert.strictEqual(await resolve('https://s.example/0', { fetchImpl }), null);
  assert.strictEqual(fetchImpl.calls.length, 6, 'stops following at the cap instead of walking the whole chain');
});

test('resolveUrl honours a custom maxHops', async () => {
  assert.strictEqual(await resolve('https://s.example/0', {
    maxHops: 2, fetchImpl: fakeFetch(chain(3)),
  }), null);
  assert.deepStrictEqual(await resolve('https://s.example/0', {
    maxHops: 2, fetchImpl: fakeFetch(chain(2)),
  }), { url: 'https://s.example/2', hops: 2 });
});

test('resolveUrl reports zero hops when the url does not redirect', async () => {
  const fetchImpl = fakeFetch({ 'https://example.com/a': finalPage() });
  assert.deepStrictEqual(await resolve('https://example.com/a', { fetchImpl }),
    { url: 'https://example.com/a', hops: 0 });
});

test('resolveUrl resolves relative and path-absolute Location headers against the current url', async () => {
  const fetchImpl = fakeFetch({
    'https://example.com/a/b': redirectTo('c'),
    'https://example.com/a/c': redirectTo('/d?x=1'),
    'https://example.com/d?x=1': finalPage(),
  });
  assert.deepStrictEqual(await resolve('https://example.com/a/b', { fetchImpl }),
    { url: 'https://example.com/d?x=1', hops: 2 });
});

test('resolveUrl returns null for a redirect with no Location header', async () => {
  const fetchImpl = fakeFetch({ 'https://example.com/a': { ok: false, status: 302, headers: new Headers() } });
  assert.strictEqual(await resolve('https://example.com/a', { fetchImpl }), null);
});

test('resolveUrl returns null when the DNS lookup fails', async () => {
  const lookupImpl = async () => { throw new Error('ENOTFOUND'); };
  const fetchImpl = fakeFetch({});
  assert.strictEqual(await resolve('https://nope.example/a', { fetchImpl, lookupImpl }), null);
  assert.strictEqual(fetchImpl.calls.length, 0);
});

// --- a non-ok destination still tells us what the destination is ---

test('resolveUrl still yields the url, query intact, when the destination answers 403', async () => {
  const fetchImpl = fakeFetch({
    'https://mnch.at/a': redirectTo('https://paywalled.example/story?utm=x'),
    'https://paywalled.example/story?utm=x': finalPage(403),
  });
  assert.deepStrictEqual(await resolve('https://mnch.at/a', { fetchImpl }),
    { url: 'https://paywalled.example/story?utm=x', hops: 1 });
});

// --- SSRF guard ---

const assertRejected = async (url, opts = {}) => {
  const fetchImpl = opts.fetchImpl || fakeFetch({});
  const lookupImpl = opts.lookupImpl || publicLookup;
  assert.strictEqual(await resolve(url, { fetchImpl, lookupImpl }), null, url);
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
    'http://192.0.0.8/', 'http://198.18.0.1/', 'http://198.19.255.255/', // special-use / benchmarking
    'http://224.0.0.1/', 'http://239.255.255.250/', // multicast
    'http://240.0.0.1/', 'http://255.255.255.255/', // reserved / broadcast
    'http://100.64.0.1/', 'http://0.1.2.3/', // CGNAT, 0.0.0.0/8
    'http://[::2]/', 'http://[::7f00:1]/', // ::/96 IPv4-compatible
    'http://[64:ff9b::7f00:1]/', // NAT64 wrapping 127.0.0.1
    'http://[fec0::1]/', 'http://[ff02::1]/', // site-local, multicast
  ]) {
    const fetchImpl = await assertRejected(url);
    assert.strictEqual(fetchImpl.calls.length, 0, `${url} must not be fetched`);
  }
});

test('resolveUrl accepts addresses just outside the blocked ranges', async () => {
  for (const host of ['172.15.0.1', '172.32.0.1', '11.0.0.1', '192.169.0.1', '169.253.0.1', '192.0.1.1', '198.17.255.255', '198.20.0.1', '223.255.255.255', '8.8.8.8']) {
    const fetchImpl = fakeFetch({ [`http://${host}/`]: finalPage() });
    assert.deepStrictEqual(await resolve(`http://${host}/`, { fetchImpl }),
      { url: `http://${host}/`, hops: 0 }, host);
  }
});

test('resolveUrl rejects a hostname whose DNS lookup returns a private address', async () => {
  const lookupImpl = async () => [{ address: '10.1.2.3', family: 4 }];
  const fetchImpl = await assertRejected('https://innocent.example/a', { lookupImpl });
  assert.strictEqual(fetchImpl.calls.length, 0);
});

test('resolveUrl rejects localhost by what it resolves to', async () => {
  const lookupImpl = async () => [{ address: '127.0.0.1', family: 4 }];
  const fetchImpl = await assertRejected('http://localhost/admin', { lookupImpl });
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
  assert.strictEqual(await resolve('https://mnch.at/a', { fetchImpl }), null);
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
  assert.strictEqual(await resolve('https://mnch.at/a', { fetchImpl, lookupImpl }), null);
  assert.deepStrictEqual(fetchImpl.calls, ['https://mnch.at/a', 'https://hop.example/b']);
});

test('resolveUrl rejects a redirect to a non-http scheme', async () => {
  const fetchImpl = fakeFetch({ 'https://mnch.at/a': redirectTo('file:///etc/passwd') });
  assert.strictEqual(await resolve('https://mnch.at/a', { fetchImpl }), null);
});

// --- media CDNs are never the article, but they are not hub pages either ---

test('isMediaUrl flags Instagram and Facebook media CDNs, isHubPage does not', () => {
  const cdn = 'https://scontent-lax3-1.cdninstagram.com/v/t51.2885-15/abc.jpg';
  const fb = 'https://scontent.xx.fbcdn.net/v/t39.30808-6/def.jpg';
  assert.strictEqual(isMediaUrl(cdn), true);
  assert.strictEqual(isMediaUrl(fb), true);
  assert.strictEqual(isHubPage(cdn), false, 'a media file is not a hub page');
  assert.strictEqual(isHubPage(fb), false);
  assert.strictEqual(isMediaUrl('https://fbcdn.net.evil.example/x'), false);
  assert.strictEqual(isMediaUrl('https://example.com/guide'), false);
  assert.strictEqual(isMediaUrl('https://linktr.ee/x'), false);
});

test('pickBestUrl skips media CDN urls', () => {
  const cdn = 'https://scontent-lax3-1.cdninstagram.com/v/t51.2885-15/abc.jpg';
  const fb = 'https://scontent.xx.fbcdn.net/v/t39.30808-6/def.jpg';
  assert.strictEqual(pickBestUrl([cdn, fb]), null);
  assert.strictEqual(pickBestUrl([cdn, 'https://example.com/guide', fb]), 'https://example.com/guide');
});

// --- this module normalizes nothing ---

test('pickBestUrl returns the chosen candidate exactly as given', () => {
  assert.strictEqual(pickBestUrl(['http://www.Example.com/Guide/?utm_source=ig#top']),
    'http://www.Example.com/Guide/?utm_source=ig#top');
});

// The regression: pickBestUrl used to normalize, which stripped the query and
// destroyed a wrapper link's destination before resolveUrl saw it.
test('a wrapper link keeps its query from extractUrls through pickBestUrl to resolveUrl', async () => {
  const wrapper = 'https://l.facebook.com/l.php?u=https%3A%2F%2Fexample.com%2Fthe-article&h=AT0abc';
  const ev = { message: { text: `read this ${wrapper} (via a friend)` } };

  const extracted = extractUrls(ev);
  assert.deepStrictEqual(extracted, [wrapper]);
  const picked = pickBestUrl(extracted);
  assert.strictEqual(picked, wrapper);

  const fetchImpl = fakeFetch({
    [wrapper]: redirectTo('https://example.com/the-article?utm_source=fb'),
    'https://example.com/the-article?utm_source=fb': finalPage(),
  });
  const result = await resolve(picked, { fetchImpl });
  assert.deepStrictEqual(fetchImpl.calls[0], wrapper, 'resolveUrl is handed the full wrapper, query and all');
  assert.deepStrictEqual(result, { url: 'https://example.com/the-article?utm_source=fb', hops: 1 });
});

test('resolveUrl does not force https on the final url', async () => {
  const fetchImpl = fakeFetch({
    'https://short.example/a': redirectTo('http://example.com/x'),
    'http://example.com/x': finalPage(),
  });
  assert.deepStrictEqual(await resolve('https://short.example/a', { fetchImpl }),
    { url: 'http://example.com/x', hops: 1 });
});

// --- trailing punctuation in prose ---

test('extractUrls drops sentence punctuation that follows a url', () => {
  assert.deepStrictEqual(extractUrls({ message: { text: 'Read https://example.com/guide. Then reply.' } }),
    ['https://example.com/guide']);
  assert.deepStrictEqual(extractUrls({ message: { text: 'Is it https://example.com/guide?' } }),
    ['https://example.com/guide']);
  assert.deepStrictEqual(extractUrls({ message: { text: 'links: https://example.com/a, https://example.com/b; done' } }),
    ['https://example.com/a', 'https://example.com/b']);
});

test('extractUrls drops the stray closing paren of "(see <url>)" but keeps a balanced one', () => {
  assert.deepStrictEqual(extractUrls({ message: { text: 'here (see https://example.com/guide) ok' } }),
    ['https://example.com/guide']);
  assert.deepStrictEqual(extractUrls({ message: { text: 'here (see https://example.com/guide).' } }),
    ['https://example.com/guide']);
});

test('extractUrls keeps a Wikipedia-style parenthesised path intact', () => {
  assert.deepStrictEqual(extractUrls({ message: { text: 'try https://en.wikipedia.org/wiki/Foo_(bar) now' } }),
    ['https://en.wikipedia.org/wiki/Foo_(bar)']);
  assert.deepStrictEqual(extractUrls({ message: { text: '(https://en.wikipedia.org/wiki/Foo_(bar)).' } }),
    ['https://en.wikipedia.org/wiki/Foo_(bar)']);
});

// --- maxHops validation ---

test('resolveUrl falls back to 5 hops when maxHops is not a non-negative integer', async () => {
  for (const bad of [NaN, -1, 1.5, '3', Infinity, null]) {
    assert.strictEqual(await resolve('https://s.example/0', { maxHops: bad, fetchImpl: fakeFetch(chain(6)) }),
      null, `maxHops=${String(bad)} still caps at 5`);
    assert.deepStrictEqual(await resolve('https://s.example/0', { maxHops: bad, fetchImpl: fakeFetch(chain(5)) }),
      { url: 'https://s.example/5', hops: 5 }, `maxHops=${String(bad)} still allows 5`);
  }
});

test('resolveUrl with maxHops 0 refuses any redirect but accepts a direct hit', async () => {
  assert.strictEqual(await resolve('https://s.example/0', { maxHops: 0, fetchImpl: fakeFetch(chain(1)) }), null);
  assert.deepStrictEqual(await resolve('https://s.example/0', { maxHops: 0, fetchImpl: fakeFetch(chain(0)) }),
    { url: 'https://s.example/0', hops: 0 });
});

// --- ports ---

test('resolveUrl refuses ports other than 80 and 443, on the first url and on a redirect', async () => {
  for (const url of ['http://example.com:8080/', 'https://example.com:22/', 'http://example.com:6379/', 'https://example.com:8443/x']) {
    const fetchImpl = await assertRejected(url);
    assert.strictEqual(fetchImpl.calls.length, 0, url);
  }
  const logImpl = captureLog();
  const fetchImpl = fakeFetch({ 'https://mnch.at/a': redirectTo('http://example.com:9200/_cat') });
  assert.strictEqual(await resolve('https://mnch.at/a', { fetchImpl, logImpl }), null);
  assert.deepStrictEqual(fetchImpl.calls, ['https://mnch.at/a']);
  assert.match(logImpl.lines[0], /port 9200 is not 80 or 443/);
});

test('resolveUrl allows explicit and implicit default ports', async () => {
  for (const url of ['http://example.com:80/x', 'https://example.com:443/x', 'http://example.com/x']) {
    const fetchImpl = fakeFetch({ [url]: finalPage() });
    assert.deepStrictEqual(await resolve(url, { fetchImpl }), { url, hops: 0 }, url);
  }
});

// --- failures are never silent ---

test('resolveUrl logs the rule, the url and the hop when the guard refuses', async () => {
  const logImpl = captureLog();
  const fetchImpl = fakeFetch({ 'https://mnch.at/a': redirectTo('http://169.254.169.254/latest') });
  assert.strictEqual(await resolve('https://mnch.at/a', { fetchImpl, logImpl }), null);
  assert.strictEqual(logImpl.lines.length, 1);
  assert.strictEqual(logImpl.lines[0],
    '[instagram:links] refused to fetch "http://169.254.169.254/latest": ip literal 169.254.169.254 is internal or unspecified (hop 1)');
});

test('resolveUrl logs hop-cap exhaustion', async () => {
  const logImpl = captureLog();
  assert.strictEqual(await resolve('https://s.example/0', { fetchImpl: fakeFetch(chain(6)), logImpl }), null);
  assert.strictEqual(logImpl.lines.length, 1);
  assert.match(logImpl.lines[0], /^\[instagram:links\] gave up after 5 hops, still redirecting from "https:\/\/s\.example\/5" to "https:\/\/s\.example\/6"$/);
});

test('resolveUrl logs a redirect with no Location', async () => {
  const logImpl = captureLog();
  const fetchImpl = fakeFetch({ 'https://example.com/a': { ok: false, status: 302, headers: new Headers() } });
  assert.strictEqual(await resolve('https://example.com/a', { fetchImpl, logImpl }), null);
  assert.match(logImpl.lines.join('\n'), /redirect 302 with no Location from "https:\/\/example\.com\/a" \(hop 0\)/);
});

test('resolveUrl logs a thrown fetch, a lookup failure, a timeout and a malformed Location with name and message', async () => {
  const cases = [
    ['fetch throws', { fetchImpl: async () => { throw new TypeError('fetch failed'); } }, /TypeError: fetch failed/],
    ['lookup fails', { lookupImpl: async () => { throw Object.assign(new Error('getaddrinfo ENOTFOUND x'), { name: 'Error' }); }, fetchImpl: fakeFetch({}) }, /Error: getaddrinfo ENOTFOUND x/],
    ['timeout', { fetchImpl: async () => { throw new DOMException('The operation was aborted due to timeout', 'TimeoutError'); } }, /TimeoutError: The operation was aborted due to timeout/],
    ['malformed Location', { fetchImpl: fakeFetch({ 'https://example.com/a': redirectTo('http://[bad') }) }, /TypeError: Invalid URL/],
  ];
  for (const [label, opts, pattern] of cases) {
    const logImpl = captureLog();
    assert.strictEqual(await resolve('https://example.com/a', { ...opts, logImpl }), null, label);
    assert.strictEqual(logImpl.lines.length, 1, label);
    assert.match(logImpl.lines[0], /^\[instagram:links\] failed resolving "https:\/\/example\.com\/a" \(hop \d\): /, label);
    assert.match(logImpl.lines[0], pattern, label);
  }
});

test('resolveUrl logs and returns null when fetch resolves to nothing', async () => {
  const logImpl = captureLog();
  assert.strictEqual(await resolve('https://example.com/a', { fetchImpl: async () => undefined, logImpl }), null);
  assert.match(logImpl.lines[0], /no response fetching "https:\/\/example\.com\/a"/);
});

test('resolveUrl truncates and quotes a hostile url in the log', async () => {
  const logImpl = captureLog();
  const hostile = `ftp://x/${'a'.repeat(1000)}\nforged line`;
  assert.strictEqual(await resolve(hostile, { fetchImpl: fakeFetch({}), logImpl }), null);
  assert.strictEqual(logImpl.lines.length, 1);
  assert.ok(!logImpl.lines[0].includes('\n'), 'no raw newline reaches the log');
  assert.ok(logImpl.lines[0].length < 450);
});
