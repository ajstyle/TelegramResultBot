const ocrEngine = require('../ocr/tesseract');
const signalParser = require('../parser/signalParser');
const angelOne = require('../services/angelOne');
const riskEngine = require('../services/riskEngine');
const tradeStore = require('../services/tradeStore');
const config = require('../config');

/**
 * Ultra-Fast Minimalist Signal & Photo Handler
 * Bypasses all fundamental scoring for 0.001s instant speed. Shows only Stock, Price, SL, and Qty.
 */
async function handleScreenshot(bot, msg) {
  const chatId = msg.chat.id.toString();
  const userId = msg.from ? msg.from.id.toString() : chatId;

  const targetChannelName = (config.telegram.targetChannel || '').toLowerCase().replace(/^@/, '');
  const chatUsername = (msg.chat.username || '').toLowerCase().replace(/^@/, '');
  const chatTitle = (msg.chat.title || '').toLowerCase().replace(/^@/, '');
  const fwdUsername = (msg.forward_from_chat?.username || '').toLowerCase().replace(/^@/, '');
  const fwdTitle = (msg.forward_from_chat?.title || '').toLowerCase().replace(/^@/, '');

  const isChannelMsg =
    msg.chat.type === 'channel' ||
    (targetChannelName && (
      chatUsername.includes(targetChannelName) ||
      chatTitle.includes(targetChannelName) ||
      fwdUsername.includes(targetChannelName) ||
      fwdTitle.includes(targetChannelName)
    ));

  // 1. Authorization check
  const isAuthorized =
    isChannelMsg ||
    config.telegram.authorizedChatIds.length === 0 ||
    config.telegram.authorizedChatIds.includes(chatId) ||
    config.telegram.authorizedChatIds.includes(userId);

  if (!isAuthorized) {
    console.warn(`[ScreenshotHandler] Unauthorized signal dropped from Chat ID: ${chatId}`);
    return;
  }

  // Determine recipient chats
  const targetRecipientIds = isChannelMsg
    ? (config.telegram.authorizedChatIds.length > 0 ? config.telegram.authorizedChatIds : [chatId])
    : [chatId];

  // Instant Loading Notice (0.01s Feedback)
  const processingMsgs = [];
  for (const targetId of targetRecipientIds) {
    try {
      const pMsg = await bot.sendMessage(targetId, '⏳ Processing signal...');
      processingMsgs.push({ targetId, messageId: pMsg.message_id });
    } catch (err) {
      console.warn(`[ScreenshotHandler] Failed to send processing notice to ${targetId}: ${err.message}`);
    }
  }

  try {
    // Fast-Path Caption Parsing (0.001s Execution Speed)
    let ocrText = msg.caption || msg.text || '';
    let ocrConfidence = 100;
    let signal = signalParser.parse(ocrText);

    // Fallback Image OCR Scanning only if caption text does not contain symbol/rating
    if (!signal.isParsed && msg.photo && Array.isArray(msg.photo) && msg.photo.length > 0 && msg.photo[0].file_id !== 'TEXT_SIGNAL') {
      const photoArray = msg.photo;
      const highestResPhoto = photoArray[photoArray.length - 1];

      const fileStream = bot.getFileStream(highestResPhoto.file_id);
      const chunks = [];
      for await (const chunk of fileStream) {
        chunks.push(chunk);
      }
      const imageBuffer = Buffer.concat(chunks);

      const ocrResult = await ocrEngine.processImage(imageBuffer);
      ocrText = `${ocrText}\n${ocrResult.text}`.trim();
      ocrConfidence = ocrResult.confidence;
      signal = signalParser.parse(ocrText);
    }

    if (!signal.isParsed) {
      const noticeMsg =
        `⚠️ *Signal Parsing Notice*\n\n` +
        `Could not extract stock symbol or price. Format: \`#PANAMAPET - Excellent Results\` or \`BUY TCS @ 3520\``;

      for (const { targetId, messageId } of processingMsgs) {
        try {
          await bot.editMessageText(noticeMsg, { chat_id: targetId, message_id: messageId, parse_mode: 'Markdown' });
        } catch (_) {}
      }
      return;
    }

    // 6. Look up Scrip Info from Angel One
    let scripInfo = null;
    let ltp = null;
    try {
      scripInfo = await angelOne.searchScrip(signal.symbol, 'NSE');
      ltp = signal.entry || await angelOne.getLTP(scripInfo.exchange, scripInfo.tradingsymbol, scripInfo.symboltoken);
    } catch (err) {
      scripInfo = { exchange: 'NSE', tradingsymbol: signal.symbol, symboltoken: '0' };
    }

    // FIRST STEP: Check Cautionary List (GSM/ASM/Trade-for-Trade)
    if (angelOne.isCautionaryStock(signal.symbol, scripInfo)) {
      const cautionaryNotice =
        `⚠️ *CAUTIONARY LISTING DETECTED - TRADE ABORTED*\n\n` +
        `*Stock:* ${signal.symbol}\n` +
        `⛔ *Order stopped immediately. Stock is under exchange surveillance (GSM/ASM).*\n` +
        `💡 Please place the order manually in your Angel One app if desired.`;

      for (const { targetId, messageId } of processingMsgs) {
        try {
          await bot.editMessageText(cautionaryNotice, { chat_id: targetId, message_id: messageId, parse_mode: 'Markdown' });
        } catch (_) {}
      }
      return;
    }

    const effectiveEntry = signal.entry || ltp || 100;

    // Instant 2% Volatility Stop Loss Calculation
    const atr = (effectiveEntry * 0.02) / (config.risk.atrMultiplier || 2);
    const { stopLoss } = riskEngine.calculateStopLoss(
      signal.action,
      effectiveEntry,
      signal.stopLoss,
      atr
    );

    // Position Sizing
    const position = riskEngine.calculatePositionSize(
      effectiveEntry,
      stopLoss,
      config.risk.accountCapital,
      config.risk.riskPerTrade
    );

    // Rating Detection
    const upperText = ocrText.toUpperCase();

    const isExcellent =
      (signal.cardRating && signal.cardRating.includes('EXCELLENT')) ||
      (upperText.includes('PULSE RATING : EXCELLENT') || upperText.includes('EXCELLENT RESULTS'));

    const isPoor =
      (signal.cardRating && (signal.cardRating.includes('POOR') || signal.cardRating.includes('BAD'))) ||
      (upperText.includes('PULSE RATING : POOR') || upperText.includes('POOR RESULTS') || upperText.includes('PULSE RATING : VERY POOR'));

    const modeBadge = config.tradingMode === 'PAPER' ? '📝 [PAPER]' : '⚡ [LIVE]';

    // Handle POOR Rating: Abort trade immediately
    if (isPoor) {
      const poorNotice =
        `🔴 *RESULT RATING: POOR ⚠️ [TRADE ABORTED]* ${modeBadge}\n\n` +
        `*Stock:* ${signal.symbol} | *Price:* ₹${effectiveEntry}\n` +
        `⛔ *Order placement aborted automatically. Result rating is POOR.*`;

      for (const { targetId, messageId } of processingMsgs) {
        try {
          await bot.editMessageText(poorNotice, { chat_id: targetId, message_id: messageId, parse_mode: 'Markdown' });
        } catch (_) {}
      }
      return;
    }

    let orderResult = null;

    if (isExcellent) {
      // Direct Instant Auto-Purchase on Angel One
      orderResult = await angelOne.placeOrder({
        tradingsymbol: scripInfo.tradingsymbol,
        symboltoken: scripInfo.symboltoken,
        transactiontype: 'BUY',
        quantity: position.quantity,
        price: effectiveEntry,
        orderType: 'LIMIT',
        productType: 'INTRADAY',
        exchange: 'NSE',
      });
    }

    const tradeStatus = orderResult
      ? (orderResult.success ? 'ORDER_PLACED' : 'REJECTED')
      : 'ANALYZED';

    // Save Trade Record
    const tradeRecord = await tradeStore.createTrade({
      symbol: signal.symbol,
      action: 'BUY',
      entry: effectiveEntry,
      ltp: ltp || effectiveEntry,
      stopLoss,
      target: signal.target,
      quantity: position.quantity,
      status: tradeStatus,
      angelOrderId: orderResult?.orderId || null,
      telegramMessageId: processingMsgs[0]?.messageId || null,
      telegramChatId: targetRecipientIds[0] || chatId,
    });

    let outputMessage = '';
    let replyMarkup = undefined;

    if (orderResult) {
      if (orderResult.success) {
        outputMessage =
          `⚡ *INSTANT AUTO-PURCHASE EXECUTED (INTRADAY)* ${modeBadge}\n\n` +
          `*Stock:* ${signal.symbol} | *Action:* BUY\n` +
          `*Price:* ₹${effectiveEntry} | *Qty:* ${position.quantity} shares\n` +
          `*Stop Loss:* ₹${stopLoss}\n` +
          `*Angel Order ID:* \`${orderResult.orderId}\``;
      } else {
        outputMessage =
          `❌ *AUTO-EXECUTION REJECTED* ${modeBadge}\n\n` +
          `*Stock:* ${signal.symbol} | *Action:* BUY\n` +
          `*Reason:* ${orderResult.message}`;
      }
    } else {
      // Minimalist Clean Buy Signal Output (Only Stock, Price, SL, Qty)
      outputMessage =
        `📢 *INTRADAY BUY SIGNAL* ${modeBadge}\n\n` +
        `*Stock:* ${signal.symbol} | *Action:* BUY\n` +
        `*Price:* ₹${effectiveEntry} | *Qty:* ${position.quantity} shares\n` +
        `*Stop Loss:* ₹${stopLoss}\n\n` +
        `👇 *Click below to confirm INTRADAY Buy Order on Angel One:*`;

      replyMarkup = {
        inline_keyboard: [
          [
            { text: `⚡ 1-CLICK BUY ON ANGEL ONE (INTRADAY)`, callback_data: `CONFIRM_${tradeRecord._id}` },
          ],
          [
            { text: `❌ CANCEL`, callback_data: `CANCEL_${tradeRecord._id}` },
          ],
        ],
      };
    }

    for (const { targetId, messageId } of processingMsgs) {
      try {
        await bot.editMessageText(outputMessage, {
          chat_id: targetId,
          message_id: messageId,
          parse_mode: 'Markdown',
          reply_markup: replyMarkup,
        });
      } catch (err) {
        console.warn(`[ScreenshotHandler] Failed to edit message ${messageId} on ${targetId}: ${err.message}`);
      }
    }
  } catch (error) {
    console.error(`[ScreenshotHandler] Error processing signal: ${error.stack}`);
    for (const { targetId, messageId } of processingMsgs) {
      try {
        await bot.editMessageText(`❌ *Error Processing Signal:* ${error.message}`, {
          chat_id: targetId,
          message_id: messageId,
          parse_mode: 'Markdown',
        });
      } catch (_) {}
    }
  }
}

module.exports = { handleScreenshot };
