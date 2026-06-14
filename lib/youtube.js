function parseYouTubeUrl(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return null;
  try {
    const href = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    return new URL(href);
  } catch {
    return null;
  }
}

function getYouTubeVideoId(url) {
  const u = parseYouTubeUrl(url);
  if (!u) return null;

  const hostname = u.hostname.replace(/^www\./, '');
  if (hostname === 'youtu.be') {
    return u.pathname.slice(1).split('/')[0] || null;
  }
  if (hostname === 'youtube.com' || hostname.endsWith('.youtube.com')) {
    const fromQuery = u.searchParams.get('v');
    if (fromQuery) return fromQuery;
    const m = u.pathname.match(/\/(embed|shorts|live|v)\/([^/?]+)/);
    return m ? m[2] : null;
  }
  return null;
}

function isYouTubeUrl(url) {
  const u = parseYouTubeUrl(url);
  if (!u) return false;
  const hostname = u.hostname.replace(/^www\./, '');
  return hostname === 'youtu.be' || hostname === 'youtube.com' || hostname.endsWith('.youtube.com');
}

function getYouTubeThumbnail(url, quality = 'hqdefault') {
  const videoId = getYouTubeVideoId(url);
  if (!videoId) return null;
  return `https://img.youtube.com/vi/${videoId}/${quality}.jpg`;
}

module.exports = { getYouTubeVideoId, isYouTubeUrl, getYouTubeThumbnail, parseYouTubeUrl };
