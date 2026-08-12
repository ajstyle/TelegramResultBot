const TelegramBot = require('node-telegram-bot-api');
const config = require('../config');
const { handleScreenshot } = require('./screenshotHandler');
const { handleOrderConfirmation } = require('./orderConfirmation');
const signalParser = require('../parser/signalParser');
const bseNseMonitor = require('../services/ingestion/bseNseMonitor');

/**
 * Initialize Telegram Listener & Event Handlers
 */
function initTelegramBot() {
  if (!config.telegram.botToken) {
    console.warn('[TelegramBot] TELEGRAM_BOT_TOKEN not found in environment. Telegram bot listener disabled.');
    return null;
  }

  const maskedToken = config.telegram.botToken.length > 10 
    ? `${config.telegram.botToken.slice(0, 5)}...${config.telegram.botToken.slice(-6)}` 
    : config.telegram.botToken;
  console.log(`[TelegramBot] Initializing bot with token: ${maskedToken}`);

  // Configure polling interval (5000ms = 5 seconds)
  const bot = new TelegramBot(config.telegram.botToken, {
    polling: {
      interval: config.telegram.pollingInterval || 5000,
      autoStart: true,
      params: { timeout: 10 },
    },
  });

  bseNseMonitor.setBotInstance(bot);

  console.log(`[TelegramBot] Listener started with polling (Interval: ${config.telegram.pollingInterval || 5000}ms)...`);
  if (config.telegram.targetChannel) {
    console.log(`[TelegramBot] Target Channel Filtering Active: "${config.telegram.targetChannel.toUpperCase()}"`);
  }

  const isTargetChannelMessage = msg => {
    // Always allow private direct messages to the bot
    if (msg && msg.chat && msg.chat.type === 'private') return true;

    if (!config.telegram.targetChannel) return true;
    const target = config.telegram.targetChannel.toLowerCase().replace(/^@/, '');

    const chatUsername = (msg.chat.username || '').toLowerCase().replace(/^@/, '');
    const chatTitle = (msg.chat.title || '').toLowerCase().replace(/^@/, '');
    const fwdUsername = (msg.forward_from_chat?.username || '').toLowerCase().replace(/^@/, '');
    const fwdTitle = (msg.forward_from_chat?.title || '').toLowerCase().replace(/^@/, '');

    return (
      chatUsername.includes(target) ||
      chatTitle.includes(target) ||
      fwdUsername.includes(target) ||
      fwdTitle.includes(target)
    );
  };

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
      `Target Channel: \`${config.telegram.targetChannel || 'ALL'}\`\n` +
      `Auto-Execute: \`${config.telegram.autoExecute}\`\n\n` +
      `*How to use:*\n` +
      `1. Send a recommendation screenshot or message containing a trade signal.\n` +
      `2. Messages from channel \`${config.telegram.targetChannel || 'ANY'}\` are automatically ingested every 5 seconds.`;
    await bot.sendMessage(chatId, helpMsg, { parse_mode: 'Markdown' });
  });

  // 2. Handle incoming Photos (Direct message, Group, or Channel)
  bot.on('photo', async msg => {
    registerChatId(msg);
    if (!isTargetChannelMessage(msg)) return;
    console.log(`[TelegramBot] Photo received from Chat ID: ${msg.chat.id}`);
    await handleScreenshot(bot, msg);
  });

  // 3. Handle incoming Text Signals
  bot.on('message', async msg => {
    registerChatId(msg);
    if (msg.photo || (msg.text && msg.text.startsWith('/'))) return;
    if (!isTargetChannelMessage(msg)) return;

    if (msg.text || msg.caption) {
      const textToParse = msg.text || msg.caption;
      const parsed = signalParser.parse(textToParse);
      if (parsed.isParsed) {
        console.log(`[TelegramBot] Signal parsed from Chat ID ${msg.chat.id}: ${parsed.action} ${parsed.symbol} @ ${parsed.entry}`);
        await handleScreenshot(bot, msg);
      }
    }
  });

  // 4. Handle incoming Telegram Channel Posts
  bot.on('channel_post', async msg => {
    registerChatId(msg);
    if (!isTargetChannelMessage(msg)) return;
    console.log(`[TelegramBot] Channel Post received from Channel: ${msg.chat.title || msg.chat.username || msg.chat.id}`);
    const textToParse = msg.text || msg.caption || '';
    if (msg.photo || textToParse.length > 0) {
      await handleScreenshot(bot, msg);
    }
  });

  // 4. Handle Inline Keyboard Callbacks (CONFIRM / CANCEL buttons)
  bot.on('callback_query', async callbackQuery => {
    console.log(`[TelegramBot] Callback Query received: ${callbackQuery.data}`);
    await handleOrderConfirmation(bot, callbackQuery);
  });

  // 5. Handle Polling Errors
  bot.on('polling_error', error => {
    if (error.message && error.message.includes('404')) {
      console.error(`[TelegramBot] Polling error: 404 Not Found. Make sure TELEGRAM_BOT_TOKEN in .env is correct and restart the server.`);
    } else {
      console.error(`[TelegramBot] Polling error: ${error.message}`);
    }
  });

  return bot;
}

module.exports = { initTelegramBot };
