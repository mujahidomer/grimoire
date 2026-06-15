require('dotenv').config();
const express = require('express');
const cors = require('cors');
const TelegramBot = require('node-telegram-bot-api');
const { extractContent } = require('./lib/extractor');
const { processContent, researchUrl, processLinkedResource } = require('./lib/classifier');
const { normalizeTagsPg } = require('./lib/tags-pg');
const {
  upsertItem, upsertItemTags, upsertLinkedResource, findItemBySourceUrl, getItemById
} = require('./lib/repository');
const { embedAndStoreItem } = require('./lib/embeddings');
const { registerApiRoutes } = require('./lib/routes');
const { defaultUserId } = require('./lib/supabase');
const { requireAuth } = require('./lib/request-auth');
const { seedUserLibrary } = require('./lib/seed');

const app = express();
// CORS for the web UI (Doc B paste-box + chat panel). The throwaway viewer runs
// on a separate origin (Next dev server on :3000, or the deployed UI), so browser
// calls need explicit cross-origin permission.
app.use(cors({
  origin: process.env.WEB_ORIGIN || true,
  allowedHeaders: ['Content-Type', 'Authorization', 'x-user-id'],
}));
app.use(express.json());

// ─── Telegram Bot ────────────────────────────────────────────────────────────
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });

// The single hardcoded capture user for the testing phase (Doc A §Auth). The
// schema is multi-user from day one; this is just whose library Telegram fills.
const USER_ID = (() => {
  try { return defaultUserId(); }
  catch (err) { console.error('⚠️', err.message); return null; }
})();

// In-memory map: confirmation Telegram message_id → { itemId, title }. Lets a
// reply to a "Saved" message append a linked resource to the right item. The
// Sheets-backed persistence (which survived restarts) is retired along with the
// Sheets registry; this transitional map is fine while Telegram is just the
// capture method (Doc A item 2).
const confirmationIndex = new Map();

// ─── Core Pipeline (writes to Postgres, not Drive/Sheets) ─────────────────────
// Normalize tags against the canonical `tags` table, persist the item + tags +
// any linked resources, then embed it. Returns a lightweight saved record.
async function saveItem(item, sourceUrl, userId) {
  item.sourceUrl = sourceUrl;

  let finalTags = Array.isArray(item.tags) ? item.tags : [];
  finalTags = await normalizeTagsPg(finalTags, userId);
  item.tags = finalTags;

  const itemId = await upsertItem(item, { userId, source: item.source || 'telegram' });
  await upsertItemTags(itemId, userId, finalTags);

  for (const lr of Array.isArray(item.linked_resources) ? item.linked_resources : []) {
    if (typeof lr === 'string') await upsertLinkedResource(itemId, userId, { source_url: lr });
    else await upsertLinkedResource(itemId, userId, lr);
  }

  try {
    await embedAndStoreItem(item, itemId, userId);
  } catch (err) {
    console.error('Embedding failed (item still saved):', err.message);
  }

  return { itemId, title: item.title, category: item.category, type: item.type,
    summary: item.summary, has_lead_magnet_cta: item.has_lead_magnet_cta };
}

async function researchAndSave(sourceUrl, userId) {
  const items = await researchUrl(sourceUrl);
  if (!items || items.length === 0) return [];
  const saved = [];
  for (const item of items) saved.push(await saveItem(item, sourceUrl, userId));
  return saved;
}

async function runPipeline(rawText, sourceUrl, hashtags, parts = {}, userId) {
  const items = await processContent(rawText, sourceUrl, hashtags, parts);
  if (!items || items.length === 0) return [];
  const saved = [];
  for (const item of items) saved.push(await saveItem(item, sourceUrl, userId));
  return saved;
}

// Extract content from a URL and save. Falls back to web-search classification
// when scraping/transcript extraction fails or returns nothing.
async function saveFromUrl(url, userId) {
  let extracted = null;
  try {
    extracted = await extractContent(url);
  } catch (err) {
    console.warn(`[saveFromUrl] Extraction failed (${err.message}), falling back to research...`);
    return researchAndSave(url, userId);
  }

  if (!extracted.text) {
    return researchAndSave(url, userId);
  }

  return runPipeline(extracted.text, url, extracted.hashtags,
    { caption: extracted.caption, transcript: extracted.transcript }, userId);
}

async function sendSavedConfirmation(chatId, saved) {
  const summary = saved.map(item =>
    `${typeEmoji(item.type)} *${item.title}*\n   ${item.category} · ${item.type}\n   ${item.summary || ''}`
  ).join('\n\n');

  let text = `✅ Saved ${saved.length} item(s) to Grimoire:\n\n${summary}`;
  if (saved.some(item => item.has_lead_magnet_cta)) {
    text += `\n\n⚠️ This post has a 'comment for link' CTA — when you receive the link, reply to this message with it and I'll attach it to this entry.`;
  }

  const confirmMsg = await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });

  // Remember which item(s) this confirmation refers to, so a reply can append.
  if (saved.length === 1) {
    confirmationIndex.set(confirmMsg.message_id, { itemId: saved[0].itemId, title: saved[0].title });
  }
}

// Append one or more follow-up links to an already-saved item as linked_resources.
async function appendToEntry(chatId, entry, urls) {
  const urlList = Array.isArray(urls) ? urls : [urls];

  for (const url of urlList) {
    await bot.sendMessage(chatId, urlList.length > 1
      ? `🔗 Extracting linked resource (${urlList.indexOf(url) + 1}/${urlList.length})...`
      : '🔗 Extracting linked resource...');

    let extracted = null;
    try {
      extracted = await extractContent(url);
    } catch (err) {
      console.error('Linked resource extraction failed:', err.message);
    }

    const processed = await processLinkedResource(extracted?.text || '', extracted?.title);
    await upsertLinkedResource(entry.itemId, USER_ID, {
      source_url: url,
      title: processed.title,
      type: processed.resource_type,
      body_content: processed.content
    });
    await bot.sendMessage(chatId, `🔗 Added to ${entry.title}`);
  }
}

// ─── Telegram Handlers ───────────────────────────────────────────────────────
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id,
    `👋 Welcome to Grimoire!\n\n` +
    `Send me:\n` +
    `• A YouTube or article URL to auto-extract skills\n` +
    `• Any text (transcript, skill name, notes) to process manually\n\n` +
    `Commands:\n/help — Show this message\n/status — Check if Grimoire is ready`
  );
});

bot.onText(/\/help/, (msg) => {
  bot.sendMessage(msg.chat.id,
    `📖 How to use Grimoire:\n\n` +
    `*URLs*: Paste any YouTube or article link. I'll extract the content, identify all skills and insights, and save them to your library.\n\n` +
    `*Text*: Paste a transcript, skill name, or any notes. I'll categorize and save everything.\n\n` +
    `*Follow-up links*: Reply to a "Saved" message with a link to attach it as a linked resource.`,
    { parse_mode: 'Markdown' }
  );
});

bot.onText(/\/status/, (msg) => {
  bot.sendMessage(msg.chat.id, USER_ID
    ? '✅ Grimoire is ready (writing to Postgres).'
    : '⚠️ GRIMOIRE_USER_ID is not configured — saves will fail.');
});

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  if (!text || text.startsWith('/')) return;
  if (!USER_ID) return bot.sendMessage(chatId, '⚠️ GRIMOIRE_USER_ID is not configured.');

  try {
    const urls = text.match(/https?:\/\/\S+/g) || [];

    // Reply to a "Saved" confirmation → append the link to the original item.
    if (msg.reply_to_message && urls.length >= 1) {
      const entry = confirmationIndex.get(msg.reply_to_message.message_id);
      if (entry) return await appendToEntry(chatId, entry, urls);
      await bot.sendMessage(chatId, `⚠️ Couldn't find the original entry for that message — saving as a new entry instead.`);
    }

    // Two-URL fallback: one URL matches an existing item's source → append the other.
    if (urls.length === 2) {
      const [a, b] = await Promise.all([
        findItemBySourceUrl(USER_ID, urls[0]),
        findItemBySourceUrl(USER_ID, urls[1])
      ]);
      if (a && !b) return await appendToEntry(chatId, { itemId: a.id, title: a.title }, urls[1]);
      if (b && !a) return await appendToEntry(chatId, { itemId: b.id, title: b.title }, urls[0]);
    }

    const isUrl = /^https?:\/\//i.test(text.trim());

    if (isUrl) {
      const url = text.trim();
      await bot.sendMessage(chatId, '🔗 Extracting content...');
      const saved = await saveFromUrl(url, USER_ID);
      if (saved.length === 0) return bot.sendMessage(chatId, '🤔 Nothing found for this URL. Try pasting content directly.');
      await sendSavedConfirmation(chatId, saved);

    } else {
      await bot.sendMessage(chatId, '🧠 Processing...');
      const saved = await runPipeline(text, 'manual', undefined, {}, USER_ID);
      if (saved.length === 0) return bot.sendMessage(chatId, '🤔 Nothing extractable found. Try pasting the content directly.');
      await sendSavedConfirmation(chatId, saved);
    }
  } catch (err) {
    console.error('Pipeline error:', err);
    bot.sendMessage(chatId, `❌ Error: ${err.message}`);
  }
});

function typeEmoji(type) {
  const map = { video: '🎬', article: '📄' };
  return map[String(type || '').toLowerCase()] || '📌';
}

// ─── REST API ─────────────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', user: !!USER_ID }));

// Retrieval + chat API (Doc A item 5): GET /api/items, GET /api/items/:id, POST /api/chat.
registerApiRoutes(app);

// POST /api/save — the web paste-box save flow (Doc B). Same pipeline as the
// Telegram/iOS capture path, just a clean HTTP entry point. Body: { url }.
// Returns a top-level { id, title } for the first saved item (what the paste-box
// links to) plus the full items array, since one URL can yield multiple items.
app.post('/api/save', requireAuth(async (req, res) => {
  const { url } = req.body || {};
  if (!url) return res.status(400).json({ error: 'url is required' });
  try {
    const saved = await saveFromUrl(url, req.userId);
    if (!saved || saved.length === 0) {
      return res.status(422).json({ success: false, error: 'no_content',
        message: 'Nothing extractable found at that URL.' });
    }
    const items = saved.map(i => ({ id: i.itemId, title: i.title, category: i.category, type: i.type }));
    res.json({ success: true, id: items[0].id, title: items[0].title, count: items.length, items });
  } catch (err) {
    console.error('POST /api/save error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
}));

// POST /api/seed — copy pre-processed starter-library items into the caller's
// library (the onboarding funnel). The user id is taken from the verified token,
// never the body. Returns 200 immediately and copies asynchronously so signup
// stays instant. Body: { selectedItemIds: string[] }.
app.post('/api/seed', requireAuth(async (req, res) => {
  const { selectedItemIds } = req.body || {};
  const ids = Array.isArray(selectedItemIds) ? selectedItemIds.slice(0, 50) : [];
  res.json({ success: true, accepted: ids.length });
  // Fire-and-forget: do the copying after responding.
  seedUserLibrary(req.userId, ids).catch((err) =>
    console.error('POST /api/seed background error:', err),
  );
}));

// POST /api/items/:id/reclassify — re-run classification on stored transcript/caption.
// Useful when takeaways were empty or the classifier prompt improved.
app.post('/api/items/:id/reclassify', requireAuth(async (req, res) => {
  try {
    const item = await getItemById(req.params.id, req.userId);
    if (!item) return res.status(404).json({ error: 'not_found' });

    const text = (item.transcript || item.caption || '').trim();
    if (!text) {
      return res.status(422).json({
        error: 'no_content',
        message: 'No transcript or caption to reclassify from.'
      });
    }

    const [classified] = await processContent(text, item.source_url, [], {
      transcript: item.transcript,
      caption: item.caption
    });
    classified.sourceUrl = item.source_url;
    const itemId = await upsertItem(classified, { userId: req.userId, source: item.source });
    try {
      await embedAndStoreItem(classified, itemId, req.userId);
    } catch (err) {
      console.error('Reclassify embedding failed (item still updated):', err.message);
    }

    const refreshed = await getItemById(itemId, req.userId);
    res.json({ success: true, item: refreshed });
  } catch (err) {
    console.error('POST /api/items/:id/reclassify error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
}));

// POST /api/items/:id/linked-resources — attach a follow-up link to an existing
// item (Doc B Screen 2, the permanent replacement for the Telegram reply-to-append
// flow). Body: { url }. Extracts + classifies the link, upserts it, then returns
// the item's refreshed linked_resources so the UI can update in place.
app.post('/api/items/:id/linked-resources', requireAuth(async (req, res) => {
  const { url } = req.body || {};
  if (!url) return res.status(400).json({ error: 'url is required' });
  const userId = req.userId;
  try {
    const item = await getItemById(req.params.id, userId);
    if (!item) return res.status(404).json({ error: 'not_found' });

    let extracted = null;
    try { extracted = await extractContent(url); }
    catch (err) { console.error('Linked resource extraction failed:', err.message); }

    const processed = await processLinkedResource(extracted?.text || '', extracted?.title);
    await upsertLinkedResource(item.id, userId, {
      source_url: url,
      title: processed.title,
      type: processed.resource_type,
      body_content: processed.content
    });

    const refreshed = await getItemById(item.id, userId);
    res.json({ success: true, linked_resources: refreshed.linked_resources || [] });
  } catch (err) {
    console.error('POST /api/items/:id/linked-resources error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
}));

// Legacy capture endpoints (iOS Shortcut), now writing to Postgres.
app.post('/process-url', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'url is required' });
  if (!USER_ID) return res.status(503).json({ error: 'GRIMOIRE_USER_ID not configured' });
  try {
    const extracted = await extractContent(url);
    if (!extracted.text) return res.json({ success: false, error: 'no_transcript', message: 'No transcript available — paste text manually' });
    const saved = await runPipeline(extracted.text, url, extracted.hashtags,
      { caption: extracted.caption, transcript: extracted.transcript }, USER_ID);
    res.json({ success: true, count: saved.length, items: saved.map(i => ({ id: i.itemId, title: i.title, category: i.category, type: i.type })) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/process-text', async (req, res) => {
  const { text, source } = req.body;
  if (!text) return res.status(400).json({ error: 'text is required' });
  if (!USER_ID) return res.status(503).json({ error: 'GRIMOIRE_USER_ID not configured' });
  try {
    const saved = await runPipeline(text, source || 'manual', undefined, {}, USER_ID);
    res.json({ success: true, count: saved.length, items: saved.map(i => ({ id: i.itemId, title: i.title, category: i.category, type: i.type })) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Start Server ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  const supadata = process.env.SUPADATA_API_KEY?.trim() ? 'configured' : 'missing';
  console.log(`🔮 Grimoire running on port ${PORT} (Supadata: ${supadata})`);
});
