const axios = require('axios');
const { JSDOM } = require('jsdom');
const { Readability } = require('@mozilla/readability');

async function extractFromUrl(url) {
  const videoId = extractYouTubeId(url);

  if (videoId) {
    return await extractYouTubeContent(videoId, url);
  } else {
    return await extractArticleContent(url);
  }
}

function extractYouTubeId(url) {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\n?#]+)/,
    /youtube\.com\/embed\/([^&\n?#]+)/,
    /youtube\.com\/shorts\/([^&\n?#]+)/
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

async function extractYouTubeContent(videoId, url) {
  try {
    // Dynamic import since youtube-transcript is ESM
    const { YoutubeTranscript } = await import('youtube-transcript');
    const transcriptData = await YoutubeTranscript.fetchTranscript(videoId);
    const text = transcriptData.map(t => t.text).join(' ');

    if (!text || text.trim().length < 50) {
      return { text: null, sourceUrl: url, error: 'no_transcript', type: 'youtube' };
    }

    return { text: text.trim(), sourceUrl: url, type: 'youtube' };
  } catch (err) {
    return { text: null, sourceUrl: url, error: 'no_transcript', type: 'youtube' };
  }
}

async function extractArticleContent(url) {
  const response = await axios.get(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Grimoire/1.0)' },
    timeout: 15000
  });

  const dom = new JSDOM(response.data, { url });
  const reader = new Readability(dom.window.document);
  const article = reader.parse();

  if (!article || !article.textContent || article.textContent.trim().length < 100) {
    throw new Error('Could not extract article content from this URL');
  }

  return {
    text: article.textContent.trim(),
    sourceUrl: url,
    type: 'article',
    title: article.title || ''
  };
}

module.exports = { extractFromUrl };
