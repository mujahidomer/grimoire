require('dotenv').config();
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const { extractContent } = require('./lib/extractor');
const { processContent, researchUrl } = require('./lib/classifier');
const { saveToGrimoire } = require('./lib/drive');
const { addToRegistry } = require('./lib/sheets');
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
    const fileResult = await saveToGrimoire(item, grimoire);
    await addToRegistry(item, sourceUrl, fileResult, grimoire.sheetId);
    saved.push(item);
  }
  return saved;
}

async function runPipeline(rawText, sourceUrl) {
  const items = await processContent(rawText, sourceUrl);
  if (!items || items.length === 0) return [];

  const saved = [];
  for (const item of items) {
    const fileResult = await saveToGrimoire(item, grimoire);
    await addToRegistry(item, sourceUrl, fileResult, grimoire.sheetId);
    saved.push({ ...item, fileResult });
  }
  return saved;
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
        const summary = saved.map(item =>
          `${typeEmoji(item.type)} *${item.skillName}*\n   ${item.type} / ${item.category}\n   ${item.description}${item.fileResult?.webViewLink ? `\n   [Open in Drive](${item.fileResult.webViewLink})` : ''}`
        ).join('\n\n');
        return bot.sendMessage(chatId, `✅ Saved ${saved.length} item(s) to Grimoire:\n\n${summary}`, { parse_mode: 'Markdown' });
      }

      await bot.sendMessage(chatId, '🧠 Analyzing with Claude...');
      const saved = await runPipeline(extracted.text, url);

      if (saved.length === 0) {
        return bot.sendMessage(chatId, '🤔 No skills or insights found in this content. Try a different source.');
      }

      const summary = saved.map(item =>
        `${typeEmoji(item.type)} *${item.skillName}*\n   ${item.type} / ${item.category}\n   ${item.description}${item.fileResult?.webViewLink ? `\n   [Open in Drive](${item.fileResult.webViewLink})` : ''}`
      ).join('\n\n');

      bot.sendMessage(chatId, `✅ Saved ${saved.length} item(s) to Grimoire:\n\n${summary}`, { parse_mode: 'Markdown' });

    } else {
      // Manual text input
      await bot.sendMessage(chatId, '🧠 Processing...');
      const saved = await runPipeline(text, 'manual');

      if (saved.length === 0) {
        return bot.sendMessage(chatId, '🤔 Nothing extractable found. Try being more specific about the skill or technique.');
      }

      const summary = saved.map(item =>
        `${typeEmoji(item.type)} *${item.skillName}*\n   ${item.type} / ${item.category}\n   ${item.description}${item.fileResult?.webViewLink ? `\n   [Open in Drive](${item.fileResult.webViewLink})` : ''}`
      ).join('\n\n');

      bot.sendMessage(chatId, `✅ Saved ${saved.length} item(s) to Grimoire:\n\n${summary}`, { parse_mode: 'Markdown' });
    }

  } catch (err) {
    console.error('Pipeline error:', err);
    bot.sendMessage(chatId, `❌ Error: ${err.message}`);
  }
});

function typeEmoji(type) {
  const map = { skill: '⚙️', markdown: '📝', agent: '🤖', insight: '💡' };
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

    const saved = await runPipeline(extracted.text, url);
    res.json({ success: true, count: saved.length, items: saved.map(i => ({ name: i.skillName, type: i.type, category: i.category })) });
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
    res.json({ success: true, count: saved.length, items: saved.map(i => ({ name: i.skillName, type: i.type, category: i.category })) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Start Server ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🔮 Grimoire running on port ${PORT}`));
