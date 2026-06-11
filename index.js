require('dotenv').config();
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const { extractContent } = require('./lib/extractor');
const { processContent, researchUrl, processLinkedResource } = require('./lib/classifier');
const { saveToGrimoire, appendLinkedResource } = require('./lib/drive');
const { addToRegistry, setConfirmationMessageId, findEntryByMessageId, findEntryBySourceUrl } = require('./lib/sheets');
const { initialize } = require('./lib/setup');

const app = express();
app.use(express.json());

// ─── Telegram Bot ────────────────────────────────────────────────────────────
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });

// ─── Grimoire State ──────────────────────────────────────────────────────────
let grimoire = null;

initialize()
  .then(g => { grimoire = g; })
  .catch(err => console.error('❌ Grimoire init failed:', err.message));

// ─── Core Pipeline ───────────────────────────────────────────────────────────
async function researchAndSave(sourceUrl) {
  const items = await researchUrl(sourceUrl);
  if (!items || items.length === 0) return [];
  const saved = [];
  for (const item of items) {
    item.sourceUrl = sourceUrl;
    const fileResult = await saveToGrimoire(item, grimoire);
    const rowNumber = await addToRegistry(item, sourceUrl, fileResult, grimoire.sheetId);
    saved.push({ ...item, fileResult, rowNumber });
  }
  return saved;
}

async function runPipeline(rawText, sourceUrl, hashtags) {
  const items = await processContent(rawText, sourceUrl, hashtags);
  if (!items || items.length === 0) return [];

  const saved = [];
  for (const item of items) {
    item.sourceUrl = sourceUrl;
    const fileResult = await saveToGrimoire(item, grimoire);
    const rowNumber = await addToRegistry(item, sourceUrl, fileResult, grimoire.sheetId);
    saved.push({ ...item, fileResult, rowNumber });
  }
  return saved;
}

// Send the "Saved" confirmation, then record its message_id in the Sheet so
// later replies can be matched back to these entries (survives restarts).
async function sendSavedConfirmation(chatId, saved) {
  const summary = saved.map(item =>
    `${typeEmoji(item.type)} *${item.title}*\n   ${item.category} · ${item.type}\n   ${item.summary}${item.fileResult?.webViewLink ? `\n   [Open in Drive](${item.fileResult.webViewLink})` : ''}`
  ).join('\n\n');

  let text = `✅ Saved ${saved.length} item(s) to Grimoire:\n\n${summary}`;
  if (saved.some(item => item.has_lead_magnet_cta)) {
    text += `\n\n⚠️ This post has a 'comment for link' CTA — when you receive the link, reply to this message with it and I'll attach it to this entry.`;
  }

  const confirmMsg = await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });

  try {
    await setConfirmationMessageId(grimoire.sheetId, saved.map(i => i.rowNumber), confirmMsg.message_id);
  } catch (err) {
    console.error('Failed to record confirmation message_id:', err.message);
  }
}

// Append a follow-up link's content to an already-saved entry's Drive file
async function appendToEntry(chatId, entry, url) {
  await bot.sendMessage(chatId, '🔗 Extracting linked resource...');

  let extracted = null;
  try {
    extracted = await extractContent(url);
  } catch (err) {
    console.error('Linked resource extraction failed:', err.message);
  }

  // Clean + classify before appending so we don't dump raw nav/footer/image noise
  const processed = await processLinkedResource(extracted?.text || '', extracted?.title);
  const result = await appendLinkedResource(entry.fileId, url, processed);
  await bot.sendMessage(chatId, result.replaced
    ? `🔄 Updated linked resource in ${entry.title}`
    : `🔗 Added to ${entry.title}`);
}

// ─── Telegram Handlers ───────────────────────────────────────────────────────
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id,
    `👋 Welcome to Grimoire!\n\n` +
    `Send me:\n` +
    `• A YouTube or article URL to auto-extract skills\n` +
    `• Any text (transcript, skill name, notes) to process manually\n\n` +
    `Commands:\n` +
    `/help — Show this message\n` +
    `/status — Check if Grimoire is ready`
  );
});

bot.onText(/\/help/, (msg) => {
  bot.sendMessage(msg.chat.id,
    `📖 How to use Grimoire:\n\n` +
    `*URLs*: Paste any YouTube or article link. I'll extract the content, identify all skills and insights, and save them to your Google Drive library.\n\n` +
    `*Text*: Paste a transcript, skill name, or any notes. I'll categorize and save everything.\n\n` +
    `*Multiple skills*: One message can contain many skills — I'll extract them all.\n\n` +
    `Everything lands in your Google Drive + Registry sheet automatically.`,
    { parse_mode: 'Markdown' }
  );
});

bot.onText(/\/status/, (msg) => {
  if (grimoire) {
    bot.sendMessage(msg.chat.id, '✅ Grimoire is ready and connected to Google Drive.');
  } else {
    bot.sendMessage(msg.chat.id, '⏳ Grimoire is still initializing. Try again in a moment.');
  }
});

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!text || text.startsWith('/')) return;

  if (!grimoire) {
    return bot.sendMessage(chatId, '⏳ Still initializing. Try again in 30 seconds.');
  }

  try {
    const urls = text.match(/https?:\/\/\S+/g) || [];

    // Reply to a "Saved" confirmation → append the link to the original entry
    if (msg.reply_to_message && urls.length >= 1) {
      const entry = await findEntryByMessageId(grimoire.sheetId, msg.reply_to_message.message_id);
      if (entry) {
        return await appendToEntry(chatId, entry, urls[0]);
      }
      await bot.sendMessage(chatId, `⚠️ Couldn't find the original entry for that message — saving as a new entry instead.`);
    }

    // Two-URL fallback: one URL matches an existing entry's source → append the other
    if (urls.length === 2) {
      const [entryA, entryB] = await Promise.all([
        findEntryBySourceUrl(grimoire.sheetId, urls[0]),
        findEntryBySourceUrl(grimoire.sheetId, urls[1])
      ]);
      if (entryA && !entryB) return await appendToEntry(chatId, entryA, urls[1]);
      if (entryB && !entryA) return await appendToEntry(chatId, entryB, urls[0]);
    }

    const isUrl = /^https?:\/\//i.test(text.trim());

    if (isUrl) {
      const url = text.trim();
      await bot.sendMessage(chatId, '🔗 Extracting content...');

      const extracted = await extractContent(url);

      if (!extracted.text) {
        await bot.sendMessage(chatId, '🔍 Can\'t scrape this URL directly. Researching it instead...');
        const saved = await researchAndSave(url);
        if (saved.length === 0) {
          return bot.sendMessage(chatId, '🤔 Nothing found for this URL. Try pasting content directly.');
        }
        return await sendSavedConfirmation(chatId, saved);
      }

      await bot.sendMessage(chatId, '🧠 Analyzing with Claude...');
      const saved = await runPipeline(extracted.text, url, extracted.hashtags);

      if (saved.length === 0) {
        return bot.sendMessage(chatId, '🤔 No skills or insights found in this content. Try a different source.');
      }

      await sendSavedConfirmation(chatId, saved);

    } else {
      // Manual text input
      await bot.sendMessage(chatId, '🧠 Processing...');
      const saved = await runPipeline(text, 'manual');

      if (saved.length === 0) {
        return bot.sendMessage(chatId, '🤔 Nothing extractable found. Try pasting the content directly.');
      }

      await sendSavedConfirmation(chatId, saved);
    }

  } catch (err) {
    console.error('Pipeline error:', err);
    bot.sendMessage(chatId, `❌ Error: ${err.message}`);
  }
});

function typeEmoji(type) {
  const map = { Video: '🎬', Article: '📄' };
  return map[type] || '📌';
}

// ─── REST API (optional, for iOS Shortcut) ───────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', grimoire: !!grimoire }));

app.post('/process-url', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'url is required' });
  if (!grimoire) return res.status(503).json({ error: 'Grimoire is still initializing' });

  try {
    const extracted = await extractContent(url);
    if (!extracted.text) return res.json({ success: false, error: 'no_transcript', message: 'No transcript available — paste text manually' });

    const saved = await runPipeline(extracted.text, url, extracted.hashtags);
    res.json({ success: true, count: saved.length, items: saved.map(i => ({ title: i.title, category: i.category, type: i.type })) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/process-text', async (req, res) => {
  const { text, source } = req.body;
  if (!text) return res.status(400).json({ error: 'text is required' });
  if (!grimoire) return res.status(503).json({ error: 'Grimoire is still initializing' });

  try {
    const saved = await runPipeline(text, source || 'manual');
    res.json({ success: true, count: saved.length, items: saved.map(i => ({ title: i.title, category: i.category, type: i.type })) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Start Server ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🔮 Grimoire running on port ${PORT}`));
