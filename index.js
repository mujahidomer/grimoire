require('dotenv').config();
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const { extractContent } = require('./lib/extractor');
const { processContent, researchUrl, processLinkedResource } = require('./lib/classifier');
const { normalizeTagsPg } = require('./lib/tags-pg');
const {
  upsertItem, upsertItemTags, upsertLinkedResource, findItemBySourceUrl
} = require('./lib/repository');
const { embedAndStoreItem } = require('./lib/embeddings');
const { registerApiRoutes } = require('./lib/routes');
const { defaultUserId } = require('./lib/supabase');

const app = express();
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
async function saveItem(item, sourceUrl) {
  item.sourceUrl = sourceUrl;

  let finalTags = Array.isArray(item.tags) ? item.tags : [];
  finalTags = await normalizeTagsPg(finalTags, USER_ID);
  item.tags = finalTags;

  const itemId = await upsertItem(item, { userId: USER_ID, source: item.source || 'telegram' });
  await upsertItemTags(itemId, USER_ID, finalTags);

  for (const lr of Array.isArray(item.linked_resources) ? item.linked_resources : []) {
    if (typeof lr === 'string') await upsertLinkedResource(itemId, USER_ID, { source_url: lr });
    else await upsertLinkedResource(itemId, USER_ID, lr);
  }

  try {
    await embedAndStoreItem(item, itemId, USER_ID);
  } catch (err) {
    console.error('Embedding failed (item still saved):', err.message);
  }

  return { itemId, title: item.title, category: item.category, type: item.type,
    summary: item.summary, has_lead_magnet_cta: item.has_lead_magnet_cta };
}

async function researchAndSave(sourceUrl) {
  const items = await researchUrl(sourceUrl);
  if (!items || items.length === 0) return [];
  const saved = [];
  for (const item of items) saved.push(await saveItem(item, sourceUrl));
  return saved;
}

async function runPipeline(rawText, sourceUrl, hashtags, parts = {}) {
  const items = await processContent(rawText, sourceUrl, hashtags, parts);
  if (!items || items.length === 0) return [];
  const saved = [];
  for (const item of items) saved.push(await saveItem(item, sourceUrl));
  return saved;
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
      const extracted = await extractContent(url);

      if (!extracted.text) {
        await bot.sendMessage(chatId, '🔍 Can\'t scrape this URL directly. Researching it instead...');
        const saved = await researchAndSave(url);
        if (saved.length === 0) return bot.sendMessage(chatId, '🤔 Nothing found for this URL. Try pasting content directly.');
        return await sendSavedConfirmation(chatId, saved);
      }

      await bot.sendMessage(chatId, '🧠 Analyzing with Claude...');
      const saved = await runPipeline(extracted.text, url, extracted.hashtags, { caption: extracted.caption, transcript: extracted.transcript });
      if (saved.length === 0) return bot.sendMessage(chatId, '🤔 No skills or insights found in this content. Try a different source.');
      await sendSavedConfirmation(chatId, saved);

    } else {
      await bot.sendMessage(chatId, '🧠 Processing...');
      const saved = await runPipeline(text, 'manual');
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

// Legacy capture endpoints (iOS Shortcut), now writing to Postgres.
app.post('/process-url', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'url is required' });
  if (!USER_ID) return res.status(503).json({ error: 'GRIMOIRE_USER_ID not configured' });
  try {
    const extracted = await extractContent(url);
    if (!extracted.text) return res.json({ success: false, error: 'no_transcript', message: 'No transcript available — paste text manually' });
    const saved = await runPipeline(extracted.text, url, extracted.hashtags, { caption: extracted.caption, transcript: extracted.transcript });
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
    const saved = await runPipeline(text, source || 'manual');
    res.json({ success: true, count: saved.length, items: saved.map(i => ({ id: i.itemId, title: i.title, category: i.category, type: i.type })) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Start Server ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🔮 Grimoire running on port ${PORT}`));
