const axios = require('axios');
const deduplicator = require('./deduplicator');
const signalParser = require('../../parser/signalParser');
const pdfParser = require('../pdf/pdfParser');
const earningsSummaryEngine = require('../ai/earningsSummaryEngine');
const fundamentalsService = require('../fundamentals');
const decisionEngine = require('../decisionEngine');
const riskEngine = require('../riskEngine');
const angelOne = require('../angelOne');
const tradeStore = require('../tradeStore');
const config = require('../../config');

class BseNseMonitor {
  constructor(intervalMs = 10000) {
    this.intervalMs = intervalMs;
    this.isPolling = false;
    this.timer = null;
    this.userAgents = [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    ];
    this.recentAnnouncements = [];
  }

  getRandomUserAgent() {
    return this.userAgents[Math.floor(Math.random() * this.userAgents.length)];
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
   * Fetch announcements from NSE & BSE
   */
  async pollAnnouncements() {
    try {
      const [nseItems, bseItems] = await Promise.all([
        this.fetchNseAnnouncements(),
        this.fetchBseAnnouncements(),
      ]);

      const allItems = [...nseItems, ...bseItems];

      for (const item of allItems) {
        // Cross-source deduplication check
        if (deduplicator.isUnique(item)) {
          console.log(`[BseNseMonitor] New Unique Announcement from ${item.source}: ${item.symbol} - ${item.title}`);
          await this.processAnnouncement(item);
        }
      }
    } catch (err) {
      console.warn(`[BseNseMonitor] Polling iteration warning: ${err.message}`);
    }
  }

  /**
   * Fetch NSE Corporate Announcements with headers & backoff
   */
  async fetchNseAnnouncements() {
    try {
      const response = await axios.get('https://www.nseindia.com/api/corporate-announcements?index=equities', {
        headers: {
          'User-Agent': this.getRandomUserAgent(),
          'Accept': 'application/json, text/plain, */*',
          'Referer': 'https://www.nseindia.com/companies-listing/corporate-filings-announcements',
        },
        timeout: 5000,
      });

      if (Array.isArray(response.data)) {
        return response.data.map(item => ({
          source: 'NSE',
          symbol: item.symbol || item.sm_symbol || 'NSE_STOCK',
          title: item.desc || item.attchmntText || 'Corporate Announcement',
          pdfUrl: item.attchmntFile ? `https://archives.nseindia.com/corporate/announcements/${item.attchmntFile}` : null,
          date: item.an_dt || new Date().toISOString(),
        }));
      }
    } catch (_) {
      // NSE endpoint requires cookies / session in some regions; fail gracefully
    }
    return [];
  }

  /**
   * Fetch BSE Corporate Announcements
   */
  async fetchBseAnnouncements() {
    try {
      const response = await axios.get('https://api.bseindia.com/BseIndiaAPI/api/AnnSubCategoryData/w?categoryId=-1&subCategoryId=-1&strType=C', {
        headers: {
          'User-Agent': this.getRandomUserAgent(),
          'Accept': 'application/json',
          'Origin': 'https://www.bseindia.com',
          'Referer': 'https://www.bseindia.com/',
        },
        timeout: 5000,
      });

      if (response.data && Array.isArray(response.data.Table)) {
        return response.data.Table.map(item => ({
          source: 'BSE',
          symbol: item.SLONGNAME || item.SCRIP_CD || 'BSE_STOCK',
          title: item.NEWSSUB || item.HEADLINE || 'Corporate Announcement',
          pdfUrl: item.ATTACHMENTNAME ? `https://www.bseindia.com/xml-data/corpfiling/AttachLive/${item.ATTACHMENTNAME}` : null,
          date: item.NEWS_DT || new Date().toISOString(),
        }));
      }
    } catch (_) {}
    return [];
  }

  setBotInstance(bot) {
    this.bot = bot;
  }

  /**
   * Deeply process individual announcement: PDF extraction, AI summary, trade execution
   */
  async processAnnouncement(item) {
    let pdfAnalysis = { rawText: '', metrics: {} };
    if (item.pdfUrl) {
      pdfAnalysis = await pdfParser.parsePdf(item.pdfUrl);
    }

    const aiSummary = earningsSummaryEngine.generateSummary(item.symbol, item.title + ' ' + pdfAnalysis.rawText, pdfAnalysis.metrics);

    // Save in recent announcements list for REST API
    const announcementRecord = {
      id: `ANN_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      source: item.source,
      symbol: item.symbol,
      title: item.title,
      pdfUrl: item.pdfUrl,
      aiSummary,
      timestamp: new Date().toISOString(),
    };

    this.recentAnnouncements.unshift(announcementRecord);
    if (this.recentAnnouncements.length > 200) {
      this.recentAnnouncements.pop();
    }

    // Broadcast AI Financial Intelligence Summary to Telegram
    if (this.bot) {
      const p = aiSummary.pulseRatings;
      const telegramMsg =
        `📢 *OFFICIAL ${item.source} CORPORATE ANNOUNCEMENT*\n\n` +
        `*Stock:* ${item.symbol}\n` +
        `*Title:* ${item.title}\n` +
        (item.pdfUrl ? `📄 *Filing PDF:* [Download Result PDF](${item.pdfUrl})\n\n` : '\n') +
        `💡 *AI Summary:* ${aiSummary.shortSummary}\n\n` +
        `📊 *METRIC PULSE RATINGS (QoQ & YoY)*\n` +
        `• *Sales (QoQ):* ${p.salesQoQ.val !== null ? p.salesQoQ.val + '%' : 'N/A'} ➔ \`${p.salesQoQ.rating}\`\n` +
        `• *Sales (YoY):* ${p.salesYoY.val !== null ? p.salesYoY.val + '%' : 'N/A'} ➔ \`${p.salesYoY.rating}\`\n` +
        `• *Other Income:* ${pdfAnalysis.metrics.otherIncome ? '₹' + pdfAnalysis.metrics.otherIncome + ' Cr' : 'N/A'} ➔ \`${p.otherIncome.rating}\`\n` +
        `• *Operating Profit (OP):* ${pdfAnalysis.metrics.operatingProfit ? '₹' + pdfAnalysis.metrics.operatingProfit + ' Cr' : 'N/A'} ➔ \`${p.operatingProfit.rating}\`\n` +
        `• *OPM (%):* ${p.opm.val !== null ? p.opm.val + '%' : 'N/A'} ➔ \`${p.opm.rating}\`\n` +
        `• *PAT / Net Profit (QoQ):* ${p.patQoQ.val !== null ? p.patQoQ.val + '%' : 'N/A'} ➔ \`${p.patQoQ.rating}\`\n` +
        `• *PAT / Net Profit (YoY):* ${p.patYoY.val !== null ? p.patYoY.val + '%' : 'N/A'} ➔ \`${p.patYoY.rating}\`\n` +
        `• *EPS:* ${pdfAnalysis.metrics.eps ? '₹' + pdfAnalysis.metrics.eps : 'N/A'} ➔ \`${p.eps.rating}\`\n\n` +
        `✅ *Positive Drivers:*\n` + aiSummary.positivePoints.map(point => `- ${point}`).join('\n') + `\n\n` +
        `⚠️ *Hidden Risks:*\n` + aiSummary.hiddenRisks.map(risk => `- ${risk}`).join('\n');

      const targetChats = config.telegram.authorizedChatIds.length > 0 
        ? config.telegram.authorizedChatIds 
        : (config.telegram.targetChannel ? [`@${config.telegram.targetChannel.replace(/^@/, '')}`] : []);

      for (const chatId of targetChats) {
        try {
          await this.bot.sendMessage(chatId, telegramMsg, { parse_mode: 'Markdown', disable_web_page_preview: false });
        } catch (e) {
          console.warn(`[BseNseMonitor] Failed to send Telegram alert to ${chatId}: ${e.message}`);
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
