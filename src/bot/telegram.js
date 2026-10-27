const TelegramBot = require('node-telegram-bot-api');
const config = require('../config');
const { handleScreenshot } = require('./screenshotHandler');
const { handleOrderConfirmation } = require('./orderConfirmation');
const signalParser = require('../parser/signalParser');
const bseNseMonitor = require('../services/ingestion/bseNseMonitor');

let activeBotInstance = null;

/**
 * Initialize Telegram Bot & Inline Button Handlers
 * Direct messaging & BSE/NSE live broadcast bot (Channel post listener removed per request).
 */
function initTelegramBot() {
  if (!config.telegram.botToken) {
    console.warn('[TelegramBot] TELEGRAM_BOT_TOKEN not found in environment. Telegram bot listener disabled.');
    return null;
  }

  if (activeBotInstance) {
    try {
      activeBotInstance.stopPolling();
    } catch (_) {}
  }

  const maskedToken = config.telegram.botToken.length > 10 
    ? `${config.telegram.botToken.slice(0, 5)}...${config.telegram.botToken.slice(-6)}` 
    : config.telegram.botToken;
  console.log(`[TelegramBot] Initializing bot with token: ${maskedToken}`);

  const bot = new TelegramBot(config.telegram.botToken, {
    polling: {
      interval: 2000,
      autoStart: true,
      params: {
        timeout: 30,
        drop_pending_updates: false,
      },
    },
    request: {
      agentOptions: {
        keepAlive: true,
        keepAliveMsecs: 10000, // Send TCP Keep-Alive probes every 10s to prevent NAT socket freeze
      },
    },
  });

  activeBotInstance = bot;
  bseNseMonitor.setBotInstance(bot);

  // Safe Watchdog: Verifies polling is running without destructive idle socket termination
  if (!bot._watchdogTimer) {
    bot._watchdogTimer = setInterval(() => {
      try {
        if (!bot.isPolling()) {
          console.warn(`[TelegramBot Watchdog] Polling stopped. Restarting bot polling...`);
          bot.startPolling({ restart: true }).catch(err => {
            console.warn(`[TelegramBot Watchdog] Restart polling notice: ${err.message}`);
          });
        }
      } catch (err) {
        console.warn(`[TelegramBot Watchdog] Notice: ${err.message}`);
      }
    }, 30000);
  }

  console.log(`[TelegramBot] Bot initialized cleanly with TCP Keep-Alive & Non-destructive Watchdog.`);

  // Register active chat IDs with bseNseMonitor
  const registerChatId = msg => {
    if (msg && msg.chat && msg.chat.id) {
      bseNseMonitor.addActiveChatId(msg.chat.id.toString());
    }
  };

  // 1. Handle /start and /help commands
  bot.onText(/\/(start|help)/, async msg => {
    try {
      registerChatId(msg);
      const chatId = msg.chat.id;
      const helpMsg =
        `🤖 *Telegram Stock Trading Assistant*\n\n` +
        `Mode: \`${config.tradingMode}\`\n` +
        `Auto-Execute: \`${config.telegram.autoExecute}\`\n\n` +
        `*Features:*\n` +
        `⚡ *BSE/NSE 24/7 Live Earnings Broadcasting*\n` +
        `📊 *Gemini Flash Quantitative Scorecards*\n` +
        `⚡ *1-Click Direct Order Execution on Angel One*`;
      await bot.sendMessage(chatId, helpMsg, { parse_mode: 'Markdown' });
    } catch (err) {
      console.error(`[TelegramBot] Error handling /start or /help command: ${err.message}`);
    }
  });

  // 2. Handle incoming direct Photos / Screenshots
  bot.on('photo', async msg => {
    try {
      registerChatId(msg);
      console.log(`[TelegramBot] Direct photo received from Chat ID: ${msg.chat.id}`);
      await handleScreenshot(bot, msg);
    } catch (err) {
      console.error(`[TelegramBot] Error handling photo message: ${err.message}`);
    }
  });

  // 3. Handle direct messages
  bot.on('message', async msg => {
    try {
      registerChatId(msg);
      if (msg.photo || (msg.text && msg.text.startsWith('/'))) return;

      if (msg.text || msg.caption) {
        const textToParse = msg.text || msg.caption;
        const parsed = signalParser.parse(textToParse);
        if (parsed.isParsed) {
          console.log(`[TelegramBot] Signal parsed from Chat ID ${msg.chat.id}: ${parsed.action} ${parsed.symbol} @ ${parsed.entry}`);
          await handleScreenshot(bot, msg);
        }
      }
    } catch (err) {
      console.error(`[TelegramBot] Error handling text message: ${err.message}`);
    }
  });

  // 4. Handle Inline Keyboard Callbacks (CONFIRM / CANCEL 1-Click Buy Buttons)
  bot.on('callback_query', async callbackQuery => {
    try {
      console.log(`[TelegramBot] Callback Query received: ${callbackQuery.data}`);
      await handleOrderConfirmation(bot, callbackQuery);
    } catch (err) {
      console.error(`[TelegramBot] Error handling callback query: ${err.message}`);
    }
  });

  let last409LogTime = 0;

  // 5. Handle Polling & Network Errors safely
  const handleBotError = (errType, error) => {
    const msg = error?.message || String(error || '');
    const code = error?.code || error?.name || '';

    if (msg.includes('404')) {
      console.error(`[TelegramBot] Polling error: 404 Not Found. Make sure TELEGRAM_BOT_TOKEN in .env is correct.`);
    } else if (msg.includes('409')) {
      const now = Date.now();
      if (now - last409LogTime > 60000) {
        last409LogTime = now;
        console.warn(`[TelegramBot] Notice: 409 Conflict - Another bot instance is active (e.g. Render deploy or local server).`);
      }
    } else if (msg.includes('EFATAL') || msg.includes('AggregateError') || code === 'EFATAL' || code === 'ETIMEDOUT' || code === 'ECONNRESET' || code === 'ENOTFOUND') {
      console.warn(`[TelegramBot] Transient network notice: Long-polling connection reset (${code || 'AggregateError'}). Auto-reconnecting...`);
      if (!bot.isPolling()) {
        setTimeout(() => {
          bot.startPolling({ restart: true }).catch(() => {});
        }, 2000);
      }
    } else {
      console.error(`[TelegramBot] ${errType} error: ${msg}`);
    }
  };

  bot.on('polling_error', error => handleBotError('Polling', error));
  bot.on('error', error => handleBotError('Bot', error));
  bot.on('webhook_error', error => handleBotError('Webhook', error));

  return bot;
}

module.exports = { initTelegramBot };

