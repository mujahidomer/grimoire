const axios = require('axios');
const { JSDOM } = require('jsdom');
const { Readability } = require('@mozilla/readability');

// Sites that always block scrapers — skip straight to research
const BLOCKED_DOMAINS = [
  'medium.com', 'towardsdatascience.com', 'betterhumans.pub',
  'make.com', 'zapier.com', 'notion.so', 'twitter.com', 'x.com',
  'instagram.com', 'linkedin.com', 'facebook.com', 'tiktok.com'
];

async function extractFromUrl(url) {
  try {
    // Check blocked domains first
    const isBlocked = BLOCKED_DOMAINS.some(domain => url.includes(domain));
    if (isBlocked) {
      return { text: null, sourceUrl: url, error: 'blocked' };
    }

    const videoId = extractYouTubeId(url);
    if (videoId) {
      return await extractYouTubeContent(videoId, url);
    } else {
      return await extractArticleContent(url);
    }
  } catch (err) {
    // Never throw — always return a result object
    return { text: null, sourceUrl: url, error: 'blocked' };
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
    const { YoutubeTranscript } = await import('youtube-transcript');
    const transcriptData = await YoutubeTranscript.fetchTranscript(videoId);
    const text = transcriptData.map(t => t.text).join(' ');
    if (!text || text.trim().length < 50) {
      return { text: null, sourceUrl: url, error: 'no_transcript' };
    }
    return { text: text.trim(), sourceUrl: url, type: 'youtube' };
  } catch (err) {
    return { text: null, sourceUrl: url, error: 'no_transcript' };
  }
}

async function extractArticleContent(url) {
  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      timeout: 15000
    });

    const dom = new JSDOM(response.data, { url });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();

    if (!article || !article.textContent || article.textContent.trim().length < 100) {
      return { text: null, sourceUrl: url, error: 'blocked' };
    }

    return { text: article.textContent.trim(), sourceUrl: url, type: 'article' };
  } catch (err) {
    return { text: null, sourceUrl: url, error: 'blocked' };
  }
}

module.exports = { extractFromUrl };
