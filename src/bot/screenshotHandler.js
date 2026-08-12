const ocrEngine = require('../ocr/tesseract');
const signalParser = require('../parser/signalParser');
const angelOne = require('../services/angelOne');
const fundamentalsService = require('../services/fundamentals');
const riskEngine = require('../services/riskEngine');
const decisionEngine = require('../services/decisionEngine');
const earningsAnalyzer = require('../services/earningsAnalyzer');
const brokerageParser = require('../services/brokerageParser');
const tradeStore = require('../services/tradeStore');
const config = require('../config');

/**
 * Handle incoming Telegram photo screenshot or text recommendation
 * @param {object} bot TelegramBot instance
 * @param {object} msg Telegram message containing photo array or text
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

  // Determine recipient chats for processing & final output
  const targetRecipientIds = isChannelMsg
    ? (config.telegram.authorizedChatIds.length > 0 ? config.telegram.authorizedChatIds : [chatId])
    : [chatId];

  const processingMsgs = [];
  for (const targetId of targetRecipientIds) {
    try {
      const pMsg = await bot.sendMessage(targetId, '⏳ Analyzing signal, fundamentals & earnings data...');
      processingMsgs.push({ targetId, messageId: pMsg.message_id });
    } catch (err) {
      console.warn(`[ScreenshotHandler] Failed to send processing notice to ${targetId}: ${err.message}`);
    }
  }

  try {
    let ocrText = '';
    let ocrConfidence = 100;

    // Check if message contains photo or is raw text signal
    if (msg.photo && Array.isArray(msg.photo) && msg.photo.length > 0 && msg.photo[0].file_id !== 'TEXT_SIGNAL') {
      const photoArray = msg.photo;
      const highestResPhoto = photoArray[photoArray.length - 1];

      const fileStream = bot.getFileStream(highestResPhoto.file_id);
      const chunks = [];
      for await (const chunk of fileStream) {
        chunks.push(chunk);
      }
      const imageBuffer = Buffer.concat(chunks);

      const ocrResult = await ocrEngine.processImage(imageBuffer);
      ocrText = ocrResult.text;
      ocrConfidence = ocrResult.confidence;

      console.log(`[ScreenshotHandler] OCR Extracted Text: "${ocrText}" (Confidence: ${ocrConfidence}%)`);
    } else if (msg.text || msg.caption) {
      ocrText = msg.text || msg.caption;
      ocrConfidence = 100;
      console.log(`[ScreenshotHandler] Direct Text Signal Received: "${ocrText}"`);
    }

    // 5. Parse Signal
    const signal = signalParser.parse(ocrText);    if (!signal.isParsed) {
      const noticeMsg =
        `⚠️ *OCR Signal Parsing Notice*\n\n` +
        `*Raw Text Extracted:*\n\`${ocrText || '(No text detected)'}\`\n\n` +
        `*OCR Confidence:* ${Math.round(ocrConfidence)}%\n\n` +
        `Could not automatically extract stock symbol or entry price. Please send text manually in format: \`BUY TCS @ 3520\``;

      for (const { targetId, messageId } of processingMsgs) {
        try {
          await bot.editMessageText(noticeMsg, { chat_id: targetId, message_id: messageId, parse_mode: 'Markdown' });
        } catch (_) {}
      }
      return;
    }

    // 6. Look up instrument from Angel One
    const scripInfo = await angelOne.searchScrip(signal.symbol, 'NSE');

    // 7. Get Market Data (LTP & Historical Candles)
    const ltp = await angelOne.getLTP(scripInfo.exchange, scripInfo.tradingsymbol, scripInfo.symboltoken);
    const candles = await angelOne.getHistoricalCandles(scripInfo.exchange, scripInfo.symboltoken, 30);

    // 8. Calculate ATR & Stop Loss
    const atr = riskEngine.calculateATR(candles, config.risk.atrPeriod);
    const effectiveEntry = signal.entry;
    const { stopLoss, atrUsed, isCalculated } = riskEngine.calculateStopLoss(
      signal.action,
      effectiveEntry,
      signal.stopLoss,
      atr
    );

    // 9. Calculate Position Sizing
    const position = riskEngine.calculatePositionSize(
      effectiveEntry,
      stopLoss,
      config.risk.accountCapital,
      config.risk.riskPerTrade
    );

    // 10. Fundamentals & Valuation Analysis
    const fundamentals = await fundamentalsService.analyze(signal.symbol);

    // 11. Earnings & Concall Analysis
    const earnings = earningsAnalyzer.analyze(signal.symbol, ocrText);

    // 12. Brokerage Research Analysis
    const brokerage = brokerageParser.parse(signal.symbol, ocrText);

    // 13. Decision Engine Synthesis
    const decision = decisionEngine.evaluate({
      action: signal.action,
      symbol: signal.symbol,
      entry: effectiveEntry,
      stopLoss,
      target: signal.target,
      quantity: position.quantity,
      ltp: ltp || effectiveEntry,
      ocrConfidence,
      fundamentals,
      atr: atrUsed,
    });

    // 14. Auto-Execute Check
    let orderResult = null;
    if (config.telegram.autoExecute && decision.recommendation !== 'AVOID' && position.quantity > 0) {
      console.log(`[ScreenshotHandler] Auto-executing ${signal.action} order for ${signal.symbol}...`);
      orderResult = await angelOne.placeOrder({
        tradingsymbol: scripInfo.tradingsymbol,
        symboltoken: scripInfo.symboltoken,
        transactiontype: signal.action,
        quantity: position.quantity,
        price: effectiveEntry,
        orderType: 'LIMIT',
        productType: 'DELIVERY',
        exchange: 'NSE',
      });
    }

    const tradeStatus = orderResult
      ? (orderResult.success ? 'ORDER_PLACED' : 'REJECTED')
      : 'ANALYZED';

    // 15. Save Trade Record (MongoDB or In-Memory fallback)
    const tradeRecord = await tradeStore.createTrade({
      symbol: signal.symbol,
      action: signal.action,
      entry: effectiveEntry,
      ltp: ltp || effectiveEntry,
      stopLoss,
      target: signal.target,
      quantity: position.quantity,
      atr: atrUsed,
      fundamentals: fundamentals.metrics || {},
      decision,
      status: tradeStatus,
      angelOrderId: orderResult?.orderId || null,
      telegramMessageId: processingMsgs[0]?.messageId || null,
      telegramChatId: targetRecipientIds[0] || chatId,
    });

    // 16. Format Telegram Output
    const currentLtpText = ltp ? `₹${ltp}` : `₹${effectiveEntry} (LTP Unavailable)`;
    const slNoticeText = isCalculated ? `₹${stopLoss} (ATR Calculated)` : `₹${stopLoss} (From Screenshot)`;
    const fundScoreText = fundamentals.isAvailable ? `${fundamentals.score}/100 (${fundamentals.rating})` : 'Data Unavailable';

    let warningText = '';
    if (decision.warnings.length > 0) {
      warningText = `\n⚠️ *Warnings:*\n` + decision.warnings.map(w => `- ${w}`).join('\n') + `\n`;
    }

    const modeBadge = config.tradingMode === 'PAPER' ? '📝 [PAPER MODE]' : '⚡ [LIVE MODE]';

    let outputMessage = '';
    let replyMarkup = undefined;

    if (orderResult) {
      if (orderResult.success) {
        outputMessage =
          `⚡ *ORDER AUTO-EXECUTED SUCCESSFULLY* ${modeBadge}\n\n` +
          `💡 *Summary:* \`${decision.reasonedSummary}\`\n\n` +
          `*Stock:* ${signal.symbol} | *Action:* ${signal.action}\n` +
          `*Quantity:* ${position.quantity} shares | *Price:* ₹${effectiveEntry}\n` +
          `*Stop Loss:* ${slNoticeText}\n` +
          `*Angel Order ID:* \`${orderResult.orderId}\`\n\n` +
          `*Fundamental Score:* ${fundScoreText}\n` +
          `📈 *Earnings Note:* ${earnings.summary}\n` +
          `${warningText}\n` +
          `✅ Trade Record Saved: \`${tradeRecord._id}\``;
      } else {
        outputMessage =
          `❌ *AUTO-EXECUTION FAILED* ${modeBadge}\n\n` +
          `*Stock:* ${signal.symbol} | *Action:* ${signal.action}\n` +
          `*Reason:* ${orderResult.message}\n` +
          `${warningText}\n` +
          `Trade ID: \`${tradeRecord._id}\``;
      }
    } else {
      outputMessage =
        `📊 *DECISION SUPPORT ANALYSIS* ${modeBadge}\n\n` +
        `💡 *Summary:* \`${decision.reasonedSummary}\`\n\n` +
        `*Stock:* ${signal.symbol} | *Action:* ${signal.action}\n` +
        `*Entry:* ₹${effectiveEntry} | *LTP:* ${currentLtpText}\n` +
        `*Fundamental Score:* ${fundScoreText}\n` +
        `*Valuation:* ${fundamentals.valuation || 'Fair'}\n` +
        `*Suggested SL:* ${slNoticeText} (ATR: ₹${atrUsed || 'N/A'})\n` +
        `*Risk/Share:* ₹${position.riskPerShare} | *Qty:* ${position.quantity} shares\n` +
        `*Recommendation:* ${decision.recommendation} (Score: ${decision.score}/100, Confidence: ${decision.confidence})\n` +
        `${warningText}\n` +
        `📈 *Earnings Note:* ${earnings.summary}\n` +
        `📑 *Brokerage Stance:* ${brokerage.institutionalStance}\n\n` +
        `⚠️ *Order has NOT been placed.*\n` +
        `*Trade ID:* \`${tradeRecord._id}\``;

      replyMarkup = {
        inline_keyboard: [
          [
            { text: `✅ CONFIRM ${signal.action}`, callback_data: `CONFIRM_${tradeRecord._id}` },
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
        console.warn(`[ScreenshotHandler] Edit message failed for ${targetId}: ${err.message}`);
      }
    }
  } catch (error) {
    console.error(`[ScreenshotHandler] Error processing screenshot: ${error.message}`);
    for (const { targetId, messageId } of processingMsgs) {
      try {
        await bot.editMessageText(`❌ Error processing recommendation screenshot: ${error.message}`, {
          chat_id: targetId,
          message_id: messageId,
        });
      } catch (_) {}
    }
  }
}

module.exports = { handleScreenshot };
