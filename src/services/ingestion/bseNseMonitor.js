const deduplicator = require('./deduplicator');
const announcementFilter = require('./announcementFilter');
const nseAdapter = require('../adapters/nseAdapter');
const bseAdapter = require('../adapters/bseAdapter');
const aiAdapter = require('../adapters/aiAdapter');
const pdfParser = require('../pdf/pdfParser');
const signalParser = require('../../parser/signalParser');
const config = require('../../config');

class BseNseMonitor {
  constructor(intervalMs = 10000) {
    this.intervalMs = intervalMs;
    this.isPolling = false;
    this.timer = null;
    this.recentAnnouncements = [];
    this.activeChatIds = new Set();
  }

  addActiveChatId(chatId) {
    if (chatId) {
      this.activeChatIds.add(chatId.toString());
    }
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

      for (const item of allItems) {
        // 1. Filter out non-earnings announcements
        if (!announcementFilter.isEarningsAnnouncement(item)) {
          continue;
        }

        // 2. Cross-source deduplication check
        if (deduplicator.isUnique(item)) {
          console.log(`[BseNseMonitor] Earnings Announcement Detected from ${item.source}: ${item.symbol} - ${item.title}`);
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
   * Deeply process individual announcement: PDF extraction, TTM calculations, AI summary, Telegram alert
   */
  async processAnnouncement(item) {
    let pdfAnalysis = { rawText: '', metrics: {} };
    if (item.pdfUrl) {
      pdfAnalysis = await pdfParser.parsePdf(item.pdfUrl);
    }

    const aiSummary = aiAdapter.generateSummary(item.symbol, item.title + ' ' + pdfAnalysis.rawText, pdfAnalysis.metrics);

    // Save in recent announcements list for REST API
    const announcementRecord = {
      id: item.announcementId || `ANN_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      source: item.source,
      symbol: item.symbol,
      title: item.title,
      pdfUrl: item.pdfUrl,
      metrics: pdfAnalysis.metrics,
      aiSummary,
      timestamp: new Date().toISOString(),
    };

    this.recentAnnouncements.unshift(announcementRecord);
    if (this.recentAnnouncements.length > 200) {
      this.recentAnnouncements.pop();
    }

    // Broadcast AI Financial Intelligence Summary & Metric Pulse Ratings to Telegram
    if (this.bot) {
      const p = aiSummary.pulseRatings;
      const m = pdfAnalysis.metrics;

      const telegramMsg =
        `📢 *OFFICIAL ${item.source} EARNINGS ANNOUNCEMENT*\n\n` +
        `*Stock:* ${item.symbol}\n` +
        `*Title:* ${item.title}\n` +
        (item.pdfUrl ? `📄 *Filing PDF:* [Download Result PDF](${item.pdfUrl})\n\n` : '\n') +
        `💡 *AI Summary:* ${aiSummary.shortSummary}\n\n` +
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
          await this.bot.sendMessage(chatId, telegramMsg, { parse_mode: 'Markdown', disable_web_page_preview: false });
        } catch (e) {
          console.warn(`[BseNseMonitor] Could not send Telegram alert to ${chatId}: ${e.message}`);
        }
      }
    }

    // Try parsing signal
    const parsedSignal = signalParser.parse(`${item.symbol} ${item.title}`);
    if (parsedSignal.isParsed) {
      console.log(`[BseNseMonitor] Actionable trade signal detected in ${item.symbol} announcement!`);
    }
  }

  getRecentAnnouncements(limit = 50) {
    return this.recentAnnouncements.slice(0, limit);
  }
}

module.exports = new BseNseMonitor();
