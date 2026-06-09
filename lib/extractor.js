/**
 * Grimoire Content Extractor
 * Routes URLs to the correct extraction pipeline:
 *   - Video platforms (YouTube, TikTok, Instagram, X/Twitter, Facebook) → Supadata SDK
 *   - Article platforms (Medium, Substack, generic web) → Jina AI Reader
 *
 * Returns: { text, title, source, platform, type }
 *
 * Install: npm install @supadata/js
 */

import { Supadata, SupadataError } from '@supadata/js';

const supadata = new Supadata({
  apiKey: process.env.SUPADATA_API_KEY,
});

const VIDEO_HOSTS = [
  'youtube.com', 'youtu.be',
  'instagram.com',
  'tiktok.com',
  'twitter.com', 'x.com',
  'facebook.com', 'fb.watch',
];

const ARTICLE_HOSTS = [
  'medium.com',
  'substack.com',
];

function detectContentType(url) {
  let hostname;
  try {
    hostname = new URL(url).hostname.replace('www.', '');
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }

  if (ARTICLE_HOSTS.some(h => hostname === h || hostname.endsWith(`.${h}`))) {
    return 'article';
  }

  if (VIDEO_HOSTS.some(h => hostname === h || hostname.endsWith(`.${h}`))) {
    return 'video';
  }

  return 'article'; // default: treat unknown hosts as articles
}

function parseTranscript(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(c => c.text).join(' ');
  return '';
}

async function extractVideo(url) {
  console.log(`[extractVideo] Calling Supadata for: ${url}`);
  const result = await supadata.transcript({
    url,
    text: true,  // plain string instead of timestamped chunks
    mode: 'auto', // native captions first, AI fallback if none exist
  });

  // Large files return a jobId for async polling
  if ('jobId' in result) {
    let job;
    let attempts = 0;
    const maxAttempts = 30; // 30 × 2s = 60s max wait

    while (attempts < maxAttempts) {
      await new Promise(r => setTimeout(r, 2000));
      job = await supadata.transcript.getJobStatus(result.jobId);

      if (job.status === 'completed') break;
      if (job.status === 'failed') throw new Error(`Supadata job failed: ${job.error}`);

      attempts++;
    }

    if (!job || job.status !== 'completed') {
      throw new Error('Supadata transcript job timed out');
    }

    return { text: parseTranscript(job.content), title: '' };
  }

  // Small files return the transcript directly
  console.log(`[extractVideo] Supadata returned:`, JSON.stringify(result).substring(0, 300));
  return { text: parseTranscript(result), title: '' };
}

async function extractArticle(url) {
  const jinaUrl = `https://r.jina.ai/${url}`;

  const response = await fetch(jinaUrl, {
    headers: { 'Accept': 'text/plain' },
  });

  if (!response.ok) {
    throw new Error(`Jina error ${response.status} for ${url}`);
  }

  const raw = await response.text();
  const titleMatch = raw.match(/^Title:\s*(.+)/m);

  return {
    text: raw,
    title: titleMatch ? titleMatch[1].trim() : '',
  };
}

/**
 * Main entry point — call this from your Telegram bot handler.
 *
 * @param {string} url
 * @returns {{ text: string, title: string, source: string, platform: string, type: 'video'|'article' }}
 */
export async function extractContent(url) {
  const type = detectContentType(url);
  const hostname = new URL(url).hostname.replace('www.', '');

  let result;

  if (type === 'video') {
    console.log(`[extractContent] Routing ${url} → Supadata (video)`);
    result = await extractVideo(url);
  } else {
    console.log(`[extractContent] Routing ${url} → Jina (article)`);
    result = await extractArticle(url);
  }

  if (!result.text || result.text.trim().length === 0) {
    throw new Error(`No content extracted from ${url}`);
  }

  return {
    text: result.text.trim(),
    title: result.title || '',
    source: url,
    platform: hostname,
    type,
  };
}
