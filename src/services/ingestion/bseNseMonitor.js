const nseAdapter = require('../adapters/nseAdapter');
const bseAdapter = require('../adapters/bseAdapter');
const announcementFilter = require('./announcementFilter');
const pdfParserEngine = require('../pdf/pdfParser');
const aiSummaryEngine = require('../ai/earningsSummaryEngine');
const geminiAnalyzer = require('../ai/geminiAnalyzer');
const fundamentalsService = require('../fundamentals');
const riskEngine = require('../riskEngine');
const decisionEngine = require('../decisionEngine');
const tradeStore = require('../tradeStore');
const angelOne = require('../angelOne');
const config = require('../../config');

/**
 * Real-Time BSE / NSE Corporate Announcements Monitor Service
 * Polls NSE and BSE live APIs, processes earnings PDFs, calculates signals, and broadcasts visual report cards.
 */
class BseNseMonitorService {
  constructor() {
    this.intervalId = null;
    this.processedAnnouncementIds = new Set();
    this.activeChatIds = new Set();
    this.bot = null;
    this.recentAnnouncements = [];
    this.isInitialRun = true;
  }

  setBotInstance(botInstance) {
    this.bot = botInstance;
  }

  addActiveChatId(chatId) {
    if (chatId) {
      this.activeChatIds.add(chatId.toString());
    }
  }

  getTimeAgo(dateInput) {
    if (!dateInput) return '0 secs ago';

    let annDate;
    if (typeof dateInput === 'string') {
      const match = dateInput.match(/(\d{2})[-/](\d{2})[-/](\d{4})\s+(\d{2}):(\d{2}):(\d{2})/);
      if (match) {
        const [, day, month, year, hrs, mins, secs] = match;
        annDate = new Date(Date.UTC(year, month - 1, day, hrs - 5, mins - 30, secs));
      } else {
        annDate = new Date(dateInput);
      }
    } else {
      annDate = new Date(dateInput);
    }

    if (isNaN(annDate.getTime())) return '0 secs ago';

    const diffMs = Math.max(0, Date.now() - annDate.getTime());
    const diffSecs = Math.floor(diffMs / 1000);
    const diffMins = Math.floor(diffSecs / 60);
    const diffHours = Math.floor(diffMins / 60);

    if (diffSecs < 60) return `${diffSecs} secs ago`;
    if (diffMins < 60) return `${diffMins} mins ago`;
    return `${diffHours} hrs ago`;
  }

  isRecentAnnouncement(dateInput) {
    if (!dateInput) return true;
    try {
      let annDate;
      if (typeof dateInput === 'string') {
        const match = dateInput.match(/(\d{2})[-/](\d{2})[-/](\d{4})\s+(\d{2}):(\d{2}):(\d{2})/);
        if (match) {
          const [, day, month, year, hrs, mins, secs] = match;
          annDate = new Date(Date.UTC(year, month - 1, day, hrs - 5, mins - 30, secs));
        } else {
          annDate = new Date(dateInput);
        }
      } else {
        annDate = new Date(dateInput);
      }

      if (isNaN(annDate.getTime())) return true;
      const diffHours = (Date.now() - annDate.getTime()) / (1000 * 60 * 60);
      return diffHours <= 3;
    } catch (_) {
      return true;
    }
  }

  start(pollingIntervalMs = 3000) {
    if (this.intervalId) return;

    console.log(`[BseNseMonitor] 24/7 Resilient Ingestion loop started (Polling interval: ${pollingIntervalMs}ms)...`);
    this.pollAnnouncements();
    this.intervalId = setInterval(() => this.pollAnnouncements(), pollingIntervalMs);

    // Watchdog keep-alive timer to guarantee 24/7 continuous polling on Render Cloud
    if (!this.watchdogId) {
      this.watchdogId = setInterval(() => {
        const timeSinceLastPoll = Date.now() - (this.lastPollTimestamp || Date.now());
        if (timeSinceLastPoll > 20000 || !this.intervalId) {
          console.warn(`[BseNseMonitor Watchdog] Polling loop stalled (${Math.round(timeSinceLastPoll / 1000)}s since last poll). Auto-restarting ingestion loop...`);
          this.isPolling = false;
          if (this.intervalId) clearInterval(this.intervalId);
          this.intervalId = setInterval(() => this.pollAnnouncements(), pollingIntervalMs);
          this.pollAnnouncements();
        }
      }, 15000);
    }
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    if (this.watchdogId) {
      clearInterval(this.watchdogId);
      this.watchdogId = null;
    }
    console.log('[BseNseMonitor] Ingestion loop stopped.');
  }

  async pollAnnouncements() {
    if (this.isPolling) return;
    this.isPolling = true;
    this.lastPollTimestamp = Date.now();

    try {
      const [nseAnnouncements, bseAnnouncements] = await Promise.all([
        nseAdapter.fetchAnnouncements().catch(() => []),
        bseAdapter.fetchAnnouncements().catch(() => []),
      ]);

      const allAnnouncements = [...nseAnnouncements, ...bseAnnouncements];

      for (const item of allAnnouncements) {
        if (!item.announcementId || this.processedAnnouncementIds.has(item.announcementId)) {
          continue;
        }

        this.processedAnnouncementIds.add(item.announcementId);

        if (announcementFilter.isEarningsAnnouncement(item)) {
          console.log(`[BseNseMonitor] Live earnings announcement detected: [${item.source}] ${item.symbol} - ${item.title}`);
          await this.processAnnouncement(item);
        }
      }
    } catch (error) {
      console.error(`[BseNseMonitor] Error during ingestion poll: ${error.message}`);
    } finally {
      this.isPolling = false;
    }
  }

  async processAnnouncement(item) {
    try {
      let pdfAnalysis = { rawText: '', metrics: pdfParserEngine.extractEmptyMetrics(), isScanned: false };

      if (item.pdfUrl) {
        try {
          pdfAnalysis = await pdfParserEngine.parsePdf(item.pdfUrl);
        } catch (err) {
          console.warn(`[BseNseMonitor] PDF parsing notice for ${item.symbol}: ${err.message}`);
        }
      }

      let geminiResult = null;
      if (item.pdfUrl || pdfAnalysis.rawText) {
        try {
          geminiResult = await geminiAnalyzer.analyzeResultPdf(pdfAnalysis.pdfBuffer || pdfAnalysis.rawText, item.symbol);
        } catch (gErr) {
          console.warn(`[BseNseMonitor] Gemini analysis notice for ${item.symbol}: ${gErr.message}`);
        }
      }

      const fundamentals = await fundamentalsService.analyze(item.symbol);
      const combinedMetrics = { ...(fundamentals.metrics || {}), ...(pdfAnalysis.metrics || {}) };
      const aiSummary = aiSummaryEngine.generateSummary(item.symbol, pdfAnalysis.rawText, combinedMetrics);

      let scripInfo = null;
      let ltp = null;
      try {
        scripInfo = await angelOne.searchScrip(item.symbol, 'NSE');
        ltp = await angelOne.getLTP(scripInfo.exchange, scripInfo.tradingsymbol, scripInfo.symboltoken);
      } catch (err) {
        scripInfo = { exchange: 'NSE', tradingsymbol: item.symbol, symboltoken: '0' };
      }

      const entryPrice = ltp || fundamentals.cmp || 500;

      const atr = (entryPrice * 0.02) / (config.risk.atrMultiplier || 2);
      const { stopLoss, atrUsed } = riskEngine.calculateStopLoss('BUY', entryPrice, null, atr);
      const { quantity } = riskEngine.calculatePositionSize(
        entryPrice,
        stopLoss,
        config.risk.accountCapital,
        config.risk.riskPerTrade
      );

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
        atr: atrUsed,
      });

      const tradeRecord = await tradeStore.createTrade({
        symbol: item.symbol,
        action: 'BUY',
        entry: entryPrice,
        ltp: entryPrice,
        stopLoss,
        target: null,
        quantity,
        atr: atrUsed,
        fundamentals: fundamentals.metrics || {},
        decision,
        status: 'ANALYZED',
        telegramMessageId: null,
        telegramChatId: null,
      });

      if (this.bot) {
        const m = pdfAnalysis.metrics;

        let replyMarkup = undefined;
        let buyButtonNotice = '';

        if (tradeRecord) {
          buyButtonNotice = `\n⚡ *Instant Purchase Enabled (INTRADAY)*\n*Entry:* ₹${tradeRecord.entry} | *SL:* ₹${stopLoss} | *Qty:* ${quantity} shares\n`;

          replyMarkup = {
            inline_keyboard: [
              [
                { text: `⚡ 1-CLICK BUY ON ANGEL ONE (${item.symbol})`, callback_data: `CONFIRM_${tradeRecord._id}` },
              ],
              [
                { text: `❌ CANCEL`, callback_data: `CANCEL_${tradeRecord._id}` },
              ]
            ],
          };
        }

        const timeAgoStr = this.getTimeAgo(item.date);
        const compCategory = fundamentals.companyCategory || 'Listed Stock';
        const mcapVal = fundamentals.metrics?.marketCapCr;
        const mcapDisplay = mcapVal ? (mcapVal >= 100000 ? `${(mcapVal / 100000).toFixed(1)}L Cr` : `${(mcapVal / 1000).toFixed(1)}K Cr`) : '-';
        const peDisplay = fundamentals.metrics?.pe ? `${fundamentals.metrics.pe}` : '-';
        const cmpDisplay = entryPrice ? `₹${entryPrice.toFixed(1)}` : '-';
        const valuationDisplay = fundamentals.valuation || 'FAIRLY VALUED ⚖️';

        const displayHeaderSymbol = item.scripCode && item.symbol !== item.scripCode
          ? `${item.symbol} (${item.scripCode})`
          : item.symbol;

        const hashtagSymbol = `#${item.symbol.toUpperCase().replace(/[^A-Z0-9_]/g, '')}`;

        // Gemini Universal Scorecard Integration
        let sQoQStr = '-';
        let sYoYStr = '-';
        let sCurrStr = '-';
        let sPrevStr = '-';
        let sYoYValStr = '-';

        let othQoQStr = '-';
        let othYoYStr = '-';
        let othCurrStr = '-';
        let othPrevStr = '-';
        let othYoYValStr = '-';

        let opQoQStr = '-';
        let opYoYStr = '-';
        let opCurrStr = '-';
        let opPrevStr = '-';
        let opYoYValStr = '-';

        let opmQoQStr = '-';
        let opmYoYStr = '-';
        let opmCurrStr = '-';
        let opmPrevStr = '-';
        let opmYoYValStr = '-';

        let pQoQStr = '-';
        let pYoYStr = '-';
        let patCurrStr = '-';
        let patPrevStr = '-';
        let patYoYValStr = '-';

        let epsQoQStr = '-';
        let epsYoYStr = '-';
        let epsCurrStr = '-';
        let epsPrevStr = '-';
        let epsYoYValStr = '-';

        const sc = geminiResult?.scorecard;
        if (sc) {
          sQoQStr = sc.Sales.QoQ;
          sYoYStr = sc.Sales.YoY;
          sCurrStr = `${sc.Sales.Qt}`;
          sPrevStr = `${sc.Sales.Qt1}`;
          sYoYValStr = `${sc.Sales.Qt4}`;

          othQoQStr = sc['Other Inc.'].QoQ;
          othYoYStr = sc['Other Inc.'].YoY;
          othCurrStr = `${sc['Other Inc.'].Qt}`;
          othPrevStr = `${sc['Other Inc.'].Qt1}`;
          othYoYValStr = `${sc['Other Inc.'].Qt4}`;

          opQoQStr = sc.OP.QoQ;
          opYoYStr = sc.OP.YoY;
          opCurrStr = `${sc.OP.Qt}`;
          opPrevStr = `${sc.OP.Qt1}`;
          opYoYValStr = `${sc.OP.Qt4}`;

          opmQoQStr = sc.OPM.QoQ;
          opmYoYStr = sc.OPM.YoY;
          opmCurrStr = `${sc.OPM.Qt}`;
          opmPrevStr = `${sc.OPM.Qt1}`;
          opmYoYValStr = `${sc.OPM.Qt4}`;

          pQoQStr = sc.PAT.QoQ;
          pYoYStr = sc.PAT.YoY;
          patCurrStr = `${sc.PAT.Qt}`;
          patPrevStr = `${sc.PAT.Qt1}`;
          patYoYValStr = `${sc.PAT.Qt4}`;

          epsQoQStr = sc.EPS.QoQ;
          epsYoYStr = sc.EPS.YoY;
          epsCurrStr = `${sc.EPS.Qt}`;
          epsPrevStr = `${sc.EPS.Qt1}`;
          epsYoYValStr = `${sc.EPS.Qt4}`;
        } else {
          // Direct Extracted PDF Parser Fallback
          sQoQStr = m.salesQoQ !== null && m.salesQoQ !== undefined ? `${m.salesQoQ > 0 ? '+' : ''}${m.salesQoQ}%` : '-';
          sYoYStr = m.salesYoY !== null && m.salesYoY !== undefined ? `${m.salesYoY > 0 ? '+' : ''}${m.salesYoY}%` : '-';
          pQoQStr = m.patQoQ !== null && m.patQoQ !== undefined ? `${m.patQoQ > 0 ? '+' : ''}${m.patQoQ}%` : '-';
          pYoYStr = m.patYoY !== null && m.patYoY !== undefined ? `${m.patYoY > 0 ? '+' : ''}${m.patYoY}%` : '-';
          opmQoQStr = m.opm !== null && m.opm !== undefined ? `${m.opm}%` : '-';

          sCurrStr = m.sales !== null && m.sales !== undefined ? m.sales.toLocaleString('en-IN') : '-';
          sPrevStr = m.salesPrev !== null && m.salesPrev !== undefined ? m.salesPrev.toLocaleString('en-IN') : '-';
          sYoYValStr = m.salesYoYVal !== null && m.salesYoYVal !== undefined ? m.salesYoYVal.toLocaleString('en-IN') : '-';

          othCurrStr = m.otherIncome !== null && m.otherIncome !== undefined ? m.otherIncome.toLocaleString('en-IN') : '-';
          opCurrStr = m.operatingProfit !== null && m.operatingProfit !== undefined ? m.operatingProfit.toLocaleString('en-IN') : '-';
          patCurrStr = m.pat !== null && m.pat !== undefined ? m.pat.toLocaleString('en-IN') : '-';
          epsCurrStr = m.eps !== null && m.eps !== undefined ? m.eps.toString() : '-';
        }

        const labels = geminiResult?.periodLabels || { q_t: "Jun '26", q_t1: "Mar '26", q_t4: "Jun '25" };
        const computedPulseRating = geminiResult?.scorecard?.pulseRating || aiSummary.overallRating || 'Good 👍';

        // ⚡ Gemini Quantitative Scorecard Dashboard Table
        const telegramMsg =
          `🏢 *${displayHeaderSymbol}*  [ ${hashtagSymbol} ]\n` +
          `📢 *OFFICIAL ${item.source} EARNINGS ANNOUNCEMENT*\n\n` +
          `⚡ *Pulse Rating :* \`${computedPulseRating}\` | 💎 *Valuation:* \`${valuationDisplay}\`\n\n` +
          `⚡ *Gemini Quantitative Scorecard Dashboard*\n\n` +
          `| Metric | QoQ | YoY | Current Qtr (${labels.q_t}) | Prev Qtr (${labels.q_t1}) | Prior Year Qtr (${labels.q_t4}) |\n` +
          `|---|:---:|:---:|:---:|:---:|:---:|\n` +
          `| **Sales** | ${sQoQStr} | ${sYoYStr} | **${sCurrStr}** | ${sPrevStr} | ${sYoYValStr} |\n` +
          `| **Other Inc.** | ${othQoQStr} | ${othYoYStr} | **${othCurrStr}** | ${othPrevStr} | ${othYoYValStr} |\n` +
          `| **OP** | ${opQoQStr} | ${opYoYStr} | **${opCurrStr}** | ${opPrevStr} | ${opYoYValStr} |\n` +
          `| **OPM (%)** | ${opmQoQStr} | ${opmYoYStr} | **${opmCurrStr}** | ${opmPrevStr} | ${opmYoYValStr} |\n` +
          `| **PAT** | ${pQoQStr} | ${pYoYStr} | **${patCurrStr}** | ${patPrevStr} | ${patYoYValStr} |\n` +
          `| **EPS** | ${epsQoQStr} | ${epsYoYStr} | **${epsCurrStr}** | ${epsPrevStr} | ${epsYoYValStr} |\n\n` +
          `*CMP : ${cmpDisplay}* | *${compCategory} (${mcapDisplay})* | *P/E : ${peDisplay}*\n\n` +
          `⏱️ *Result Published:* \`${item.date || 'Live'}\` (⚡ *${timeAgoStr}*)\n` +
          (item.pdfUrl ? `📄 *Filing PDF:* [Download Official Filing PDF](${item.pdfUrl})\n` : '') +
          `${buyButtonNotice}`;

        // Generate Ultra-High Resolution PNG Infographic Image Card
        let cardPngBuf = null;
        try {
          cardPngBuf = cardGenerator.generatePngCard({
            symbol: item.symbol,
            scripCode: item.scripCode,
            symbolName: displayHeaderSymbol,
            cmp: cmpDisplay,
            category: compCategory,
            mcapCr: mcapDisplay,
            pe: peDisplay,
            pulseRating: computedPulseRating,
            periodLabels: labels,
            scorecard: sc || {
              Sales: { QoQ: sQoQStr, YoY: sYoYStr, Qt: sCurrStr, Qt1: sPrevStr, Qt4: sYoYValStr },
              'Other Inc.': { QoQ: othQoQStr, YoY: othYoYStr, Qt: othCurrStr, Qt1: othPrevStr, Qt4: othYoYValStr },
              OP: { QoQ: opQoQStr, YoY: opYoYStr, Qt: opCurrStr, Qt1: opPrevStr, Qt4: opYoYValStr },
              OPM: { QoQ: opmQoQStr, YoY: opmYoYStr, Qt: opmCurrStr, Qt1: opmPrevStr, Qt4: opmYoYValStr },
              PAT: { QoQ: pQoQStr, YoY: pYoYStr, Qt: patCurrStr, Qt1: patPrevStr, Qt4: patYoYValStr },
              EPS: { QoQ: epsQoQStr, YoY: epsYoYStr, Qt: epsCurrStr, Qt1: epsPrevStr, Qt4: epsYoYValStr },
            },
          });
        } catch (cardErr) {
          console.warn(`[BseNseMonitor] Card generator notice: ${cardErr.message}`);
        }

        const targetChats = new Set([
          ...config.telegram.authorizedChatIds,
          ...Array.from(this.activeChatIds),
        ]);

        for (const chatId of targetChats) {
          try {
            let sentMsg = null;

            if (cardPngBuf) {
              try {
                sentMsg = await this.bot.sendPhoto(
                  chatId,
                  cardPngBuf,
                  {
                    caption: telegramMsg,
                    parse_mode: 'Markdown',
                    reply_markup: replyMarkup,
                  },
                  { filename: `${item.symbol}_Scorecard_Card.png`, contentType: 'image/png' }
                );
                console.log(`[BseNseMonitor] Sent Scorecard Photo Card for ${item.symbol} to Telegram chat ${chatId}!`);
              } catch (photoErr) {
                console.warn(`[BseNseMonitor] sendPhoto notice for ${item.symbol}: ${photoErr.message}. Falling back to sendMessage...`);
              }
            }

            if (!sentMsg) {
              sentMsg = await this.bot.sendMessage(chatId, telegramMsg, {
                parse_mode: 'Markdown',
                reply_markup: replyMarkup,
                disable_web_page_preview: true,
              });
            }

            if (sentMsg && tradeRecord && !tradeRecord.telegramMessageId) {
              tradeRecord.telegramMessageId = sentMsg.message_id.toString();
              tradeRecord.telegramChatId = chatId.toString();
              await tradeRecord.save();
            }
          } catch (err) {
            console.error(`[BseNseMonitor] Failed to send Gemini response to Telegram chat ${chatId}: ${err.message}`);
          }
        }
      }

      this.recentAnnouncements.unshift({
        id: item.announcementId,
        source: item.source,
        symbol: item.symbol,
        title: item.title,
        date: item.date,
        decisionScore: decision.score,
        recommendation: decision.recommendation,
        overallRating: aiSummary.overallRating,
      });

      if (this.recentAnnouncements.length > 100) {
        this.recentAnnouncements.pop();
      }
    } catch (error) {
      console.error(`[BseNseMonitor] Error processing announcement for ${item.symbol}: ${error.stack}`);
    }
  }

  getRecentAnnouncements(limit = 50) {
    return this.recentAnnouncements.slice(0, limit);
  }
}

module.exports = new BseNseMonitorService();
