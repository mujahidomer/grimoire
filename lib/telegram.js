const TelegramBot = require('node-telegram-bot-api');

// Telegram allows only one active getUpdates connection per bot token. Local dev
// and Railway production share the same token, so polling must be opt-in per
// process. Production defaults on; local dev defaults off (see dev-local.sh).
function shouldEnablePolling() {
  const explicit = process.env.TELEGRAM_POLLING?.trim().toLowerCase();
  if (explicit === 'true') return true;
  if (explicit === 'false') return false;
  return process.env.NODE_ENV === 'production';
}

async function initTelegramBot() {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) {
    console.log('Telegram bot: TELEGRAM_BOT_TOKEN not set — capture disabled');
    return null;
  }

  if (!shouldEnablePolling()) {
    console.log(
      'Telegram bot: polling disabled on this instance ' +
      '(set TELEGRAM_POLLING=true to test locally; only one instance can poll at a time)'
    );
    return null;
  }

  const bot = new TelegramBot(token, { polling: false });

  // Clear any webhook so polling can attach cleanly.
  await bot.deleteWebHook({ drop_pending_updates: false });
  await bot.startPolling({ restart: false });

  let conflictLogged = false;
  bot.on('polling_error', (err) => {
    const message = String(err?.message || err);
    const isConflict = err?.code === 'ETELEGRAM' && /409|getUpdates/.test(message);
    if (isConflict) {
      if (!conflictLogged) {
        conflictLogged = true;
        console.error(
          'Telegram bot: 409 conflict — another instance is already polling this token. ' +
          'Stopping polling here. Disable TELEGRAM_POLLING on duplicate deployments.'
        );
        bot.stopPolling({ cancel: true }).catch(() => {});
      }
      return;
    }
    console.error('Telegram polling error:', message);
  });

  console.log('Telegram bot: polling started');
  return bot;
}

module.exports = { initTelegramBot, shouldEnablePolling };
