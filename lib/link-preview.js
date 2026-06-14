const axios = require('axios');
const { getYouTubeVideoId, isYouTubeUrl, getYouTubeThumbnail } = require('./youtube');

function decodeHtmlEntities(str) {
  if (!str) return '';
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'");
}

function getMeta(html, property) {
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']+)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${property}["']`, 'i'),
    new RegExp(`<meta[^>]+name=["']${property}["'][^>]+content=["']([^"']+)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${property}["']`, 'i'),
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m) return decodeHtmlEntities(m[1].trim());
  }
  return null;
}

function getHostname(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function ensureAbsoluteUrl(url, baseUrl) {
  if (!url) return null;
  let trimmed = decodeHtmlEntities(String(url).trim());
  if (!trimmed) return null;
  if (trimmed.startsWith('//')) return `https:${trimmed}`;
  if (!/^https?:\/\//i.test(trimmed)) trimmed = `https://${trimmed}`;
  return trimmed;
}

async function fetchHtmlPrefix(url, maxBytes = 300_000) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GrimoireBot/1.0)' },
    redirect: 'follow',
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  if (!res.body) {
    const text = await res.text();
    return text.slice(0, maxBytes);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let html = '';

  while (html.length < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    html += decoder.decode(value, { stream: true });
    if (html.length >= maxBytes) {
      html = html.slice(0, maxBytes);
      try {
        await reader.cancel();
      } catch {
        /* ignore */
      }
      break;
    }
  }

  return html;
}

async function fetchYouTubePreview(url) {
  const res = await fetch(
    `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`,
    { signal: AbortSignal.timeout(8000) },
  );
  if (!res.ok) return null;
  const data = await res.json();
  return {
    url,
    title: data.title || null,
    description: data.author_name ? `by ${data.author_name}` : null,
    image: getYouTubeThumbnail(url) || ensureAbsoluteUrl(data.thumbnail_url, url),
    site_name: 'YouTube',
  };
}

async function fetchOgPreview(url) {
  const html = await fetchHtmlPrefix(url);
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const title =
    getMeta(html, 'og:title') ||
    getMeta(html, 'twitter:title') ||
    (titleMatch ? decodeHtmlEntities(titleMatch[1].trim()) : null);
  const description =
    getMeta(html, 'og:description') ||
    getMeta(html, 'twitter:description') ||
    getMeta(html, 'description');
  const rawImage = getMeta(html, 'og:image') || getMeta(html, 'twitter:image:src') || getMeta(html, 'twitter:image');
  const image = ensureAbsoluteUrl(rawImage, url);
  const siteName = getMeta(html, 'og:site_name') || getHostname(url);
  return { url, title, description, image, site_name: siteName };
}

async function getLinkPreview(url) {
  const normalized = ensureAbsoluteUrl(String(url || '').trim());
  if (!normalized) throw new Error('url is required');

  if (isYouTubeUrl(normalized)) {
    const thumbnail = getYouTubeThumbnail(normalized);
    if (thumbnail) {
      try {
        const yt = await fetchYouTubePreview(normalized);
        if (yt?.title) {
          return { ...yt, image: thumbnail };
        }
      } catch (err) {
        console.warn(`[link-preview] YouTube oEmbed failed for ${normalized}: ${err.message}`);
      }
      return {
        url: normalized,
        title: null,
        description: null,
        image: thumbnail,
        site_name: 'YouTube',
      };
    }

    // Bare youtube.com/watch URLs lost their ?v= param when saved — no thumbnail possible.
    return {
      url: normalized,
      title: null,
      description: null,
      image: null,
      site_name: 'YouTube',
    };
  }

  try {
    return await fetchOgPreview(normalized);
  } catch (err) {
    console.warn(`[link-preview] OG fetch failed for ${normalized}: ${err.message}`);
    return {
      url: normalized,
      title: null,
      description: null,
      image: getYouTubeThumbnail(normalized),
      site_name: getHostname(normalized),
    };
  }
}

async function fetchPreviewImage(url) {
  const imageUrl = ensureAbsoluteUrl(String(url || '').trim());
  if (!imageUrl || !/^https?:\/\//i.test(imageUrl)) {
    throw new Error('Invalid image url');
  }

  // YouTube CDN allows direct browser loads; proxy only when needed elsewhere.
  if (/^https?:\/\/(?:img\.youtube\.com|i\.ytimg\.com)\//i.test(imageUrl)) {
    const res = await fetch(imageUrl, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return {
      data: Buffer.from(await res.arrayBuffer()),
      contentType: res.headers.get('content-type') || 'image/jpeg',
    };
  }

  const res = await axios.get(imageUrl, {
    timeout: 8000,
    maxRedirects: 5,
    responseType: 'arraybuffer',
    maxContentLength: 5_000_000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; GrimoireBot/1.0)',
      Accept: 'image/*,*/*;q=0.8',
    },
  });

  return {
    data: res.data,
    contentType: res.headers['content-type'] || 'image/jpeg',
  };
}

module.exports = { getLinkPreview, fetchPreviewImage, ensureAbsoluteUrl };
