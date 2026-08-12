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

  try {
    // Fast-Path Caption Parsing (0.01s Execution Speed when Caption/Text exists)
    let ocrText = msg.caption || msg.text || '';
    let ocrConfidence = 100;
    let signal = signalParser.parse(ocrText);

    // Fallback Image OCR Scanning only if caption text does not contain symbol/rating
    if (!signal.isParsed && msg.photo && Array.isArray(msg.photo) && msg.photo.length > 0 && msg.photo[0].file_id !== 'TEXT_SIGNAL') {
      console.log(`[ScreenshotHandler] Caption incomplete. Performing image Tesseract OCR scanning...`);
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
        `*Text Analyzed:*\n\`${ocrText || '(No text or caption detected)'}\`\n\n` +
        `Could not automatically extract stock symbol or entry price. Please send text in format: \`#PANAMAPET - Excellent Results\` or \`BUY TCS @ 3520\``;

      for (const targetId of targetRecipientIds) {
        try {
          await bot.sendMessage(targetId, noticeMsg, { parse_mode: 'Markdown' });
        } catch (_) {}
      }
      return;
    }

    // 6. Look up Scrip Info from Angel One & Perform FIRST-STEP Cautionary Check
    let scripInfo = null;
    let ltp = null;
    try {
      scripInfo = await angelOne.searchScrip(signal.symbol, 'NSE');
      // Skip network getLTP if signal entry price is already extracted from caption/card
      if (signal.entry) {
        ltp = signal.entry;
      } else {
        ltp = await angelOne.getLTP(scripInfo.exchange, scripInfo.tradingsymbol, scripInfo.symboltoken);
      }
    } catch (err) {
      console.warn(`[ScreenshotHandler] Angel One lookup notice for ${signal.symbol}: ${err.message}`);
      scripInfo = { exchange: 'NSE', tradingsymbol: signal.symbol, symboltoken: '0' };
    }

    // FIRST STEP: Check if stock is listed under Cautionary / Surveillance Framework (GSM/ASM/Trade-for-Trade)
    if (angelOne.isCautionaryStock(signal.symbol, scripInfo)) {
      console.warn(`[ScreenshotHandler] Cautionary stock detected: ${signal.symbol}. Aborting order placement.`);
      const cautionaryNotice =
        `⚠️ *CAUTIONARY LISTING DETECTED - TRADE ABORTED*\n\n` +
        `*Stock:* ${signal.symbol}\n` +
        `*Category:* \`Exchange Surveillance Measure (GSM/ASM/Trade-for-Trade)\`\n\n` +
        `⛔ *Automated order placement stopped immediately to protect your account.*\n` +
        `SEBI & Angel One restrict automated API orders for stocks under cautionary listings.\n\n` +
        `💡 *Manual Trade:* If you still wish to buy ${signal.symbol}, please place the order manually in your Angel One mobile app.`;

      for (const targetId of targetRecipientIds) {
        try {
          await bot.sendMessage(targetId, cautionaryNotice, { parse_mode: 'Markdown' });
        } catch (_) {}
      }
      return;
    }

    const effectiveEntry = signal.entry || ltp || 100;

    // Instant 2% Volatility SL calculation (0.001-sec speed)
    const atr = (effectiveEntry * 0.02) / (config.risk.atrMultiplier || 2);
    const { stopLoss, atrUsed, isCalculated } = riskEngine.calculateStopLoss(
      signal.action,
      effectiveEntry,
      signal.stopLoss,
      atr
    );

    // 8. Calculate Position Sizing
    const position = riskEngine.calculatePositionSize(
      effectiveEntry,
      stopLoss,
      config.risk.accountCapital,
      config.risk.riskPerTrade
    );

    // Evaluate Rating Rules: EXCELLENT vs GOOD vs POOR
    const isExcellent =
      (signal.cardRating && signal.cardRating.includes('EXCELLENT')) ||
      (ocrText.toUpperCase().includes('EXCELLENT'));

    let fundamentals = { isAvailable: false, score: null, rating: 'Skipped for Instant Execution', valuation: 'Fair' };
    let orderResult = null;

    if (isExcellent) {
      // RULE 1: EXCELLENT RATING -> BYPASS FUNDAMENTAL ANALYSIS & IMMEDIATELY AUTO-PURCHASE INTRADAY DIRECTLY!
      console.log(`[ScreenshotHandler] EXCELLENT Rating detected for ${signal.symbol}. Bypassing fundamentals & placing INTRADAY Buy Order directly on Angel One...`);
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
    } else {
      // RULE 2: GOOD RATING (or neutral) -> Run Fundamental Analysis & wait for user confirmation button click!
      console.log(`[ScreenshotHandler] GOOD/Neutral Rating for ${signal.symbol}. Running Fundamental Analysis & generating 1-Click Buy button...`);
      fundamentals = await fundamentalsService.analyze(signal.symbol);
    }

    // Earnings & Brokerage parsing
    const earnings = earningsAnalyzer.analyze(signal.symbol, ocrText);
    const brokerage = brokerageParser.parse(signal.symbol, ocrText);

    // Decision Engine Synthesis
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
      atr: atrUsed,
      fundamentals: fundamentals.metrics || {},
      decision,
      status: tradeStatus,
      angelOrderId: orderResult?.orderId || null,
      telegramMessageId: null,
      telegramChatId: targetRecipientIds[0] || chatId,
    });

    // Format Telegram Output
    const currentLtpText = ltp ? `₹${ltp}` : `₹${effectiveEntry}`;
    const slNoticeText = isCalculated ? `₹${stopLoss} (ATR Calculated)` : `₹${stopLoss}`;
    const fundScoreText = fundamentals.isAvailable ? `${fundamentals.score}/100 (${fundamentals.rating})` : 'Skipped for 0-Sec Instant Execution';

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
          `⚡ *INSTANT AUTO-PURCHASE EXECUTED (INTRADAY)* ${modeBadge}\n\n` +
          `🏆 *RESULT RATING:* \`EXCELLENT 🌟\` (Bypassed fundamentals for 0-sec speed)\n\n` +
          `*Stock:* ${signal.symbol} | *Action:* BUY\n` +
          `*Product Type:* \`INTRADAY (MIS)\`\n` +
          `*Quantity:* ${position.quantity} shares | *Price:* ₹${effectiveEntry}\n` +
          `*Stop Loss:* ${slNoticeText}\n` +
          `*Angel Order ID:* \`${orderResult.orderId}\`\n\n` +
          `${warningText}\n` +
          `✅ Trade Record Saved: \`${tradeRecord._id}\``;
      } else {
        outputMessage =
          `❌ *AUTO-EXECUTION REJECTED* ${modeBadge}\n\n` +
          `*Stock:* ${signal.symbol} | *Action:* BUY\n` +
          `*Reason:* ${orderResult.message}\n` +
          `${warningText}\n` +
          `Trade ID: \`${tradeRecord._id}\``;
      }
    } else {
      // GOOD / NEUTRAL -> Require User Confirmation Click
      const valRating = fundamentals.valuation || 'FAIRLY VALUED ⚖️';
      outputMessage =
        `📢 *RESULT RATING:* \`GOOD 👍\` ${modeBadge}\n\n` +
        `*Stock:* ${signal.symbol}\n` +
        `*Entry Price:* ₹${effectiveEntry} | *LTP:* ${currentLtpText}\n` +
        `💎 *Valuation:* \`${valRating}\`\n` +
        `🏆 *Fundamental Score:* ${fundScoreText}\n` +
        `🛡️ *Suggested Stop Loss (INTRADAY):* ${slNoticeText}\n` +
        `*Intraday Qty:* ${position.quantity} shares\n` +
        `${warningText}\n` +
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

    for (const targetId of targetRecipientIds) {
      try {
        await bot.sendMessage(targetId, outputMessage, {
          parse_mode: 'Markdown',
          reply_markup: replyMarkup,
        });
      } catch (err) {
        console.warn(`[ScreenshotHandler] Failed to send message to ${targetId}: ${err.message}`);
      }
    }
  } catch (error) {
    console.error(`[ScreenshotHandler] Error processing screenshot: ${error.stack}`);
    for (const targetId of targetRecipientIds) {
      try {
        await bot.sendMessage(targetId, `❌ *Error Processing Image:* ${error.message}`, {
          parse_mode: 'Markdown',
        });
      } catch (_) {}
    }
  }
}

module.exports = { handleScreenshot };
