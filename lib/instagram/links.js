// URL handling for Instagram DM capture: pull candidate links out of a
// messaging event, follow short links to their destination, and pick the one
// that is the real article rather than a profile, a link-in-bio hub, or a
// media file.
//
// Normalization policy: this module normalizes NOTHING. extractUrls returns the
// candidates as found, pickBestUrl returns the chosen candidate as found, and
// resolveUrl returns the final URL exactly as it was fetched (scheme, port and
// query intact). normalizeUrl drops the query string and forces https, and
// wrapper/short links such as l.facebook.com/l.php?u=<destination> carry their
// whole destination in the query, so normalizing anywhere between extractUrls
// and resolveUrl destroys them. Normalization belongs at the write boundary
// (repository.js upsertLinkedResource calls normalizeUrl on source_url); callers
// must not normalize a URL before handing it to resolveUrl.
//
// One exception to "candidates as found": extractUrls replaces a link on a known
// wrapper host (l.instagram.com, l.facebook.com, lm.facebook.com) with the URL
// inside its `u` parameter (see unwrapLink). The inner URL is still returned
// untouched. Without this, an article delivered through an Instagram wrapper
// would be discarded: l.instagram.com is an instagram.com host, so it counts as
// a hub page, and the article behind it would never be judged on its own merits.

const dns = require('node:dns');
const net = require('node:net');

const URL_IN_TEXT = /https?:\/\/[^\s<>"']+/gi;
const BARE_URL = /^https?:\/\/\S+$/i;

// Link-in-bio hubs and Instagram itself (profiles, posts, reels: none of them
// is the creator's article). Matched on the host and any subdomain of it.
// isHubPage must stay truthful to this: a caller reads "had candidates, pick
// was null" as "that was a hub page", so media hosts do NOT belong here.
const HUB_HOSTS = [
  'linktr.ee',
  'beacons.ai',
  'linkin.bio',
  'bio.link',
  'stan.store',
  'instagram.com',
];

// Instagram/Facebook media CDNs. An image or video file is never the article,
// but it is not a hub page either; kept apart so isHubPage does not lie.
const MEDIA_HOSTS = [
  'cdninstagram.com',
  'fbcdn.net',
];

// Redirect wrappers that carry their destination in a `u` query parameter. The
// hostname must match exactly; lookalikes and other subdomains are not wrappers.
const WRAPPER_HOSTS = new Set(['l.instagram.com', 'l.facebook.com', 'lm.facebook.com']);
const MAX_UNWRAPS = 2;

// Sentence punctuation that trails a URL in prose is not part of it. A closing
// paren is kept only when the URL itself opens a matching one (Wikipedia-style
// paths), so prose like "(see https://x.com/a)" loses the stray one.
function trimTrailingPunctuation(url) {
  let s = url;
  for (;;) {
    const last = s[s.length - 1];
    if (last && '.,;:!?]}'.includes(last)) { s = s.slice(0, -1); continue; }
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

// Raw value of the first `u` parameter in a query string, undecoded.
function rawUParam(search) {
  for (const pair of search.replace(/^\?/, '').split('&')) {
    const eq = pair.indexOf('=');
    if (eq !== -1 && pair.slice(0, eq) === 'u') return pair.slice(eq + 1);
  }
  return null;
}

// One layer: a URL on a wrapper host becomes its decoded `u` parameter, only if
// that is an absolute http(s) URL. Anything else (not a wrapper host, no `u`,
// an empty or undecodable `u`, a javascript:/file:/data: payload) is returned
// unchanged, so a wrapper cannot smuggle a non-http scheme past the checks.
function unwrapOnce(url) {
  let u;
  try { u = new URL(String(url).trim()); } catch { return url; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return url;
  if (!WRAPPER_HOSTS.has(u.hostname.toLowerCase())) return url;

  const raw = rawUParam(u.search);
  if (!raw) return url;
  let inner;
  try { inner = decodeURIComponent(raw); } catch { return url; } // decoded exactly once
  try {
    const parsed = new URL(inner);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return url;
  } catch {
    return url;
  }
  return inner;
}

// Replace a link-wrapper URL with the destination in its `u` parameter. Only
// `u` is read (no guessing at other names), it is decoded once, and nested
// wrappers are followed at most MAX_UNWRAPS times, then left as they are. A
// URL that is not a usable wrapper is returned unchanged.
function unwrapLink(url) {
  let current = url;
  for (let i = 0; i < MAX_UNWRAPS; i++) {
    const next = unwrapOnce(current);
    if (next === current) break;
    current = next;
  }
  return current;
}

// Candidate URLs in payload order: message text, then attachment payloads,
// then the quick-reply payload. Not normalized; known link wrappers are
// replaced by their inner URL (see header).
function extractUrls(messagingEvent) {
  const message = messagingEvent && messagingEvent.message;
  if (!message) return [];

  const found = [...urlsInText(message.text)];
  for (const attachment of Array.isArray(message.attachments) ? message.attachments : []) {
    found.push(...urlFromField(attachment && attachment.payload && attachment.payload.url));
  }
  found.push(...urlFromField(message.quick_reply && message.quick_reply.payload));
  return found.map(unwrapLink);
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

// True for link-in-bio hubs and for any instagram.com URL.
function isHubPage(url) {
  const host = hostOf(url);
  if (!host) return false;
  return HUB_HOSTS.some((domain) => hostMatches(host, domain));
}

// True for Instagram/Facebook media CDN hosts (images and video files).
function isMediaUrl(url) {
  const host = hostOf(url);
  if (!host) return false;
  return MEDIA_HOSTS.some((domain) => hostMatches(host, domain));
}

// The first candidate that is a usable http(s) URL and is neither a hub page
// nor a media file, returned exactly as given (see header). Pure filter: null
// means "there were candidates and none survived". Telling that apart from "no
// candidates at all" is the caller's job.
function pickBestUrl(urls) {
  for (const url of urls) {
    if (!hostOf(url) || !/^https?:\/\//i.test(String(url).trim())) continue;
    if (isHubPage(url) || isMediaUrl(url)) continue;
    // A URL still on a wrapper host here is one that failed to unwrap (a
    // successful unwrap leaves the wrapper host behind). Drop it on every
    // wrapper host alike, so a failed unwrap is never kept on one and
    // discarded on another.
    if (WRAPPER_HOSTS.has(hostOf(url))) continue;
    return url;
  }
  return null;
}

// Addresses grimoire must never fetch on behalf of a stranger's DM: loopback,
// private, link-local (cloud metadata lives at 169.254.169.254), unique-local
// (Railway's private network is IPv6 fd12::/16), unspecified, multicast,
// reserved, benchmarking, and the IPv6 transition/compat prefixes that can wrap
// an IPv4 address. 0.0.0.0/8 and 100.64.0.0/10 (carrier-grade NAT) are blocked
// whole. BlockList treats IPv4-mapped IPv6 (::ffff:127.0.0.1) as the IPv4
// address, so that bypass is covered too.
const BLOCKED_ADDRESSES = new net.BlockList();
for (const [base, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4],
]) BLOCKED_ADDRESSES.addSubnet(base, prefix, 'ipv4');
BLOCKED_ADDRESSES.addAddress('255.255.255.255', 'ipv4'); // also inside 240/4; explicit on purpose
BLOCKED_ADDRESSES.addAddress('::', 'ipv6');
BLOCKED_ADDRESSES.addAddress('::1', 'ipv6');
for (const [base, prefix] of [
  ['::', 96], ['64:ff9b::', 96], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8],
]) BLOCKED_ADDRESSES.addSubnet(base, prefix, 'ipv6');

function isBlockedAddress(address) {
  const family = net.isIP(address);
  if (!family) return true; // not an address we can reason about: refuse
  return BLOCKED_ADDRESSES.check(address, family === 6 ? 'ipv6' : 'ipv4');
}

// Decide whether it is safe to issue a GET at this URL. Returns null when it
// is, or a short string naming the rule that rejects it (logged by resolveUrl).
// http(s) only, on the default web ports only (anything else would let a DM
// sender probe arbitrary ports on public hosts), and the host must not resolve
// to an internal address. Resolved here rather than trusted from the text,
// since a public hostname can point at a private address, and EVERY returned
// address must pass. Runs on each hop, including post-redirect destinations. A
// lookup failure throws (a network-level failure, not a rejection).
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
  // URL drops a scheme's default port, so '' is 80 on http and 443 on https.
  if (u.port !== '' && u.port !== '80' && u.port !== '443') {
    return `port ${u.port} is not 80 or 443`;
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
const DEFAULT_MAX_HOPS = 5;

// JSON-quoted and cut short: a hostile DM cannot inject newlines or flood the log.
const quoted = (value) => JSON.stringify(String(value).slice(0, 300));

// Follow a (short) link to its destination by hand: one request per hop with
// redirect:'manual', following Location (relative ones resolved against the
// current URL). `hops` is the true number of redirects followed; more than
// `maxHops` (a non-negative integer, else 5) returns null. Every hop passes
// checkFetchable first (see above).
//
// Returns { url, hops } where url is the final URL exactly as fetched (scheme,
// port and query intact, not normalized). Returns null on: a rejected URL, a
// network-level failure (throw, timeout, lookup failure), a redirect with no
// Location, a malformed Location, or too many hops. Every one of those paths
// logs via logImpl before returning null, because null alone cannot tell them
// apart. A final response with a non-ok status (403 from a bot wall, 404) still
// yields its URL: the address is known even if the page would not serve us.
async function resolveUrl(url, {
  maxHops = DEFAULT_MAX_HOPS,
  fetchImpl = fetch,
  lookupImpl = dns.promises.lookup,
  logImpl = console.warn,
} = {}) {
  const cap = Number.isInteger(maxHops) && maxHops >= 0 ? maxHops : DEFAULT_MAX_HOPS;
  const log = (message) => logImpl(`[instagram:links] ${message}`);
  let current = String(url).trim();
  let hops = 0;

  try {
    const signal = AbortSignal.timeout(15000);

    for (;;) {
      const rejection = await checkFetchable(current, lookupImpl);
      if (rejection) {
        // null is also what an unreachable url returns, so this line is the only
        // trace a blocked (possibly hostile) attempt leaves.
        log(`refused to fetch ${quoted(current)}: ${rejection} (hop ${hops})`);
        return null;
      }

      const response = await fetchImpl(current, { redirect: 'manual', signal });
      if (!response) {
        log(`no response fetching ${quoted(current)} (hop ${hops})`);
        return null;
      }
      // Only the address matters, never the body.
      if (response.body && typeof response.body.cancel === 'function') {
        response.body.cancel().catch(() => {});
      }

      if (REDIRECT_STATUSES.has(response.status)) {
        const location = response.headers && response.headers.get('location');
        if (!location) {
          log(`redirect ${response.status} with no Location from ${quoted(current)} (hop ${hops})`);
          return null;
        }
        hops += 1;
        if (hops > cap) {
          log(`gave up after ${cap} hops, still redirecting from ${quoted(current)} to ${quoted(location)}`);
          return null;
        }
        current = new URL(location, current).href;
        continue;
      }

      return { url: current, hops };
    }
  } catch (err) {
    log(`failed resolving ${quoted(current)} (hop ${hops}): ${err && err.name}: ${String(err && err.message).slice(0, 300)}`);
    return null;
  }
}

module.exports = { extractUrls, unwrapLink, resolveUrl, isHubPage, isMediaUrl, pickBestUrl };
