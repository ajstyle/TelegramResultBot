const tradeStore = require('../services/tradeStore');
const angelOne = require('../services/angelOne');
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
      return await bot.editMessageCaption(captionText, options);
    } catch (_) {
      try {
        return await bot.editMessageText(newText, options);
      } catch (_) {}
    }
  } else {
    try {
      return await bot.editMessageText(newText, options);
    } catch (_) {
      try {
        return await bot.editMessageCaption(captionText, options);
      } catch (_) {}
    }
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

  // Action can be CONFIRM_<tradeId> or CANCEL_<tradeId>
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

  if (!data.startsWith('CONFIRM_')) {
    return;
  }

  const tradeId = data.replace('CONFIRM_', '');

  try {
    // 2. Validation & Status check with Dynamic Fallback
    let trade = await tradeStore.findById(tradeId);

    // Dynamic Fallback: If trade record is missing (e.g. after server restart or DB offline)
    if (!trade && message) {
      const msgText = `${message.caption || ''} ${message.text || ''}`;
      
      // 1. Extract Symbol from Hashtag (#PURVA), Button Text (ANGEL ONE (PURVA)), or Caption
      const symbolFromTag = msgText.match(/#([A-Z0-9_-]+)/i);
      const symbolFromBtn = msgText.match(/ANGEL ONE \(([^)]+)\)/i);
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
          const fundamentalsProvider = require('../fundamentals/provider');
          entry = await fundamentalsProvider.fetchLivePrice(symbol);
        } catch (_) {}
      }

      const slMatch = msgText.match(/SL\s*:\s*₹?\s*([\d.,]+)/i);
      const qtyMatch = msgText.match(/Qty\s*:\s*(\d+)/i);

      if (symbol && entry && entry > 0) {
        const stopLoss = slMatch ? parseFloat(slMatch[1].replace(/,/g, '')) : parseFloat((entry * 0.98).toFixed(2));
        
        let quantity = qtyMatch ? parseInt(qtyMatch[1], 10) : 1;
        if (!qtyMatch) {
          try {
            const riskEngine = require('../riskEngine');
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
    if (trade.status !== 'ANALYZED') {
      await safeAnswerCallback(bot, callbackId, {
        text: `⚠️ Cannot place order. Trade status is already '${trade.status}'.`,
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

    // 5. Look up symbol token dynamically from Angel One & Check Cautionary / ESM Status
    const scripInfo = await angelOne.searchScrip(trade.symbol, 'NSE');
    const isCautionary = angelOne.isCautionaryStock(trade.symbol, scripInfo);

    // Automatic Product Type Routing:
    // Standard stocks -> INTRADAY
    // ESM / ASM / GSM / Trade-for-Trade (BE Series) stocks -> DELIVERY (CNC 100% Cash) to pass SEBI & Angel One RMS checks cleanly!
    const productType = isCautionary ? 'DELIVERY' : 'INTRADAY';
    const esmNotice = isCautionary ? '\nℹ️ *ESM / Surveillance Stock*: Auto-routed as 100% Cash `DELIVERY` (CNC) order on Angel One SmartAPI.' : '';

    console.log(`[OrderConfirmation] Submitting ${trade.action} order for ${trade.symbol} (Product: ${productType}, isCautionary: ${isCautionary})...`);

    // 6. Place Order with Angel One
    const orderResult = await angelOne.placeOrder({
      tradingsymbol: scripInfo.tradingsymbol,
      symboltoken: scripInfo.symboltoken,
      transactiontype: trade.action,
      quantity: trade.quantity,
      price: trade.entry,
      orderType: 'LIMIT',
      productType,
      exchange: 'NSE',
    });

    if (orderResult.success) {
      trade.status = 'ORDER_PLACED';
      trade.angelOrderId = orderResult.orderId;
      await trade.save();

      const modeBadge = config.tradingMode === 'PAPER' ? '📝 [PAPER TRADING]' : '⚡ [LIVE TRADING]';

      const successMsg =
        `${modeBadge} *ORDER PLACED SUCCESSFULLY*\n\n` +
        `*Stock:* ${trade.symbol}\n` +
        `*Action:* ${trade.action}\n` +
        `*Product Mode:* \`${productType}\`${esmNotice}\n` +
        `*Quantity:* ${trade.quantity}\n` +
        `*Price:* ₹${trade.entry}\n` +
        `*Calculated SL:* ₹${trade.stopLoss}\n` +
        `*Angel Order ID:* \`${trade.angelOrderId}\`\n\n` +
        `ℹ️ *Protective Stop-Loss Status:* Calculated SL is logged. Place SL trigger order via Angel One app if desired.\n\n` +
        `✅ Trade Record Updated: \`${trade._id}\``;

      await safeEditMessage(bot, message, successMsg);
    } else {
      trade.status = 'REJECTED';
      await trade.save();

      const failMsg =
        `❌ *ORDER PLACEMENT REJECTED*\n\n` +
        `*Stock:* ${trade.symbol}\n` +
        `*Reason:* ${orderResult.message}\n` +
        `*Trade ID:* \`${trade._id}\``;

      await safeEditMessage(bot, message, failMsg);
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
