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
      interval: config.telegram.pollingInterval || 5000,
      autoStart: true,
      params: {
        timeout: 10,
        drop_pending_updates: true,
      },
    },
  });

  activeBotInstance = bot;
  bseNseMonitor.setBotInstance(bot);

  console.log(`[TelegramBot] Bot initialized cleanly.`);

  // Register active chat IDs with bseNseMonitor
  const registerChatId = msg => {
    if (msg && msg.chat && msg.chat.id) {
      bseNseMonitor.addActiveChatId(msg.chat.id.toString());
    }
  };

  // 1. Handle /start and /help commands
  bot.onText(/\/(start|help)/, async msg => {
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
  });

  // 2. Handle incoming direct Photos / Screenshots
  bot.on('photo', async msg => {
    registerChatId(msg);
    console.log(`[TelegramBot] Direct photo received from Chat ID: ${msg.chat.id}`);
    await handleScreenshot(bot, msg);
  });

  // 3. Handle direct messages
  bot.on('message', async msg => {
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
  });

  // 4. Handle Inline Keyboard Callbacks (CONFIRM / CANCEL 1-Click Buy Buttons)
  bot.on('callback_query', async callbackQuery => {
    console.log(`[TelegramBot] Callback Query received: ${callbackQuery.data}`);
    await handleOrderConfirmation(bot, callbackQuery);
  });

  // 5. Handle Polling & Network Errors
  const handleBotError = (errType, error) => {
    const msg = error?.message || String(error || '');
    const code = error?.code || error?.name || '';

    if (msg.includes('404')) {
      console.error(`[TelegramBot] Polling error: 404 Not Found. Make sure TELEGRAM_BOT_TOKEN in .env is correct and restart the server.`);
    } else if (msg.includes('409')) {
      console.warn(`[TelegramBot] Notice: 409 Conflict - Another bot instance is active (e.g. Render deploy or local server). Polling will auto-resume.`);
    } else if (msg.includes('EFATAL') || msg.includes('AggregateError') || code === 'EFATAL' || code === 'ETIMEDOUT' || code === 'ECONNRESET' || code === 'ENOTFOUND') {
      console.warn(`[TelegramBot] Transient network notice: Long-polling connection reset (${code || 'AggregateError'}). Auto-reconnecting...`);
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
