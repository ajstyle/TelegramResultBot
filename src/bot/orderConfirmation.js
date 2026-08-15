const tradeStore = require('../services/tradeStore');
const angelOne = require('../services/angelOne');
const zerodhaKite = require('../services/zerodhaKite');
const config = require('../config');

/**
 * Safely answer Telegram Callback Query without throwing on expired query IDs
 */
async function safeAnswerCallback(bot, callbackId, options = {}) {
  try {
    await bot.answerCallbackQuery(callbackId, options);
  } catch (_) {
    // Gracefully catch expired query timeouts
  }
}

/**
 * Safely edit Telegram message whether it is a photo caption or a plain text message
 */
async function safeEditMessage(bot, message, newText, extraOptions = {}) {
  if (!bot || !message) return;
  const options = {
    chat_id: message.chat.id,
    message_id: message.message_id,
    parse_mode: 'Markdown',
    ...extraOptions,
  };

  const isPhotoOrCaption = Boolean(message.photo || message.caption !== undefined || !message.text);
  const captionText = newText.length > 1000 ? `${newText.substring(0, 995)}...` : newText;

  if (isPhotoOrCaption) {
    try {
      await bot.editMessageCaption(captionText, options);
    } catch (_) {
      try {
        await bot.editMessageText(newText, options);
      } catch (_) {}
    }
  } else {
    try {
      await bot.editMessageText(newText, options);
    } catch (_) {
      try {
        await bot.editMessageCaption(captionText, options);
      } catch (_) {}
    }
  }

  // Explicitly update reply_markup if provided in extraOptions to guarantee inline button rendering
  if (extraOptions.reply_markup) {
    try {
      await bot.editMessageReplyMarkup(extraOptions.reply_markup, {
        chat_id: message.chat.id,
        message_id: message.message_id,
      });
    } catch (_) {}
  }
}

/**
 * Handle trade execution confirmation from Telegram Callback Query
 * @param {object} bot TelegramBot instance
 * @param {object} callbackQuery Telegram callback query event
 */
async function handleOrderConfirmation(bot, callbackQuery) {
  const { id: callbackId, data, from, message } = callbackQuery;
  const chatId = message.chat.id.toString();
  const userId = from.id.toString();

  // 1. Authorization check
  const isAuthorized =
    config.telegram.authorizedChatIds.length === 0 ||
    config.telegram.authorizedChatIds.includes(chatId) ||
    config.telegram.authorizedChatIds.includes(userId);

  if (!isAuthorized) {
    await safeAnswerCallback(bot, callbackId, {
      text: '⛔ Unauthorized! Your Telegram user/chat ID is not in AUTHORIZED_TELEGRAM_CHAT_IDS.',
      show_alert: true,
    });
    return;
  }

  // Action can be CANCEL_<tradeId>
  if (data.startsWith('CANCEL_')) {
    const tradeId = data.replace('CANCEL_', '');
    try {
      const trade = await tradeStore.findById(tradeId);
      if (trade) {
        trade.status = 'CANCELLED';
        await trade.save();
      }
      await safeAnswerCallback(bot, callbackId, { text: 'Trade cancelled.' });
      await safeEditMessage(bot, message, `❌ *TRADE CANCELLED*\n\nTrade ID \`${tradeId}\` was cancelled by user.`);
    } catch (err) {
      await safeAnswerCallback(bot, callbackId, { text: `Error: ${err.message}`, show_alert: true });
    }
    return;
  }

  if (!data.startsWith('CONFIRM_') && !data.startsWith('CONFIRM_ANGEL_') && !data.startsWith('CONFIRM_KITE_')) {
    return;
  }

  const isKiteOrder = data.startsWith('CONFIRM_KITE_');
  const tradeId = data.replace('CONFIRM_KITE_', '').replace('CONFIRM_ANGEL_', '').replace('CONFIRM_', '');

  try {
    // 2. Validation & Status check with Dynamic Fallback
    let trade = await tradeStore.findById(tradeId);

    // Dynamic Fallback: If trade record is missing (e.g. after server restart or DB offline)
    if (!trade && message) {
      const btnTexts = message.reply_markup?.inline_keyboard?.flat().map(b => b.text).join(' ') || '';
      const msgText = `${message.caption || ''} ${message.text || ''} ${btnTexts}`;
      
      // 1. Extract Symbol from Hashtag (#PURVA), Button Text (ZERODHA KITE (PURVA)), or Caption
      const symbolFromTag = msgText.match(/#([A-Z0-9_-]+)/i);
      const symbolFromBtn = msgText.match(/(?:ANGEL ONE|ZERODHA KITE)\s*\(([^)]+)\)/i);
      let symbol = symbolFromTag ? symbolFromTag[1].toUpperCase() : (symbolFromBtn ? symbolFromBtn[1].toUpperCase().split(' ')[0] : null);

      if (symbol) {
        symbol = symbol.replace(/LTD$|LIMITED$|INDUSTRIES$/i, '').trim();
      }

      // 2. Extract Price (CMP or Entry)
      const cmpMatch = msgText.match(/CMP\s*:\s*₹?\s*([\d.,]+)/i);
      const entryMatch = msgText.match(/Entry\s*:\s*₹?\s*([\d.,]+)/i);
      const priceMatch = msgText.match(/₹\s*([\d.,]+)/i);

      let entry = null;
      if (entryMatch) entry = parseFloat(entryMatch[1].replace(/,/g, ''));
      else if (cmpMatch) entry = parseFloat(cmpMatch[1].replace(/,/g, ''));
      else if (priceMatch) entry = parseFloat(priceMatch[1].replace(/,/g, ''));

      // If price is missing from caption, fetch live price dynamically
      if (symbol && (!entry || isNaN(entry) || entry <= 0)) {
        try {
          const zerodhaKite = require('../services/zerodhaKite');
          const kiteLtp = await zerodhaKite.getLTP(symbol);
          if (kiteLtp && kiteLtp > 0) entry = kiteLtp;
        } catch (_) {}
      }

      if (symbol && (!entry || isNaN(entry) || entry <= 0)) {
        try {
          const fundamentalsProvider = require('../services/fundamentals/provider');
          entry = await fundamentalsProvider.fetchLivePrice(symbol);
        } catch (_) {}
      }

      if (!entry || isNaN(entry) || entry <= 0) {
        entry = 100; // Fail-safe default price
      }

      const slMatch = msgText.match(/SL\s*:\s*₹?\s*([\d.,]+)/i);
      const qtyMatch = msgText.match(/Qty\s*:\s*(\d+)/i);

      if (symbol && entry && entry > 0) {
        const stopLoss = slMatch ? parseFloat(slMatch[1].replace(/,/g, '')) : parseFloat((entry * 0.98).toFixed(2));
        
        let quantity = qtyMatch ? parseInt(qtyMatch[1], 10) : 1;
        if (!qtyMatch) {
          try {
            const riskEngine = require('../services/riskEngine');
            const capital = config.risk?.accountCapital || 100000;
            const riskPerTrade = config.risk?.riskPerTrade || 2000;
            const sizeResult = riskEngine.calculatePositionSize(entry, stopLoss, capital, riskPerTrade);
            quantity = sizeResult.quantity > 0 ? sizeResult.quantity : Math.max(1, Math.floor(10000 / entry));
          } catch (_) {
            quantity = Math.max(1, Math.floor(10000 / entry));
          }
        }

        trade = {
          _id: tradeId,
          symbol,
          action: 'BUY',
          entry,
          stopLoss,
          quantity,
          status: 'ANALYZED',
          isDynamicFallback: true,
          save: async function () { return this; },
        };

        try {
          await tradeStore.createTrade(trade);
        } catch (_) {}

        console.log(`[OrderConfirmation] Dynamically reconstructed trade for ${symbol} @ ₹${entry} (SL: ₹${stopLoss}, Qty: ${quantity})`);
      }
    }

    if (!trade) {
      await safeAnswerCallback(bot, callbackId, {
        text: '❌ Trade parameters could not be resolved from message. Order placement aborted.',
        show_alert: true,
      });
      return;
    }

    // 3. Duplicate execution check
    if (trade.status !== 'ANALYZED' && trade.status !== 'REJECTED') {
      await safeAnswerCallback(bot, callbackId, {
        text: `⚠️ Order is already placed for '${trade.symbol}' (Status: ${trade.status}).`,
        show_alert: true,
      });
      return;
    }

    // 4. Pre-flight parameter checks
    if (!trade.quantity || trade.quantity <= 0) {
      await safeAnswerCallback(bot, callbackId, {
        text: '❌ Invalid order quantity (0). Order placement aborted.',
        show_alert: true,
      });
      return;
    }

    if (!trade.entry || !trade.stopLoss) {
      await safeAnswerCallback(bot, callbackId, {
        text: '❌ Missing Entry or Stop Loss values. Order placement aborted.',
        show_alert: true,
      });
      return;
    }

    let orderResult;
    let brokerName = 'Angel One';

    if (isKiteOrder) {
      brokerName = 'Zerodha Kite';
      console.log(`[OrderConfirmation] Submitting ${trade.action} order for ${trade.symbol} on Zerodha Kite...`);
      try {
        orderResult = await zerodhaKite.placeOrder({
          symbol: trade.symbol,
          action: trade.action,
          quantity: trade.quantity,
          price: trade.entry,
          product: 'MIS',
          orderType: 'MARKET',
        });
      } catch (err) {
        orderResult = { success: false, message: err.message };
      }
    } else {
      // Angel One Execution
      const scripInfo = await angelOne.searchScrip(trade.symbol, 'NSE');
      const isCautionary = angelOne.isCautionaryStock(trade.symbol, scripInfo);
      const productType = isCautionary ? 'DELIVERY' : 'INTRADAY';

      console.log(`[OrderConfirmation] Submitting ${trade.action} order for ${trade.symbol} on Angel One (Product: ${productType})...`);

      orderResult = await angelOne.placeOrder({
        tradingsymbol: scripInfo.tradingsymbol,
        symboltoken: scripInfo.symboltoken,
        transactiontype: trade.action,
        quantity: trade.quantity,
        price: trade.entry,
        orderType: 'LIMIT',
        productType,
        exchange: 'NSE',
      });
    }

    if (orderResult.success) {
      trade.status = 'ORDER_PLACED';
      trade.broker = brokerName;
      trade.orderId = orderResult.orderId;
      await trade.save();

      const modeBadge = config.tradingMode === 'PAPER' ? '📝 [PAPER TRADING]' : '⚡ [LIVE TRADING]';

      const successMsg =
        `${modeBadge} *ORDER PLACED SUCCESSFULLY (${brokerName.toUpperCase()})*\n\n` +
        `*Stock:* ${trade.symbol}\n` +
        `*Broker:* ${brokerName}\n` +
        `*Action:* ${trade.action}\n` +
        `*Quantity:* ${trade.quantity}\n` +
        `*Price:* ₹${trade.entry}\n` +
        `*Calculated SL:* ₹${trade.stopLoss}\n` +
        `*Order ID:* \`${orderResult.orderId}\`\n\n` +
        `ℹ️ *Order Status:* Submitted to ${brokerName}. Check broker app for execution status.\n\n` +
        `✅ Trade Record Updated: \`${trade._id}\``;

      await safeEditMessage(bot, message, successMsg);
    } else {
      trade.status = 'REJECTED';
      await trade.save().catch(() => {});

      const retryKeyboard = {
        inline_keyboard: [
          [
            { text: `🔄 RETRY BUY ON ZERODHA KITE (${trade.symbol})`, callback_data: `CONFIRM_KITE_${trade._id}` },
          ],
          [
            { text: '❌ CANCEL', callback_data: `CANCEL_${trade._id}` },
          ]
        ],
      };

      const failMsg =
        `❌ *ORDER PLACEMENT REJECTED (${brokerName.toUpperCase()})*\n\n` +
        `*Stock:* ${trade.symbol}\n` +
        `*Broker:* ${brokerName}\n` +
        `*Reason:* ${orderResult.message || 'Order failed'}\n` +
        `*Trade ID:* \`${trade._id}\`\n\n` +
        `👇 *Click button below to Retry Buy:*`;

      await safeEditMessage(bot, message, failMsg, { reply_markup: retryKeyboard });
    }
  } catch (error) {
    console.error(`[OrderConfirmation] Error processing trade confirmation: ${error.message}`);
    await safeAnswerCallback(bot, callbackId, {
      text: `Error: ${error.message}`,
      show_alert: true,
    });
  }
}

module.exports = { handleOrderConfirmation };
