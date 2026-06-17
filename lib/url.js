// Single URL-normalization path for the whole backend (Doc A item 3).
//
// Every write path — item.source_url, artifact_url, linked_resource.source_url —
// runs through normalizeUrl, killing the historical inconsistency where appended
// linked-resource URLs skipped cleaning. This consolidates the old drive.js
// `cleanUrl`/`stripQuery` logic into one exported function.
//
// Behaviour:
//   - "[text](url)" markdown link wrapping → "url"
//   - strip protocol-relative noise and a leading "www."
//   - drop the query string and fragment (tracking/session junk: ?igsh=, ?utm_*,
//     ?mcp_token= — expire or are noise)
//   - EXCEPTION: Google Docs/Drive links keep their query, which they need to
//     resolve (matches the prior cleanUrl behaviour)
//   - drop a trailing slash
//   - host is lowercased; the path keeps its original case
// Returns null for empty/missing input.

function normalizeUrl(value) {
  if (value === null || value === undefined) return null;

  let s = String(value).trim();
  if (!s) return null;

  // Unwrap a markdown link: [label](url)
  const linked = s.match(/^\[[^\]]*\]\(([^)]+)\)$/);
  if (linked) s = linked[1].trim();

  // Strip a leading protocol-relative "//"
  s = s.replace(/^\/\//, '');

  let host = '';
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    host = u.hostname.toLowerCase().replace(/^www\./, '');

    // Google Docs/Drive: preserve the full original URL incl. query.
    if (host === 'docs.google.com' || host === 'drive.google.com') {
      return s.replace(/\/+$/, '') || null;
    }

    // YouTube watch URLs need the `v` query param to identify the video.
    if (host === 'youtube.com' || host.endsWith('.youtube.com')) {
      const v = u.searchParams.get('v');
      const path = u.pathname.replace(/\/+$/, '') || '/';
      let rebuilt = `${host}${path}`;
      if (v) rebuilt += `?v=${encodeURIComponent(v)}`;
      return `https://${rebuilt}`;
    }

    const path = u.pathname.replace(/\/+$/, '');
    const rebuilt = `${host}${path}`;
    return `https://${rebuilt}`;
  } catch {
    // Not a parseable URL — best-effort plain cleanup.
    return s
      .replace(/^https?:\/\//i, '')
      .replace(/^www\./i, '')
      .split(/[?#]/)[0]
      .replace(/\/+$/, '')
      .toLowerCase() || null;
  }
}

// Dedup key: protocol/www/trailing-slash/query/fragment insensitive, host
// lowercased, path case-preserved. Used to compare two URLs for "same resource".
function dedupeKey(url) {
  const raw = (url || '').trim();
  try {
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return u.hostname.toLowerCase().replace(/^www\./, '') + u.pathname.replace(/\/+$/, '');
  } catch {
    return raw
      .replace(/^https?:\/\//i, '')
      .replace(/^www\./i, '')
      .split(/[?#]/)[0]
      .replace(/\/+$/, '')
      .toLowerCase();
  }
}

// Rank a candidate link's suitability as an artifact's primary URL. Higher wins.
// Only rank 0 (unparseable / localhost / bare IP) is blocked from promotion;
// every real content URL is worth promoting at some level.
//   4 — GitHub repo / project page (github.com, *.github.io)
//   3 — official docs (docs./developer. host, /docs/ path, gitbook.io, readme.io)
//   2 — product homepage (root path)
//   1 — any other real content URL with a meaningful path (Notion, Gumroad,
//       Substack, Medium, and every other recognizable content platform)
//   0 — bare IP, localhost, or a URL that fails to parse
function primaryLinkRank(url) {
  let host = '', path = '/';
  try {
    const u = new URL(/^https?:\/\//i.test(String(url)) ? String(url) : `https://${url}`);
    host = u.hostname.toLowerCase().replace(/^www\./, '');
    path = u.pathname || '/';
  } catch {
    return 0;
  }

  // Non-promotable hosts: localhost and bare IP literals (IPv4 or IPv6).
  if (host === 'localhost' || /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':')) return 0;

  // Rank 4: GitHub repo / project page.
  if (host === 'github.com' || host.endsWith('.github.io')) return 4;

  // Rank 3: official documentation.
  if (host.startsWith('docs.') || host.startsWith('developer.') ||
      host.endsWith('gitbook.io') || host.endsWith('readme.io') ||
      /\/docs(\/|$)/.test(path)) return 3;

  // Rank 2: product homepage (root path, no meaningful depth).
  if (path === '/' || path === '') return 2;

  // Rank 1: any other real content URL with a path.
  return 1;
}

// Pick the most likely primary link for an artifact from a list of candidate
// URL strings, preferring GitHub repos, then docs, then homepages, then any
// other real content URL. Returns null only when no candidate is promotable
// (every candidate is rank 0 — unparseable / localhost / bare IP).
function pickPrimaryArtifactLink(urls) {
  let best = null, bestRank = 0;
  for (const url of Array.isArray(urls) ? urls : []) {
    const rank = primaryLinkRank(url);
    if (rank > bestRank) { best = url; bestRank = rank; }
  }
  return bestRank >= 1 ? best : null;
}

module.exports = { normalizeUrl, dedupeKey, primaryLinkRank, pickPrimaryArtifactLink };
