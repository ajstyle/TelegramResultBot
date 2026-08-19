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
const cardGenerator = require('../cardGenerator');
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
      const diffMinutes = (Date.now() - annDate.getTime()) / (1000 * 60);
      return diffMinutes <= 15; // Optimal 15-minute window for live BSE/NSE real-time announcements
    } catch (_) {
      return true;
    }
  }

  start(pollingIntervalMs = 1500) {
    if (this.intervalId) return;

    this.isInitialRun = true;
    console.log(`[BseNseMonitor] 24/7 Resilient Ingestion loop started (Polling interval: ${pollingIntervalMs}ms)...`);
    this.pollAnnouncements();
    this.intervalId = setInterval(() => this.pollAnnouncements(), pollingIntervalMs);

    // Watchdog keep-alive timer to guarantee 24/7 continuous polling on Render Cloud
    if (!this.watchdogId) {
      this.watchdogId = setInterval(() => {
        const timeSinceLastPoll = Date.now() - (this.lastPollTimestamp || Date.now());
        if (timeSinceLastPoll > 15000 || !this.intervalId) {
          console.warn(`[BseNseMonitor Watchdog] Polling loop stalled (${Math.round(timeSinceLastPoll / 1000)}s since last poll). Auto-restarting ingestion loop...`);
          this.isPolling = false;
          if (this.intervalId) clearInterval(this.intervalId);
          this.intervalId = setInterval(() => this.pollAnnouncements(), pollingIntervalMs);
          this.pollAnnouncements();
        }
      }, 5000);
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
    this.isPolling = false;
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

      // On initial startup run, seed existing feed items to prevent re-broadcasting old announcements
      if (this.isInitialRun) {
        console.log(`[BseNseMonitor] Initial startup run: Indexing ${allAnnouncements.length} existing feed announcements to prevent old notifications...`);
        const deduplicator = require('./deduplicator');
        for (const item of allAnnouncements) {
          if (item.announcementId) {
            this.processedAnnouncementIds.add(item.announcementId);
            deduplicator.isUnique(item);
          }
        }
        this.isInitialRun = false;
        return;
      }

      for (const item of allAnnouncements) {
        if (!item.announcementId || this.processedAnnouncementIds.has(item.announcementId)) {
          continue;
        }

        if (!this.isRecentAnnouncement(item.date)) {
          console.log(`[BseNseMonitor] 🛑 Suppressed OLD/ARCHIVED announcement for ${item.symbol} (Date: ${item.date || 'Old'})`);
          this.processedAnnouncementIds.add(item.announcementId);
          continue;
        }

        this.processedAnnouncementIds.add(item.announcementId);

        if (announcementFilter.isEarningsAnnouncement(item)) {
          item.isFinancialEarnings = true;
          const deduplicator = require('./deduplicator');
          if (!deduplicator.isUnique(item)) {
            console.log(`[BseNseMonitor] 🛑 Suppressed duplicate announcement for ${item.symbol} (${item.announcementId})`);
            continue;
          }
          console.log(`[BseNseMonitor] Live earnings announcement detected: [${item.source}] ${item.symbol} - ${item.title}`);
          this.lastPollTimestamp = Date.now();
          await this.processAnnouncement(item);
          this.lastPollTimestamp = Date.now();
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
      const fundamentalsService = require('../fundamentals');
      const marketCapClassifier = require('../universe/marketCapClassifier');

      // Ultra-Low Latency: Run Fundamentals, PDF Parsing, and Angel One LTP fetch in PARALLEL
      const [fundamentals, pdfAnalysis, angelResult] = await Promise.all([
        fundamentalsService.analyze(item.symbol, item.scripCode).catch(() => ({ metrics: {}, companyCategory: 'Listed Stock', marketCapCr: 0 })),
        
        (async () => {
          if (!item.pdfUrl) return { rawText: '', metrics: pdfParserEngine.extractEmptyMetrics(), isScanned: false };
          try {
            if (item.source === 'BSE' && item.announcementId) {
              const bseAdapter = require('../adapters/bseAdapter');
              const cleanGuid = item.announcementId.replace('BSE_', '');
              const directPdf = await bseAdapter.resolvePdfUrl(null, cleanGuid);
              if (directPdf) item.pdfUrl = directPdf; // Update reference so Telegram card uses direct PDF link
            }
            return await pdfParserEngine.parsePdf(item.pdfUrl);
          } catch (err) {
            console.warn(`[BseNseMonitor] PDF parsing notice for ${item.symbol}: ${err.message}`);
            return { rawText: '', metrics: pdfParserEngine.extractEmptyMetrics(), isScanned: false };
          }
        })(),

        (async () => {
          try {
            const scripInfo = await angelOne.searchScrip(item.symbol, 'NSE');
            const ltp = await angelOne.getLTP(scripInfo.exchange, scripInfo.tradingsymbol, scripInfo.symboltoken);
            return { scripInfo, ltp };
          } catch (err) {
            return { scripInfo: { exchange: 'NSE', tradingsymbol: item.symbol, symboltoken: '0' }, ltp: null };
          }
        })()
      ]);

      // 0. Hard Universe Filter Guard: capCategory IN ['LARGE_CAP', 'MID_CAP', 'SMALL_CAP']
      const mcapCr = fundamentals.metrics?.marketCapCr || fundamentals.marketCapCr || 0;
      const classification = marketCapClassifier.classifyMarketCap(mcapCr, 'EQUITY');

      if (!classification.isAllowed) {
        console.warn(`[BseNseMonitor] 🛑 EXCLUDED UNIVERSE: Suppressing scorecard photo card & Telegram broadcast for ${item.symbol} - ${classification.reason}`);
        return;
      }

      let geminiResult = null;
      if (item.pdfUrl || pdfAnalysis.rawText) {
        try {
          geminiResult = await geminiAnalyzer.analyzeResultPdf(pdfAnalysis.pdfBuffer || pdfAnalysis.rawText, item.symbol, { isLiveBroadcast: true });
        } catch (gErr) {
          console.warn(`[BseNseMonitor] Gemini analysis notice for ${item.symbol}: ${gErr.message}`);
        }
      }

      // Hard Abort Guard: Prevent broadcasting BLANK scorecards or OLD results
      const hasScorecardNumbers = geminiResult?.scorecard?.Sales || geminiResult?.scorecard?.PAT;
      if (!geminiResult || !hasScorecardNumbers) {
        console.warn(`[BseNseMonitor] 🛑 Aborting Telegram broadcast for ${item.symbol}: Parsed metrics are mostly zeroes. Suppressing image.`);
        return;
      }

      const combinedMetrics = { ...(fundamentals.metrics || {}), ...(pdfAnalysis.metrics || {}) };
      const aiSummary = aiSummaryEngine.generateSummary(item.symbol, pdfAnalysis.rawText, combinedMetrics);

      let scripInfo = angelResult.scripInfo;
      let ltp = angelResult.ltp;

      let liveCmp = ltp || fundamentals.cmp || fundamentals.metrics?.cmp;
      if (!liveCmp) {
        try {
          const fundamentalsProvider = require('../fundamentals/provider');
          liveCmp = await fundamentalsProvider.fetchLivePrice(item.symbol, item.scripCode);
        } catch (_) {}
      }

      const entryPrice = liveCmp && liveCmp > 0 ? liveCmp : null;

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
                { text: `🪁 1-CLICK BUY ON ZERODHA KITE (${item.symbol})`, callback_data: `CONFIRM_KITE_${tradeRecord._id}` },
              ],
              [
                { text: `❌ CANCEL`, callback_data: `CANCEL_${tradeRecord._id}` },
              ]
            ],
          };
        }

        const timeAgoStr = this.getTimeAgo(item.date);
        const compCategory = fundamentals.companyCategory || 'Listed Stock';
        const mcapVal = fundamentals.metrics?.marketCapCr !== undefined && fundamentals.metrics?.marketCapCr !== null
          ? fundamentals.metrics.marketCapCr
          : fundamentals.marketCapCr;

        const mcapDisplay = mcapVal
          ? (mcapVal >= 100000
              ? `${(mcapVal / 100000).toFixed(1)}L Cr`
              : mcapVal >= 1000
                ? `${(mcapVal / 1000).toFixed(1)}K Cr`
                : `${mcapVal} Cr`)
          : '-';
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

        let sc = geminiResult?.scorecard;

        // Fallback Scorecard Construction: If Gemini scorecard is missing, construct from extracted PDF metrics
        if (!sc && m) {
          const sQt = m.sales || 0;
          const sQt1 = m.salesPrev || 0;
          const sQt4 = m.salesYoYVal || 0;
          const pQt = m.pat || 0;
          const pQt1 = m.patPrev || 0;
          const pQt4 = m.patYoYVal || 0;
          const opQt = m.operatingProfit || 0;
          const opQt1 = m.opPrev || 0;
          const opQt4 = m.opYoYVal || 0;

          if (sQt > 0 || pQt > 0 || opQt > 0) {
            const calculateQoQ = (curr, prev) => {
              if (curr === null || curr === undefined || prev === null || prev === undefined) return '-';
              if (prev === 0) return curr > 0 ? '+100%' : (curr < 0 ? '-100%' : '-');
              const pct = Math.round(((curr - prev) / Math.abs(prev)) * 100);
              return `${pct >= 0 ? '+' : ''}${pct}%`;
            };
            const calculateYoY = (curr, yoy) => {
              if (curr === null || curr === undefined || yoy === null || yoy === undefined) return '-';
              if (yoy === 0) return curr > 0 ? '+100%' : (curr < 0 ? '-100%' : '-');
              const pct = Math.round(((curr - yoy) / Math.abs(yoy)) * 100);
              return `${pct >= 0 ? '+' : ''}${pct}%`;
            };

            sc = {
              pulseRating: 'Good 👍',
              Sales: { QoQ: calculateQoQ(sQt, sQt1), YoY: calculateYoY(sQt, sQt4), Qt: sQt, Qt1: sQt1, Qt4: sQt4 },
              'Other Inc.': { QoQ: '-', YoY: '-', Qt: m.otherIncome || 0, Qt1: 0, Qt4: 0 },
              OP: { QoQ: calculateQoQ(opQt, opQt1), YoY: calculateYoY(opQt, opQt4), Qt: opQt, Qt1: opQt1, Qt4: opQt4 },
              OPM: { QoQ: m.opm ? `${m.opm}%` : '-', YoY: '-', Qt: m.opm ? `${m.opm}%` : '-', Qt1: '-', Qt4: '-' },
              PAT: { QoQ: calculateQoQ(pQt, pQt1), YoY: calculateYoY(pQt, pQt4), Qt: pQt, Qt1: pQt1, Qt4: pQt4 },
              EPS: { QoQ: '-', YoY: '-', Qt: m.eps || 0, Qt1: 0, Qt4: 0 },
            };
          }
        }

        const isScValid = Boolean(
          sc && (
            (sc.Sales && sc.Sales.Qt !== undefined && sc.Sales.Qt !== '-' && sc.Sales.Qt !== null) ||
            (sc.PAT && sc.PAT.Qt !== undefined && sc.PAT.Qt !== '-' && sc.PAT.Qt !== null) ||
            (sc.OP && sc.OP.Qt !== undefined && sc.OP.Qt !== '-' && sc.OP.Qt !== null)
          )
        );

        if (isScValid) {
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
          opPrevStr = m.opPrev !== null && m.opPrev !== undefined ? m.opPrev.toLocaleString('en-IN') : '-';
          opYoYValStr = m.opYoYVal !== null && m.opYoYVal !== undefined ? m.opYoYVal.toLocaleString('en-IN') : '-';

          patCurrStr = m.pat !== null && m.pat !== undefined ? m.pat.toLocaleString('en-IN') : '-';
          patPrevStr = m.patPrev !== null && m.patPrev !== undefined ? m.patPrev.toLocaleString('en-IN') : '-';
          patYoYValStr = m.patYoYVal !== null && m.patYoYVal !== undefined ? m.patYoYVal.toLocaleString('en-IN') : '-';

          epsCurrStr = m.eps !== null && m.eps !== undefined ? m.eps.toString() : '-';
        }

        const labels = geminiResult?.periodLabels || { q_t: "Jun '26", q_t1: "Mar '26", q_t4: "Jun '25" };
        const computedPulseRating = sc?.pulseRating || aiSummary.overallRating || 'Good 👍';

        // Construct ultra-clean single-line horizontal Telegram message caption
        const telegramMsg =
          `📢 ${hashtagSymbol}   |   ⏱️ ⚡ *${timeAgoStr}*` +
          (item.pdfUrl ? `   |   📄 [PDF](${item.pdfUrl})` : '');

        // Generate Ultra-High Resolution PNG Infographic Image Card (ONLY if valid financial numbers exist)
        let cardPngBuf = null;
        if (isScValid) {
          try {
            const qualityScoringEngine = require('../quality/qualityScoringEngine');
            const adaptiveValuationEngine = require('../valuation/adaptiveValuationEngine');

            const [qualityRes, dynamicValuationLabel] = await Promise.all([
              qualityScoringEngine.calculateQualityScore(item.symbol, fundamentals.metrics || fundamentals),
              adaptiveValuationEngine.evaluateStockLabel(item.symbol, fundamentals.metrics || fundamentals),
            ]);

            cardPngBuf = cardGenerator.generatePngCard({
              symbol: item.symbol,
              scripCode: item.scripCode,
              symbolName: displayHeaderSymbol,
              cmp: cmpDisplay,
              category: compCategory,
              mcapCr: mcapDisplay,
              pe: peDisplay,
              qualityScore: qualityRes.qualityScore,
              qualityStatus: qualityRes.statusLabel,
              valuationLabel: dynamicValuationLabel,
              pulseRating: computedPulseRating,
              periodLabels: labels,
              scorecard: sc,
            });
          } catch (cardErr) {
            console.warn(`[BseNseMonitor] Card generator notice: ${cardErr.message}`);
          }
        }

        if (!cardPngBuf) {
          console.warn(`[BseNseMonitor] Suppressed card-less broadcast for ${item.symbol} - photo card is strictly required.`);
          return;
        }

        const targetChats = new Set([
          ...config.telegram.authorizedChatIds,
          ...Array.from(this.activeChatIds),
        ]);

        if (config.telegram.targetChannel) {
          const rawCh = config.telegram.targetChannel.trim();
          if (rawCh) {
            const formattedCh = (rawCh.startsWith('@') || rawCh.startsWith('-') || /^-?\d+$/.test(rawCh)) ? rawCh : `@${rawCh}`;
            targetChats.add(formattedCh);
          }
        }

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
                const errMsg = photoErr.message || '';
                console.warn(`[BseNseMonitor] sendPhoto notice for ${item.symbol} (chat ${chatId}): ${errMsg}`);
                if (errMsg.includes('chat not found') || errMsg.includes('bot was blocked') || errMsg.includes('user is deactivated') || errMsg.includes('Forbidden')) {
                  this.activeChatIds.delete(chatId);
                  console.warn(`[BseNseMonitor] Evicted invalid or non-existent Telegram chat target ${chatId}.`);
                }
              }
            }

            if (sentMsg && tradeRecord && !tradeRecord.telegramMessageId) {
              tradeRecord.telegramMessageId = sentMsg.message_id.toString();
              tradeRecord.telegramChatId = chatId.toString();
              await tradeRecord.save();
            }
          } catch (err) {
            const errMsg = err.message || '';
            console.error(`[BseNseMonitor] Failed to send Gemini response to Telegram chat ${chatId}: ${errMsg}`);
            if (errMsg.includes('chat not found') || errMsg.includes('bot was blocked') || errMsg.includes('user is deactivated') || errMsg.includes('Forbidden')) {
              this.activeChatIds.delete(chatId);
            }
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
