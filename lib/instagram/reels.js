// Identifying one Instagram post across the several URL shapes it appears in.
//
// The library stores what the user shared (instagram.com/reel/ABC), Apify
// answers with its own normalisation (www.instagram.com/p/ABC/), and share
// links arrive with query strings attached. The shortcode is the only part
// that is stable, so it is what results get matched on.

const SHORTCODE = /\/(?:reel|reels|p|tv)\/([A-Za-z0-9_-]+)/;

// The post's shortcode, or null when the URL is not a post (a profile, a
// story, something that is not Instagram at all).
function shortcodeOf(url) {
  if (typeof url !== 'string') return null;
  let parsed;
  try { parsed = new URL(url.trim()); } catch { return null; }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  if (host !== 'instagram.com' && !host.endsWith('.instagram.com')) return null;
  const match = SHORTCODE.exec(parsed.pathname);
  return match ? match[1] : null;
}

module.exports = { shortcodeOf };
