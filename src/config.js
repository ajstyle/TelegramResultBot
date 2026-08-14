require('dotenv').config({ override: true });

const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  tradingMode: (process.env.TRADING_MODE || 'PAPER').toUpperCase(), // PAPER or LIVE

  mongoUri: process.env.MONGODB_URI || 'mongodb://localhost:27017/telegram_trading_bot',

  telegram: {
    botToken: (process.env.TELEGRAM_BOT_TOKEN || '').trim(),
    authorizedChatIds: (process.env.AUTHORIZED_TELEGRAM_CHAT_IDS || '')
      .split(',')
      .map(id => id.trim())
      .map(id => (id && !id.startsWith('@') && !id.startsWith('-') && !/^-?\d+$/.test(id) ? `@${id}` : id))
      .filter(Boolean),
    targetChannel: (() => {
      const raw = (process.env.TARGET_TELEGRAM_CHANNEL || '').trim();
      if (!raw) return '';
      return (raw.startsWith('@') || raw.startsWith('-') || /^-?\d+$/.test(raw)) ? raw : `@${raw}`;
    })(),
    pollingInterval: parseInt(process.env.POLLING_INTERVAL_MS || '5000', 10),
    autoExecute: process.env.AUTO_EXECUTE_ORDER === 'true',
  },

  angelOne: {
    apiKey: process.env.ANGEL_API_KEY || '',
    clientCode: process.env.ANGEL_CLIENT_CODE || '',
    pin: process.env.ANGEL_PIN || '',
    totpSecret: process.env.ANGEL_TOTP_SECRET || '',
    baseUrl: 'https://apiconnect.angelone.in',
  },

  risk: {
    accountCapital: parseFloat(process.env.ACCOUNT_CAPITAL || '100000'),
    riskPerTrade: parseFloat(process.env.RISK_PER_TRADE || '0.01'),
    atrMultiplier: parseFloat(process.env.ATR_MULTIPLIER || '2'),
    atrPeriod: parseInt(process.env.ATR_PERIOD || '14', 10),
  },

  ocr: {
    confidenceThreshold: parseFloat(process.env.OCR_CONFIDENCE_THRESHOLD || '60'),
  },

  fundamentals: {
    apiKey: process.env.FUNDAMENTALS_API_KEY || '',
    apiUrl: process.env.FUNDAMENTALS_API_URL || '',
  },

  geminiApiKey: process.env.GEMINI_API_KEY || process.env.GEMINI_KEY || '',
};

/**
 * Validate configuration settings
 */
config.validate = function () {
  const warnings = [];
  if (config.tradingMode === 'LIVE') {
    if (!config.angelOne.apiKey || !config.angelOne.clientCode || !config.angelOne.pin || !config.angelOne.totpSecret) {
      warnings.push('LIVE trading mode is enabled, but Angel One credentials are incomplete!');
    }
  }

  if (!config.telegram.botToken && config.nodeEnv !== 'test') {
    warnings.push('TELEGRAM_BOT_TOKEN is missing! Telegram listener will not receive incoming messages.');
  }

  return warnings;
};

module.exports = config;
