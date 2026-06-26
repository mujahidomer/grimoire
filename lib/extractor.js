/**
 * Grimoire Content Extractor
 * Routes URLs to the correct extraction pipeline:
 *   - Twitter/X → Syndication API (full text/author, no auth) + Supadata for
 *     embedded video transcript + Haiku vision for photo tweets
 *   - Other video platforms (YouTube, TikTok) → Supadata SDK
 *   - Meta platforms (Instagram, Facebook) → Apify
 *   - Article platforms (Medium, Substack, generic web) → Jina AI Reader
 *
 * Returns: { text, title, source, platform, type }
 *
 * Install: npm install @supadata/js
 */

import { Supadata } from '@supadata/js';
import Anthropic from '@anthropic-ai/sdk';
import { fetchTranscript } from 'youtube-transcript';
import { PDFParse } from 'pdf-parse';

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

function isTwitterUrl(url) {
  try {
    const hostname = new URL(url).hostname.replace('www.', '');
    return hostname === 'twitter.com' || hostname.endsWith('.twitter.com')
        || hostname === 'x.com' || hostname.endsWith('.x.com');
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

// Supabase Storage uploads (PDFs + screenshots from the web UI) arrive as
// public object URLs: https://<project>.supabase.co/storage/v1/object/...
// They aren't recognizable content hosts, so they get their own branch in
// extractContent() before the host-based routing below.
function isSupabaseStorageUrl(url) {
  try {
    const { hostname, pathname } = new URL(url);
    return hostname.endsWith('.supabase.co') && pathname.includes('/storage/v1/object/');
  } catch {
    return false;
  }
}

const PDF_EXT = /\.pdf(?:[?#]|$)/i;
const IMAGE_EXT = /\.(jpe?g|png|webp|gif)(?:[?#]|$)/i;

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

// Extract the video id from any YouTube URL form: watch?v=, youtu.be/<id>,
// /shorts/<id>, /embed/<id>, /live/<id>.
function youtubeVideoId(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace('www.', '');
    if (host === 'youtu.be') return u.pathname.slice(1).split('/')[0] || null;
    if (u.searchParams.get('v')) return u.searchParams.get('v');
    const m = u.pathname.match(/\/(?:shorts|embed|live)\/([^/?#]+)/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

async function extractYouTubeNative(url) {
  const videoId = youtubeVideoId(url);
  if (!videoId) throw new Error(`Could not parse YouTube video id from ${url}`);
  console.log(`[extractVideo] Using youtube-transcript for video ${videoId}`);
  const segments = await fetchTranscript(videoId);
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
  const errors = [];

  // YouTube: try native captions first. Most YouTube videos have captions, so
  // this avoids a Supadata call entirely on the common path. Non-YouTube hosts
  // (TikTok, Twitter/X, Facebook, Instagram) skip straight to Supadata below.
  if (isYouTubeUrl(url)) {
    try {
      return await extractYouTubeNative(url);
    } catch (err) {
      console.warn(`[extractVideo] YouTube native transcript unavailable, falling back to Supadata (${err.message})`);
      errors.push(err.message);
    }
  }

  const supadata = getSupadata();
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

  throw new Error(`Video extraction failed: ${errors.join('; ') || 'no extractors available'}`);
}

// ─── Twitter / X ─────────────────────────────────────────────────────────────
// Tweets aren't always videos: text-only tweets, photo tweets and threads all
// break the bare Supadata path. The Syndication API gives us the full tweet
// text + author with no auth, and we layer Supadata (video) / Haiku vision
// (photos) on top.

// Pull the numeric tweet id out of the path (the segment after /status/).
function tweetIdFromUrl(url) {
  try {
    const m = new URL(url).pathname.match(/\/status(?:es)?\/(\d+)/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

// The syndication endpoint 404s without a `token` param. This reproduces the
// token Twitter's own embed widget derives from the tweet id. NOTE: the widget
// uses Number (not BigInt) math here — `BigInt(id) / 1e15` throws "Cannot mix
// BigInt and other types", and the float precision loss is irrelevant since the
// token only has to match what the endpoint expects.
function getSyndicationToken(tweetId) {
  return ((Number(tweetId) / 1e15) * Math.PI)
    .toString(36)
    .replace(/(0+|\.)/g, '');
}

// A tweet is treated as a thread only when its path carries more than one
// status id. The `?s=` share-tracking param is NOT a thread signal — it's
// present on most normally copied tweet links (e.g. ...?s=20).
function isThreadUrl(url) {
  try {
    const ids = new URL(url).pathname.match(/\/status(?:es)?\/\d+/g) || [];
    return ids.length > 1;
  } catch {
    return false;
  }
}

const TWEET_IMAGE_PROMPT =
  "Describe what's in this image in detail. If there is any text visible in the image, transcribe it exactly.";

// t.co is Twitter's link shortener. When a text tweet links out to an article,
// the syndication `text` only carries the shortened t.co URL — the article body
// lives at the redirect target. Resolve the redirect and, if it lands on an
// article (not a video host, not another tweet), pull the content through Jina.
// Returns the article body, or null if there's no t.co link or expansion fails.
const TCO_RE = /https?:\/\/t\.co\/[A-Za-z0-9]+/;

async function resolveTcoArticle(text) {
  const match = text.match(TCO_RE);
  if (!match) return null;
  const shortUrl = match[0];

  let finalUrl;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(shortUrl, { redirect: 'follow', signal: controller.signal });
      finalUrl = res.url;
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    console.warn(`[extractTwitter] t.co expansion failed for ${shortUrl}: ${err.message}`);
    return null;
  }

  if (!finalUrl) return null;

  // Twitter Articles (x.com/i/article/...) live on x.com but are long-form web
  // content, not tweets — route them through Jina like any other article rather
  // than letting the isTwitterUrl check below skip them.
  const isTwitterArticle = /x\.com\/i\/article\//.test(finalUrl);

  // Links back into Twitter (another tweet) or at a video host are handled by
  // the tweet/video paths, not Jina article extraction — skip them.
  if (!isTwitterArticle && (isTwitterUrl(finalUrl) || detectContentType(finalUrl) === 'video')) {
    console.log(`[extractTwitter] t.co target ${finalUrl} is a tweet/video, skipping article extraction`);
    return null;
  }

  try {
    const article = await extractArticle(finalUrl);
    const body = article.text?.trim();
    if (!body) return null;
    console.log(`[extractTwitter] Expanded t.co ${shortUrl} → article ${finalUrl} (${body.length} chars)`);
    return body;
  } catch (err) {
    // 451 = "unavailable for legal reasons"; Jina commonly returns it for
    // x.com/i/article targets that block third-party fetchers. It's an
    // unfixable external block, so degrade gracefully to a plain tweet save
    // (return null) rather than letting it bubble up and crash the pipeline.
    if (/\b451\b/.test(err.message)) {
      console.warn(`[extractTwitter] Jina blocked (451) for t.co target ${finalUrl}; falling back to tweet metadata`);
    } else {
      console.warn(`[extractTwitter] Jina extraction failed for t.co target ${finalUrl}: ${err.message}`);
    }
    return null;
  }
}

// A tweet that shares a Twitter Article carries the Article's headline and an
// excerpt in a top-level `article` object (NOT a link card / binding_values).
// We use these as fallback content when the full article body can't be fetched
// (e.g. Jina 451), so the classifier sees real substance instead of a bare
// shortened URL. Note: preview_text is a Twitter-truncated excerpt, not the full
// body. Returns '' if there's no article object — defensive, never throws.
function articlePreviewText(data) {
  const a = data && data.article;
  if (!a) return '';
  const title = (a.title || '').trim();
  const preview = (a.preview_text || '').trim();
  return [title, preview].filter(Boolean).join('\n\n');
}

// Runs before extractVideo for Twitter/X URLs. Returns:
//   { text, author, transcript, image_descriptions, type, thread }
//   type ∈ 'tweet_video' | 'tweet_photo' | 'tweet_text'
async function extractTwitter(url) {
  const id = tweetIdFromUrl(url);
  if (!id) throw new Error(`Could not parse tweet id from ${url}`);

  const token = getSyndicationToken(id);
  const endpoint = `https://cdn.syndication.twimg.com/tweet-result?id=${id}&lang=en&token=${token}`;
  console.log(`[extractTwitter] Fetching syndication API for tweet ${id}`);

  const res = await fetch(endpoint, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    console.error(`[extractTwitter] Syndication API returned ${res.status} for tweet ${id}`);
    throw new Error(`Twitter syndication failed (${res.status}) for ${url}`);
  }

  // Guard against a 200 that isn't JSON (e.g. an HTML error/interstitial page) —
  // surface the status + a snippet instead of throwing an opaque SyntaxError.
  const body = await res.text();
  let data;
  try {
    data = JSON.parse(body);
  } catch {
    console.error(`[extractTwitter] Syndication API returned non-JSON body (${res.status}) for tweet ${id}: ${body.slice(0, 200)}`);
    throw new Error(`Twitter syndication returned non-JSON body for ${url}`);
  }
  const text = (data.text || '').trim();
  const author = data.user?.name || data.user?.screen_name || '';
  const thread = isThreadUrl(url);

  // Video tweet: keep the tweet text and add the Supadata transcript on top.
  if (data.video) {
    let transcript = null;
    const supadata = getSupadata();
    if (supadata) {
      try {
        const v = await extractVideoSupadata(supadata, url);
        transcript = v.text?.trim() || null;
      } catch (err) {
        console.warn(`[extractTwitter] Supadata transcript failed (${err.message})`);
      }
    } else {
      console.warn('[extractTwitter] SUPADATA_API_KEY not set, skipping video transcript');
    }
    return { text, author, transcript, image_descriptions: null, type: 'tweet_video', thread };
  }

  // Photo tweet: describe each embedded image via Haiku vision.
  const imageUrls = (Array.isArray(data.photos) ? data.photos : [])
    .map(p => p?.url)
    .filter(Boolean);
  if (imageUrls.length > 0) {
    const descriptions = [];
    for (const imgUrl of imageUrls) {
      try {
        const desc = await describeWithHaiku([imgUrl], TWEET_IMAGE_PROMPT);
        if (desc?.trim()) descriptions.push(desc.trim());
      } catch (err) {
        console.warn(`[extractTwitter] Haiku image description failed for ${imgUrl}: ${err.message}`);
      }
    }
    return {
      text,
      author,
      transcript: null,
      image_descriptions: descriptions.length > 0 ? descriptions : null,
      type: 'tweet_photo',
      thread,
    };
  }

  // Text-only tweet. If it links out to an article via t.co, resolve the
  // redirect and bring the article body in as the main text — the tweet text
  // stays the caption.
  const articleBody = await resolveTcoArticle(text);
  if (articleBody) {
    return { text, author, transcript: articleBody, image_descriptions: null, type: 'tweet_text', thread };
  }

  // The tweet linked out but the article body was unavailable (e.g. an
  // x.com/i/article blocked by Jina with a 451). Don't hand the classifier a
  // bare URL — fall back to a standard tweet save, folding in the Twitter
  // Article's title + preview excerpt when present so there's real content to
  // classify. The tweet text stays the caption either way.
  const hadLink = TCO_RE.test(text);
  const preview = hadLink ? articlePreviewText(data) : '';
  if (hadLink) {
    console.log(preview
      ? `[extractTwitter] Article body unavailable for ${url}; using Article title + preview excerpt (${preview.length} chars)`
      : `[extractTwitter] Article body unavailable for ${url}; saving as plain tweet with available metadata`);
  }
  return { text, author, transcript: preview || null, image_descriptions: null, type: 'tweet_text', thread };
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
    // Headroom for dense, text-heavy images (e.g. uploaded screenshots) so the
    // description isn't truncated before processContent classifies it.
    max_tokens: 2000,
    messages: [{
      role: 'user',
      content: [...imageBlocks, { type: 'text', text: prompt }],
    }],
  });

  return response.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
}

// ─── Supabase Storage uploads (PDF + image) ──────────────────────────────────
const PDF_WORD_CAP = 7500;

function capWords(text, maxWords) {
  const trimmed = (text || '').trim();
  if (!trimmed) return '';
  const words = trimmed.split(/\s+/);
  if (words.length <= maxWords) return trimmed;
  return words.slice(0, maxWords).join(' ');
}

// Download a PDF from Supabase Storage, extract its text with pdf-parse, and
// cap it at the first ~7,500 words before it hits the Haiku classifier.
async function extractPdf(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`PDF fetch failed (${res.status}) for ${url}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  const parser = new PDFParse({ data: buffer });
  const { text } = await parser.getText();
  return capWords(text, PDF_WORD_CAP);
}

// Describe a Supabase-hosted image via Haiku vision. Reuses the same
// download → base64 → Haiku pattern as the Instagram image path.
async function extractSupabaseImage(url) {
  const prompt = 'Describe the content of this image in detail. Extract any text visible in the image. Summarize the key information or message being conveyed.';
  return describeWithHaiku([url], prompt);
}

// Route a Supabase Storage upload to the PDF or image pipeline and return the
// same shape as extractContent() so it flows through the existing classifier.
async function extractSupabaseUpload(url) {
  const isPdf = PDF_EXT.test(url);
  console.log(`[extractContent] Routing ${url} → Supabase upload (${isPdf ? 'pdf' : 'image'})`);
  const text = isPdf ? await extractPdf(url) : await extractSupabaseImage(url);
  if (!text || text.trim().length === 0) {
    throw new Error(`No content extracted from ${url}`);
  }
  return {
    text: text.trim(),
    title: '',
    source: url,
    platform: 'upload',
    type: isPdf ? 'document' : 'image',
    hashtags: null,
    transcript: text.trim(),
    caption: null,
  };
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
  // Supabase Storage uploads (PDFs + images) are handled before the host-based
  // routing below — they're signed object URLs, not recognizable content hosts.
  if (isSupabaseStorageUrl(url) && (PDF_EXT.test(url) || IMAGE_EXT.test(url))) {
    return extractSupabaseUpload(url);
  }

  const type = detectContentType(url);
  const hostname = new URL(url).hostname.replace('www.', '');
  const isInstagram = hostname === 'instagram.com' || hostname.endsWith('.instagram.com');

  // Twitter/X is intercepted before the generic video path: a tweet may be
  // text-only, a photo, or a thread, none of which Supadata can handle alone.
  if (isTwitterUrl(url)) {
    console.log(`[extractContent] Routing ${url} → Twitter (syndication)`);
    const tw = await extractTwitter(url);

    // Spoken/vision content (video transcript or image descriptions) goes to the
    // Transcript section; the tweet body is author-written, so it maps to Caption.
    const vision = [tw.transcript, ...(tw.image_descriptions || [])].filter(Boolean);
    const transcript = vision.length > 0 ? vision.join('\n\n') : null;

    const threadNote = tw.thread ? '_Thread — only first tweet extracted._' : '';
    const caption = [threadNote, tw.text].filter(Boolean).join('\n\n') || null;

    // Combined blob handed to the classifier.
    const text = [threadNote, tw.text, transcript].filter(Boolean).join('\n\n').trim();
    if (!text) throw new Error(`No content extracted from ${url}`);

    return {
      text,
      title: '',
      source: url,
      platform: hostname,
      type: tw.type,
      author: tw.author || null,
      hashtags: null,
      transcript,
      caption,
      image_descriptions: tw.image_descriptions ?? null,
    };
  }

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
