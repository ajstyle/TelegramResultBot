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
      await bot.editMessageText(`❌ *TRADE CANCELLED*\n\nTrade ID \`${tradeId}\` was cancelled by user.`, {
        chat_id: chatId,
        message_id: message.message_id,
        parse_mode: 'Markdown',
      });
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
    // 2. Validation & Status check
    const trade = await tradeStore.findById(tradeId);

    if (!trade) {
      await safeAnswerCallback(bot, callbackId, {
        text: '❌ Trade record not found in MongoDB.',
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

    await safeAnswerCallback(bot, callbackId, { text: '⏳ Executing order...' });

    // 5. Look up symbol token dynamically from Angel One
    const scripInfo = await angelOne.searchScrip(trade.symbol, 'NSE');

    // 6. Place Order with Angel One (INTRADAY)
    const orderResult = await angelOne.placeOrder({
      tradingsymbol: scripInfo.tradingsymbol,
      symboltoken: scripInfo.symboltoken,
      transactiontype: trade.action,
      quantity: trade.quantity,
      price: trade.entry,
      orderType: 'LIMIT',
      productType: 'INTRADAY',
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
        `*Quantity:* ${trade.quantity}\n` +
        `*Price:* ₹${trade.entry}\n` +
        `*Calculated SL:* ₹${trade.stopLoss}\n` +
        `*Angel Order ID:* \`${trade.angelOrderId}\`\n\n` +
        `ℹ️ *Protective Stop-Loss Status:* Calculated SL is logged. Place SL trigger order via Angel One app if desired.\n\n` +
        `✅ Trade Record Updated: \`${trade._id}\``;

      await bot.editMessageText(successMsg, {
        chat_id: chatId,
        message_id: message.message_id,
        parse_mode: 'Markdown',
      });
    } else {
      trade.status = 'REJECTED';
      await trade.save();

      const failMsg =
        `❌ *ORDER PLACEMENT REJECTED*\n\n` +
        `*Stock:* ${trade.symbol}\n` +
        `*Reason:* ${orderResult.message}\n` +
        `*Trade ID:* \`${trade._id}\``;

      await bot.editMessageText(failMsg, {
        chat_id: chatId,
        message_id: message.message_id,
        parse_mode: 'Markdown',
      });
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
