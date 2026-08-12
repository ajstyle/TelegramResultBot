const deduplicator = require('./deduplicator');
const announcementFilter = require('./announcementFilter');
const nseAdapter = require('../adapters/nseAdapter');
const bseAdapter = require('../adapters/bseAdapter');
const aiAdapter = require('../adapters/aiAdapter');
const pdfParser = require('../pdf/pdfParser');
const signalParser = require('../../parser/signalParser');
const fundamentalsService = require('../fundamentals');
const riskEngine = require('../riskEngine');
const decisionEngine = require('../decisionEngine');
const angelOne = require('../angelOne');
const tradeStore = require('../tradeStore');
const config = require('../../config');

class BseNseMonitor {
  constructor(intervalMs = 3000) {
    this.intervalMs = intervalMs;
    this.isPolling = false;
    this.timer = null;
    this.recentAnnouncements = [];
    this.activeChatIds = new Set();
    this.isInitialRun = true;
  }

  addActiveChatId(chatId) {
    if (chatId) {
      this.activeChatIds.add(chatId.toString());
    }
  }

  /**
   * Filter out old announcements (> 3 hours old)
   */
  isRecentAnnouncement(item) {
    if (!item || !item.date) return true;
    try {
      const pubDate = new Date(item.date);
      if (isNaN(pubDate.getTime())) return true;

      const now = Date.now();
      const diffMs = now - pubDate.getTime();
      const maxAgeMs = 3 * 60 * 60 * 1000; // 3 hours

      if (diffMs > maxAgeMs) {
        return false;
      }
    } catch (_) {}
    return true;
  }

  /**
   * Start 10-second monitoring loop
   */
  start() {
    if (this.isPolling) return;
    this.isPolling = true;
    console.log(`[BseNseMonitor] Ingestion loop started (Polling Interval: ${this.intervalMs}ms)...`);

    this.timer = setInterval(async () => {
      await this.pollAnnouncements();
    }, this.intervalMs);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.isPolling = false;
    console.log('[BseNseMonitor] Ingestion loop stopped.');
  }

  /**
   * Fetch announcements from modular adapters (NSE & BSE)
   */
  async pollAnnouncements() {
    try {
      const [nseItems, bseItems] = await Promise.all([
        nseAdapter.fetchAnnouncements(),
        bseAdapter.fetchAnnouncements(),
      ]);

      const allItems = [...nseItems, ...bseItems];

      // On initial boot, seed deduplicator with pre-existing items so old announcements are ignored
      if (this.isInitialRun) {
        this.isInitialRun = false;
        for (const item of allItems) {
          if (announcementFilter.isEarningsAnnouncement(item)) {
            deduplicator.isUnique(item);
          }
        }
        console.log(`[BseNseMonitor] Initialized deduplicator with ${allItems.length} existing announcements. Listening for new live earnings...`);
        return;
      }

      for (const item of allItems) {
        // 1. Filter out non-earnings announcements
        if (!announcementFilter.isEarningsAnnouncement(item)) {
          continue;
        }

        // 2. Filter out old announcements (> 3 hours old)
        if (!this.isRecentAnnouncement(item)) {
          continue;
        }

        // 3. Cross-source deduplication check
        if (deduplicator.isUnique(item)) {
          console.log(`[BseNseMonitor] Fresh Earnings Announcement Detected from ${item.source}: ${item.symbol} - ${item.title}`);
          await this.processAnnouncement(item);
        }
      }
    } catch (err) {
      console.warn(`[BseNseMonitor] Polling iteration notice: ${err.message}`);
    }
  }

  setBotInstance(bot) {
    this.bot = bot;
  }

  /**
   * Deeply process individual announcement: PDF extraction, TTM calculations, Valuation, AI summary, Telegram alert
   */
  async processAnnouncement(item) {
    let pdfAnalysis = { rawText: '', metrics: {} };
    if (item.pdfUrl) {
      pdfAnalysis = await pdfParser.parsePdf(item.pdfUrl);
    }

    const aiSummary = aiAdapter.generateSummary(item.symbol, item.title + ' ' + pdfAnalysis.rawText, pdfAnalysis.metrics);
    const fundamentals = await fundamentalsService.analyze(item.symbol);

    // Save in recent announcements list for REST API
    const announcementRecord = {
      id: item.announcementId || `ANN_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      source: item.source,
      symbol: item.symbol,
      title: item.title,
      pdfUrl: item.pdfUrl,
      metrics: pdfAnalysis.metrics,
      fundamentals: fundamentals.metrics,
      aiSummary,
      timestamp: new Date().toISOString(),
    };

    this.recentAnnouncements.unshift(announcementRecord);
    if (this.recentAnnouncements.length > 200) {
      this.recentAnnouncements.pop();
    }

    // Lookup Scrip & Calculate ATR Stop Loss & Sizing if purchase eligible
    let tradeRecord = null;
    let stopLoss = null;
    let quantity = 0;
    let ltp = null;

    if (aiSummary.isPurchaseEligible) {
      let entryPrice = 1000;
      let atr = 20;

      try {
        const scripInfo = await angelOne.searchScrip(item.symbol, 'NSE');
        ltp = await angelOne.getLTP(scripInfo.exchange, scripInfo.tradingsymbol, scripInfo.symboltoken);
        const candles = await angelOne.getHistoricalCandles(scripInfo.exchange, scripInfo.symboltoken, 30);
        atr = riskEngine.calculateATR(candles, config.risk.atrPeriod);
        entryPrice = ltp || 1000;
      } catch (err) {
        console.warn(`[BseNseMonitor] Market lookup notice for ${item.symbol}: ${err.message}`);
      }

      const slResult = riskEngine.calculateStopLoss('BUY', entryPrice, null, atr);
      stopLoss = slResult.stopLoss;
      const posResult = riskEngine.calculatePositionSize(entryPrice, stopLoss, config.risk.accountCapital, config.risk.riskPerTrade);
      quantity = posResult.quantity;

      const decision = decisionEngine.evaluate({
        action: 'BUY',
        symbol: item.symbol,
        entry: entryPrice,
        stopLoss,
        target: null,
        quantity,
        ltp: entryPrice,
        ocrConfidence: 100,
        fundamentals,
        atr: slResult.atrUsed,
      });

      tradeRecord = await tradeStore.createTrade({
        symbol: item.symbol,
        action: 'BUY',
        entry: entryPrice,
        ltp: entryPrice,
        stopLoss,
        target: null,
        quantity,
        atr: slResult.atrUsed,
        fundamentals: fundamentals.metrics || {},
        decision,
        status: 'ANALYZED',
        telegramMessageId: null,
        telegramChatId: null,
      });
      console.log(`[BseNseMonitor] Trade record successfully created and saved in TradeStore: ${tradeRecord._id}`);
    }

    // Broadcast AI Financial Intelligence Summary & Metric Pulse Ratings to Telegram
    if (this.bot) {
      const p = aiSummary.pulseRatings;
      const m = pdfAnalysis.metrics;
      const valRating = fundamentals.valuation || 'FAIRLY VALUED ⚖️';

      let replyMarkup = undefined;
      let buyButtonNotice = '';

      if (aiSummary.isPurchaseEligible && tradeRecord) {
        buyButtonNotice = `\n⚡ *Result is ${aiSummary.overallRating}! Instant Purchase Enabled.*\n*Entry:* ₹${tradeRecord.entry} | *SL:* ₹${stopLoss} | *Qty:* ${quantity} shares\n`;

        replyMarkup = {
          inline_keyboard: [
            [
              { text: `⚡ 1-CLICK BUY ON ANGEL ONE (SL: ₹${stopLoss} | Qty: ${quantity})`, callback_data: `CONFIRM_${tradeRecord._id}` },
            ],
            [
              { text: `❌ CANCEL`, callback_data: `CANCEL_${tradeRecord._id}` },
            ]
          ],
        };
      }

      const timeAgoStr = this.getTimeAgo(item.date);

      const compCategory = fundamentals.companyCategory || 'MID CAP 📈';
      const mcapStr = fundamentals.metrics?.marketCapCr ? ` (Market Cap: ₹${fundamentals.metrics.marketCapCr.toLocaleString('en-IN')} Cr)` : '';

      const telegramMsg =
        `📢 *OFFICIAL ${item.source} EARNINGS ANNOUNCEMENT*\n\n` +
        `*Stock:* ${item.symbol}\n` +
        `🏢 *Category:* \`${compCategory}\`${mcapStr}\n` +
        `*Title:* ${item.title}\n` +
        `⏱️ *Result Published:* \`${item.date || 'Live'}\` (⚡ *${timeAgoStr}*)\n` +
        (item.pdfUrl ? `📄 *Filing PDF:* [Download Result PDF](${item.pdfUrl})\n\n` : '\n') +
        `🏆 *OVERALL RESULT RATING:* \`${aiSummary.overallRating}\` (Score: ${aiSummary.overallScore}/100)\n` +
        `💎 *CURRENT VALUATION:* \`${valRating}\` (P/E: ${fundamentals.metrics?.pe || 'N/A'}, Sector P/E: ${fundamentals.metrics?.sectorPe || 'N/A'})\n` +
        `${buyButtonNotice}\n` +
        `📊 *METRIC PULSE RATINGS (QoQ, YoY & TTM)*\n` +
        `• *Sales (QoQ):* ${p.salesQoQ.val !== null ? p.salesQoQ.val + '%' : 'N/A'} ➔ \`${p.salesQoQ.rating}\`\n` +
        `• *Sales (YoY):* ${p.salesYoY.val !== null ? p.salesYoY.val + '%' : 'N/A'} ➔ \`${p.salesYoY.rating}\`\n` +
        `• *Sales (TTM):* ${m.salesTTM ? '₹' + m.salesTTM + ' Cr' : 'N/A'}\n` +
        `• *Other Income:* ${m.otherIncome ? '₹' + m.otherIncome + ' Cr' : 'N/A'} ➔ \`${p.otherIncome.rating}\`\n` +
        `• *Operating Profit (OP):* ${m.operatingProfit ? '₹' + m.operatingProfit + ' Cr' : 'N/A'} ➔ \`${p.operatingProfit.rating}\`\n` +
        `• *OPM (%):* ${p.opm.val !== null ? p.opm.val + '%' : 'N/A'} ➔ \`${p.opm.rating}\`\n` +
        `• *PAT / Net Profit (QoQ):* ${p.patQoQ.val !== null ? p.patQoQ.val + '%' : 'N/A'} ➔ \`${p.patQoQ.rating}\`\n` +
        `• *PAT / Net Profit (YoY):* ${p.patYoY.val !== null ? p.patYoY.val + '%' : 'N/A'} ➔ \`${p.patYoY.rating}\`\n` +
        `• *PAT (TTM):* ${m.patTTM ? '₹' + m.patTTM + ' Cr' : 'N/A'}\n` +
        `• *EPS (TTM):* ${m.epsTTM ? '₹' + m.epsTTM : 'N/A'} ➔ \`${p.eps.rating}\`\n\n` +
        `✅ *Positive Drivers:*\n` + aiSummary.positivePoints.map(point => `- ${point}`).join('\n') + `\n\n` +
        `⚠️ *Hidden Risks:*\n` + aiSummary.hiddenRisks.map(risk => `- ${risk}`).join('\n');

      const targetChats = new Set([
        ...config.telegram.authorizedChatIds,
        ...Array.from(this.activeChatIds),
      ]);

      for (const chatId of targetChats) {
        try {
          await this.bot.sendMessage(chatId, telegramMsg, {
            parse_mode: 'Markdown',
            disable_web_page_preview: false,
            reply_markup: replyMarkup,
          });
        } catch (e) {
          console.warn(`[BseNseMonitor] Could not send Telegram alert to ${chatId}: ${e.message}`);
        }
      }
    }
  }

  /**
   * Calculate time elapsed ago for announcement publication
   */
  getTimeAgo(dateInput) {
    if (!dateInput) return 'Just now';
    try {
      const pubDate = new Date(dateInput);
      if (isNaN(pubDate.getTime())) return `${dateInput}`;

      const now = Date.now();
      const diffMs = Math.max(0, now - pubDate.getTime());
      const diffSecs = Math.floor(diffMs / 1000);
      const diffMins = Math.floor(diffSecs / 60);
      const diffHours = Math.floor(diffMins / 60);

      if (diffHours > 0) {
        const remainingMins = diffMins % 60;
        return `${diffHours} hr${diffHours > 1 ? 's' : ''} ${remainingMins} min${remainingMins > 1 ? 's' : ''} ago`;
      }
      if (diffMins > 0) {
        return `${diffMins} min${diffMins > 1 ? 's' : ''} ago`;
      }
      return `${diffSecs} sec${diffSecs !== 1 ? 's' : ''} ago`;
    } catch (_) {
      return `${dateInput}`;
    }
  }

  getRecentAnnouncements(limit = 50) {
    return this.recentAnnouncements.slice(0, limit);
  }
}

module.exports = new BseNseMonitor();
