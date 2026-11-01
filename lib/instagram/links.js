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

const { normalizeUrl } = require('../url');

const URL_IN_TEXT = /https?:\/\/[^\s<>"']+/gi;
const BARE_URL = /^https?:\/\/\S+$/i;

// Link-in-bio hubs. Matched on the host and any subdomain of it.
const HUB_HOSTS = [
  'linktr.ee',
  'beacons.ai',
  'linkin.bio',
  'bio.link',
  'stan.store',
  'instagram.com',
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

function sameUrl(a, b) {
  try {
    return new URL(a).href === new URL(b).href;
  } catch {
    return a === b;
  }
}

// Follow a (short) link to its destination with one redirect-following fetch
// and read the final response.url. `hops` is 0 when the URL did not move and 1
// when it did: a single fetch cannot count intermediate redirects, so it is a
// moved/not-moved flag, and `maxHops` rejects a redirect only when it is < 1.
// Returns null when the request fails, errors, or answers non-ok.
async function resolveUrl(url, { maxHops = 5, fetchImpl = fetch } = {}) {
  if (!/^https?:\/\//i.test(String(url).trim())) return null;
  try {
    const response = await fetchImpl(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(10000),
    });
    // We only want the final address, not the page body.
    if (response && response.body && typeof response.body.cancel === 'function') {
      response.body.cancel().catch(() => {});
    }
    if (!response || !response.ok || !response.url) return null;

    const hops = sameUrl(url, response.url) ? 0 : 1;
    if (hops > maxHops) return null;

    const normalized = normalizeUrl(response.url);
    return normalized ? { url: normalized, hops } : null;
  } catch {
    return null;
  }
}

module.exports = { extractUrls, resolveUrl, isHubPage, pickBestUrl };
