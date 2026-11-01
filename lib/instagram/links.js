// URL handling for Instagram DM capture: pull candidate links out of a
// messaging event, follow short links to their destination, and pick the one
// that is the real article rather than a profile or link-in-bio hub.
//
// Normalization policy: every URL this module *decides* on (resolveUrl's
// result, pickBestUrl's pick) goes through normalizeUrl, the backend's single
// normalization path. extractUrls is the exception on purpose: it returns the
// raw candidates untouched, because normalizeUrl drops the query string and
// some wrapper/short links (e.g. l.instagram.com/?u=...) carry their whole
// destination in it. They must reach resolveUrl intact.

const dns = require('node:dns');
const net = require('node:net');
const { normalizeUrl } = require('../url');

const URL_IN_TEXT = /https?:\/\/[^\s<>"']+/gi;
const BARE_URL = /^https?:\/\/\S+$/i;

// Link-in-bio hubs, plus Instagram/Facebook media CDNs (an image or video file
// is never the article). Matched on the host and any subdomain of it.
const HUB_HOSTS = [
  'linktr.ee',
  'beacons.ai',
  'linkin.bio',
  'bio.link',
  'stan.store',
  'instagram.com',
  'cdninstagram.com',
  'fbcdn.net',
];

// Sentence punctuation that trails a URL in prose is not part of it. A closing
// paren is kept only when the URL itself opens a matching one (Wikipedia-style
// paths), so prose like "(see https://x.com/a)" loses the stray one.
function trimTrailingPunctuation(url) {
  let s = url;
  for (;;) {
    const last = s[s.length - 1];
    if (last && '.,;:!?\'"]}'.includes(last)) { s = s.slice(0, -1); continue; }
    if (last === ')' && s.split(')').length > s.split('(').length) { s = s.slice(0, -1); continue; }
    return s;
  }
}

function urlsInText(text) {
  if (typeof text !== 'string') return [];
  return (text.match(URL_IN_TEXT) || []).map(trimTrailingPunctuation);
}

// A payload field counts only when the whole value is a URL: a quick-reply
// payload is usually an opaque token ("DONE"), not a link.
function urlFromField(value) {
  if (typeof value !== 'string') return [];
  const s = value.trim();
  return BARE_URL.test(s) ? [s] : [];
}

// Candidate URLs in payload order: message text, then attachment payloads,
// then the quick-reply payload. Raw, not normalized (see header).
function extractUrls(messagingEvent) {
  const message = messagingEvent && messagingEvent.message;
  if (!message) return [];

  const found = [...urlsInText(message.text)];
  for (const attachment of Array.isArray(message.attachments) ? message.attachments : []) {
    found.push(...urlFromField(attachment && attachment.payload && attachment.payload.url));
  }
  found.push(...urlFromField(message.quick_reply && message.quick_reply.payload));
  return found;
}

function hostOf(url) {
  try {
    const raw = String(url).trim();
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return u.hostname.toLowerCase();
  } catch {
    return null;
  }
}

function hostMatches(host, domain) {
  return host === domain || host.endsWith(`.${domain}`);
}

// True for link-in-bio hubs and for any instagram.com URL (profiles, posts,
// reels: none of them is the creator's article).
function isHubPage(url) {
  const host = hostOf(url);
  if (!host) return false;
  return HUB_HOSTS.some((domain) => hostMatches(host, domain));
}

// The first candidate that is a usable http(s) URL and not a hub page.
// Pure filter: null means "there were candidates and none survived". Telling
// that apart from "no candidates at all" is the caller's job.
function pickBestUrl(urls) {
  for (const url of urls) {
    if (!hostOf(url) || !/^https?:\/\//i.test(String(url).trim())) continue;
    if (isHubPage(url)) continue;
    const normalized = normalizeUrl(url);
    if (normalized) return normalized;
  }
  return null;
}

// Addresses grimoire must never fetch on behalf of a stranger's DM: loopback,
// private, link-local (cloud metadata lives at 169.254.169.254), unique-local
// (Railway's private network is IPv6 fd12::/16), and the unspecified addresses.
// Also 0.0.0.0/8 and 100.64.0.0/10 (carrier-grade NAT, used by some internal
// networks). BlockList treats IPv4-mapped IPv6 (::ffff:127.0.0.1) as the IPv4
// address, so that bypass is covered too.
const BLOCKED_ADDRESSES = new net.BlockList();
for (const [net4, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.168.0.0', 16],
]) BLOCKED_ADDRESSES.addSubnet(net4, prefix, 'ipv4');
BLOCKED_ADDRESSES.addAddress('::', 'ipv6');
BLOCKED_ADDRESSES.addAddress('::1', 'ipv6');
BLOCKED_ADDRESSES.addSubnet('fc00::', 7, 'ipv6');
BLOCKED_ADDRESSES.addSubnet('fe80::', 10, 'ipv6');

function isBlockedAddress(address) {
  const family = net.isIP(address);
  if (!family) return true; // not an address we can reason about: refuse
  return BLOCKED_ADDRESSES.check(address, family === 6 ? 'ipv6' : 'ipv4');
}

// Decide whether it is safe to issue a GET at this URL. Returns null when it
// is, or a short string naming the rule that rejects it (logged by resolveUrl).
// http(s) only, and the host must not resolve to an internal address. Resolved
// here rather than trusted from the text, since a public hostname can point at
// a private address, and EVERY returned address must pass. Runs on each hop,
// including post-redirect destinations. A lookup failure throws (a
// network-level failure, not a rejection).
//
// KNOWN GAP, DNS REBINDING: this check and fetch's own connection are two
// separate DNS lookups. We resolve the hostname here and validate the answer,
// then fetch() resolves it again by itself when it connects. A hostname whose
// DNS server answers with a public address for our lookup and a private one
// (127.0.0.1, 169.254.169.254, ...) for fetch's lookup gets through this guard.
// Closing it requires connecting to the address we validated, i.e. an undici
// Agent with a custom connect.lookup that pins it. undici is not a dependency
// of this repo, so doing that means adding one; that was deliberately left out
// of the plan's scope, not forgotten. If this endpoint is ever exposed to
// untrusted senders at scale, revisit it.
async function checkFetchable(rawUrl, lookupImpl) {
  let u;
  try { u = new URL(rawUrl); } catch { return 'not a parseable url'; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return `scheme ${u.protocol} is not http(s)`;
  }

  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (!host) return 'empty host';
  if (net.isIP(host)) {
    return isBlockedAddress(host) ? `ip literal ${host} is internal or unspecified` : null;
  }

  const addresses = await lookupImpl(host, { all: true });
  if (!Array.isArray(addresses) || addresses.length === 0) {
    return `dns for ${host} returned no addresses`;
  }
  const blocked = addresses.find((a) => isBlockedAddress(a.address));
  return blocked ? `host ${host} resolves to internal address ${blocked.address}` : null;
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

// Follow a (short) link to its destination by hand: one request per hop with
// redirect:'manual', following Location (relative ones resolved against the
// current URL). `hops` is the true number of redirects followed; more than
// `maxHops` returns null. Every hop passes checkFetchable first (see above).
//
// Returns null on a rejected URL, a network-level failure (throw, timeout,
// lookup failure), a redirect with no Location, or too many hops. A final
// response with a non-ok status (403 from a bot wall, 404) still yields its
// URL: the address is known even if the page would not serve us.
async function resolveUrl(url, {
  maxHops = 5,
  fetchImpl = fetch,
  lookupImpl = dns.promises.lookup,
} = {}) {
  try {
    const signal = AbortSignal.timeout(15000);
    let current = String(url).trim();
    let hops = 0;

    for (;;) {
      const rejection = await checkFetchable(current, lookupImpl);
      if (rejection) {
        // null is also what an unreachable url returns, so this line is the only
        // trace a blocked (possibly hostile) attempt leaves.
        console.warn(`[instagram:links] refused to fetch ${JSON.stringify(current.slice(0, 300))}: ${rejection} (hop ${hops})`);
        return null;
      }

      const response = await fetchImpl(current, { redirect: 'manual', signal });
      // Only the address matters, never the body.
      if (response && response.body && typeof response.body.cancel === 'function') {
        response.body.cancel().catch(() => {});
      }
      if (!response) return null;

      if (REDIRECT_STATUSES.has(response.status)) {
        const location = response.headers && response.headers.get('location');
        if (!location) return null;
        hops += 1;
        if (hops > maxHops) return null;
        current = new URL(location, current).href;
        continue;
      }

      const normalized = normalizeUrl(current);
      return normalized ? { url: normalized, hops } : null;
    }
  } catch {
    return null;
  }
}

module.exports = { extractUrls, resolveUrl, isHubPage, pickBestUrl };
