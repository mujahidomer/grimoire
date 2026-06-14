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

import { Supadata } from '@supadata/js';
import Anthropic from '@anthropic-ai/sdk';
import { fetchTranscript } from 'youtube-transcript';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function getSupadata() {
  const apiKey = process.env.SUPADATA_API_KEY?.trim();
  if (!apiKey) return null;
  return new Supadata({ apiKey });
}

function isYouTubeUrl(url) {
  try {
    const hostname = new URL(url).hostname.replace('www.', '');
    return hostname === 'youtube.com' || hostname.endsWith('.youtube.com') || hostname === 'youtu.be';
  } catch {
    return false;
  }
}

const VIDEO_HOSTS = [
  'youtube.com', 'youtu.be',
  'tiktok.com',
  'twitter.com', 'x.com',
];

const META_HOSTS = [
  'instagram.com',
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

  if (META_HOSTS.some(h => hostname === h || hostname.endsWith(`.${h}`))) {
    return 'meta';
  }

  return 'article'; // default: treat unknown hosts as articles
}

function parseTranscript(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(c => c.text).join(' ');
  return '';
}

async function extractYouTubeNative(url) {
  console.log(`[extractVideo] Using youtube-transcript for: ${url}`);
  const segments = await fetchTranscript(url);
  const text = segments.map(s => s.text).join(' ');
  if (!text.trim()) throw new Error('youtube-transcript returned empty transcript');
  return { text, title: '' };
}

async function extractVideoSupadata(supadata, url) {
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
  return { text: parseTranscript(result.content), title: '' };
}

async function extractVideo(url) {
  const supadata = getSupadata();
  const errors = [];

  if (supadata) {
    try {
      console.log(`[extractVideo] Calling Supadata for: ${url}`);
      return await extractVideoSupadata(supadata, url);
    } catch (err) {
      const msg = err.message || String(err);
      console.warn(`[extractVideo] Supadata failed (${msg})`);
      errors.push(msg);
    }
  } else {
    console.warn('[extractVideo] SUPADATA_API_KEY not set');
  }

  if (isYouTubeUrl(url)) {
    try {
      return await extractYouTubeNative(url);
    } catch (err) {
      console.warn(`[extractVideo] youtube-transcript failed (${err.message})`);
      errors.push(err.message);
    }
  }

  throw new Error(`Video extraction failed: ${errors.join('; ') || 'no extractors available'}`);
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

// Below this, a Whisper transcript is treated as silence/near-empty audio and
// the caller falls back to the caption.
const MIN_TRANSCRIPT_CHARS = 50;

const AUDIO_DOWNLOAD_ATTEMPTS = 3;
const AUDIO_DOWNLOAD_TIMEOUT_MS = 20000;

// Download the audio into an in-memory buffer. Apify's audioUrl is a short-lived
// signed URL, so this MUST run immediately after Apify returns — before Whisper —
// or the URL may expire and the fetch fails. Retries transient failures (network
// blips, timeouts, 429/5xx) with a short backoff; a non-retryable status (e.g. an
// already-expired 4xx) fails fast.
async function downloadAudio(audioUrl) {
  let lastErr;
  let attempt = 0;
  for (attempt = 1; attempt <= AUDIO_DOWNLOAD_ATTEMPTS; attempt++) {
    try {
      const audioRes = await fetch(audioUrl, { signal: AbortSignal.timeout(AUDIO_DOWNLOAD_TIMEOUT_MS) });
      if (!audioRes.ok) {
        const err = new Error(`Audio fetch failed (${audioRes.status})`);
        err.retryable = audioRes.status === 408 || audioRes.status === 429 || audioRes.status >= 500;
        throw err;
      }

      const buffer = await audioRes.arrayBuffer();
      const ext = (audioUrl.split('?')[0].split('.').pop() || 'mp3').toLowerCase();
      const mimeMap = { mp4: 'video/mp4', ogg: 'audio/ogg', wav: 'audio/wav', webm: 'audio/webm' };
      const mimeType = mimeMap[ext] || 'audio/mpeg';

      return { buffer, ext, mimeType };
    } catch (err) {
      lastErr = err;
      // Network/timeout errors carry no `retryable` flag → treat them as retryable.
      if (err.retryable === false || attempt === AUDIO_DOWNLOAD_ATTEMPTS) break;
      console.warn(`[extractMeta] Audio download attempt ${attempt}/${AUDIO_DOWNLOAD_ATTEMPTS} failed (${err.message}), retrying...`);
      await new Promise(r => setTimeout(r, 1000 * attempt));
    }
  }
  throw new Error(`Audio download failed after ${attempt} attempt(s): ${lastErr.message}`);
}

// Transcribe an already-downloaded audio buffer with Whisper. Takes the buffer
// (not a URL) so transcription is decoupled from the expiring signed URL.
async function transcribeWithWhisper({ buffer, ext, mimeType }) {
  const formData = new FormData();
  formData.append('file', new Blob([buffer], { type: mimeType }), `audio.${ext}`);
  formData.append('model', 'whisper-1');

  const whisperRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` },
    body: formData,
  });

  if (!whisperRes.ok) {
    const err = await whisperRes.text();
    throw new Error(`Whisper error (${whisperRes.status}): ${err}`);
  }

  const { text } = await whisperRes.json();
  return text;
}

async function describeWithHaiku(imageUrls, prompt) {
  // Instagram's CDN blocks Anthropic's URL fetcher via robots.txt,
  // so download the images ourselves and send them as base64.
  const imageBlocks = await Promise.all(imageUrls.map(async url => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Image fetch failed (${res.status}) for ${url}`);
    const mediaType = (res.headers.get('content-type') || 'image/jpeg').split(';')[0];
    const buffer = Buffer.from(await res.arrayBuffer());
    return {
      type: 'image',
      source: { type: 'base64', media_type: mediaType, data: buffer.toString('base64') },
    };
  }));

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: [...imageBlocks, { type: 'text', text: prompt }],
    }],
  });

  return response.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
}

async function extractMeta(url) {
  const hostname = new URL(url).hostname.replace('www.', '');
  const isInstagram = hostname === 'instagram.com' || hostname.endsWith('.instagram.com');
  const actorId = isInstagram ? 'apify~instagram-scraper' : 'apify~facebook-posts-scraper';
  const input = isInstagram
    ? { directUrls: [url] }
    : { startUrls: [{ url }] };

  const token = process.env.APIFY_API_KEY;
  const base = 'https://api.apify.com/v2';

  console.log(`[extractMeta] Starting Apify actor ${actorId} for: ${url}`);

  const runRes = await fetch(`${base}/acts/${actorId}/runs?token=${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });

  if (!runRes.ok) {
    const err = await runRes.text();
    throw new Error(`Apify run start failed (${runRes.status}): ${err}`);
  }

  const { data: run } = await runRes.json();
  const runId = run.id;

  // Poll until SUCCEEDED or FAILED (max 60 attempts × 5s = 5 min)
  let status = run.status;
  for (let i = 0; i < 60 && status !== 'SUCCEEDED' && status !== 'FAILED' && status !== 'ABORTED'; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const pollRes = await fetch(`${base}/actor-runs/${runId}?token=${token}`);
    if (!pollRes.ok) throw new Error(`Apify poll failed (${pollRes.status})`);
    const { data: pollData } = await pollRes.json();
    status = pollData.status;
    console.log(`[extractMeta] Run ${runId} status: ${status}`);
  }

  if (status !== 'SUCCEEDED') {
    throw new Error(`Apify run ${runId} ended with status: ${status}`);
  }

  const itemsRes = await fetch(`${base}/actor-runs/${runId}/dataset/items?token=${token}`);
  if (!itemsRes.ok) throw new Error(`Apify dataset fetch failed (${itemsRes.status})`);
  const items = await itemsRes.json();

  if (isInstagram) {
    const item = items[0] || {};
    const postType = item.type ?? 'Video';
    const caption = item.caption ?? item.text ?? '';
    const hashtags = Array.isArray(item.hashtags) ? item.hashtags : [];

    let visionText = '';

    if (postType === 'Video') {
      const audioUrl = item.audioUrl ?? null;
      if (audioUrl) {
        try {
          // Download first so the signed audioUrl can't expire before Whisper runs.
          const audio = await downloadAudio(audioUrl);
          const transcript = await transcribeWithWhisper(audio);
          const length = (transcript || '').trim().length;

          if (length >= MIN_TRANSCRIPT_CHARS) {
            visionText = transcript;
            console.log(`[extractMeta] Whisper transcription succeeded (${length} chars)`);
          } else {
            console.warn(`[extractMeta] Whisper returned only ${length} chars (< ${MIN_TRANSCRIPT_CHARS}) — likely silence or empty audio, falling back to caption only`);
          }
        } catch (err) {
          console.warn(`[extractMeta] Whisper failed, falling back to caption only: ${err.message}`);
        }
      } else {
        console.warn(`[extractMeta] No audioUrl in Apify response, using caption only`);
      }
    } else if (postType === 'Image') {
      const displayUrl = item.displayUrl ?? null;
      if (displayUrl) {
        try {
          const prompt = 'Describe the content of this image in detail. Extract any text visible in the image. Summarize the key information or message being conveyed.';
          visionText = await describeWithHaiku([displayUrl], prompt);
          console.log(`[extractMeta] Haiku image description succeeded (${visionText.length} chars)`);
        } catch (err) {
          console.warn(`[extractMeta] Haiku image description failed, falling back to caption only: ${err.message}`);
        }
      } else {
        console.warn(`[extractMeta] No displayUrl in Apify response, using caption only`);
      }
    } else if (postType === 'Sidecar') {
      console.log('Apify sidecar raw item:', JSON.stringify(item, null, 2));
      const imageUrls = (() => {
        if (Array.isArray(item.images) && item.images.length > 0)
          return item.images.map(img => typeof img === 'string' ? img : img.url);
        if (Array.isArray(item.childPosts) && item.childPosts.length > 0)
          return item.childPosts.map(p => p.displayUrl);
        // Apify returns child images as separate top-level dataset items
        return items.slice(1).map(i => i.displayUrl);
      })().filter(Boolean);
      if (imageUrls.length > 0) {
        try {
          const prompt = 'Describe each image in this carousel post individually, then provide an overall summary of what the post is about. Extract any visible text. Summarize the key information or message being conveyed.';
          visionText = await describeWithHaiku(imageUrls, prompt);
          console.log(`[extractMeta] Haiku sidecar description succeeded (${visionText.length} chars)`);
        } catch (err) {
          console.warn(`[extractMeta] Haiku sidecar description failed, falling back to caption only: ${err.message}`);
        }
      } else {
        console.warn(`[extractMeta] No images in Apify sidecar response, using caption only`);
      }
    }

    // `text` is the combined content used for classification, but transcript
    // (spoken/vision) and caption are kept separate for the output sections.
    const text = [visionText, caption].filter(Boolean).join('\n\n');
    return { text, transcript: visionText, caption, hashtags, title: '' };
  }

  // Facebook path
  const texts = items.map(item =>
    item.caption ?? item.text ?? item.message ?? item.transcript ?? ''
  ).filter(Boolean);

  return { text: texts.join('\n\n'), title: '' };
}

/**
 * Main entry point — call this from your Telegram bot handler.
 *
 * @param {string} url
 * @returns {{ text: string, title: string, source: string, platform: string, type: 'video'|'article', hashtags?: string[] }}
 */
export async function extractContent(url) {
  const type = detectContentType(url);
  const hostname = new URL(url).hostname.replace('www.', '');
  const isInstagram = hostname === 'instagram.com' || hostname.endsWith('.instagram.com');

  let result;

  if (type === 'video') {
    console.log(`[extractContent] Routing ${url} → Supadata (video)`);
    result = await extractVideo(url);
  } else if (type === 'meta') {
    console.log(`[extractContent] Routing ${url} → Apify (meta)`);
    result = await extractMeta(url);
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
    platform: isInstagram ? 'instagram' : hostname,
    type: isInstagram ? 'video' : type,
    hashtags: result.hashtags ?? null,
    // Spoken/video transcript and caption kept separate for the output sections.
    // Non-meta paths have no caption; their main text is the transcript.
    transcript: 'transcript' in result ? result.transcript : result.text.trim(),
    caption: result.caption ?? null,
  };
}
