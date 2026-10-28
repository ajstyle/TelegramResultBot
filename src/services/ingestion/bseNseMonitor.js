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
    this.isProcessingAnnouncement = false;
  }

  setBotInstance(botInstance) {
    this.bot = botInstance;
  }

  addActiveChatId(chatId) {
    if (chatId) {
      this.activeChatIds.add(chatId.toString());
    }
  }

  parseAnnouncementDate(dateInput) {
    if (!dateInput) return null;
    try {
      if (typeof dateInput === 'string') {
        // Handle NSE format: 27-Oct-2026 16:54:16
        const nseMatch = dateInput.match(/(\d{1,2})[-/ ]([A-Za-z]{3})[-/ ](\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})/);
        if (nseMatch) {
          const monthNames = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
          const [, day, monthStr, year, hrs, mins, secs] = nseMatch;
          const month = monthNames[monthStr.toLowerCase()];
          if (month !== undefined) {
            // IST is UTC + 5:30. Subtract 5h 30m to get exact UTC timestamp regardless of server host timezone
            return new Date(Date.UTC(parseInt(year, 10), month, parseInt(day, 10), parseInt(hrs, 10) - 5, parseInt(mins, 10) - 30, parseInt(secs, 10)));
          }
        }

        // Handle DD/MM/YYYY or DD-MM-YYYY HH:mm:ss format
        const ddmmyyyyMatch = dateInput.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})/);
        if (ddmmyyyyMatch) {
          const [, day, month, year, hrs, mins, secs] = ddmmyyyyMatch;
          return new Date(Date.UTC(parseInt(year, 10), parseInt(month, 10) - 1, parseInt(day, 10), parseInt(hrs, 10) - 5, parseInt(mins, 10) - 30, parseInt(secs, 10)));
        }
      }

      const parsed = new Date(dateInput);
      return isNaN(parsed.getTime()) ? null : parsed;
    } catch (_) {
      return null;
    }
  }

  getTimeAgo(dateInput) {
    if (!dateInput) return '0 secs ago';
    const annDate = this.parseAnnouncementDate(dateInput);
    if (!annDate) return '0 secs ago';

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
      const annDate = this.parseAnnouncementDate(dateInput);
      if (!annDate) return true;

      const diffMinutes = (Date.now() - annDate.getTime()) / (1000 * 60);
      // Strictly reject announcements older than 15 minutes or from past days, allowing up to 5 min clock skew
      return diffMinutes >= -5 && diffMinutes <= 15;
    } catch (_) {
      return true;
    }
  }

  start(pollingIntervalMs = 500) {
    if (this.intervalId) return;

    this.isInitialRun = true;
    console.log(`[BseNseMonitor] 24/7 Resilient Ingestion loop started (Polling interval: ${pollingIntervalMs}ms)...`);
    this.pollAnnouncements();
    this.intervalId = setInterval(() => this.pollAnnouncements(), pollingIntervalMs);

    // Watchdog keep-alive timer to guarantee 24/7 continuous polling on Render/Oracle Cloud
    if (!this.watchdogId) {
      this.watchdogId = setInterval(() => {
        const timeSinceLastPoll = Date.now() - (this.lastPollTimestamp || Date.now());
        if ((!this.isProcessingAnnouncement && timeSinceLastPoll > 60000) || !this.intervalId) {
          console.warn(`[BseNseMonitor Watchdog] Polling loop stalled (${Math.round(timeSinceLastPoll / 1000)}s since last poll). Auto-restarting ingestion loop...`);
          this.isPolling = false;
          if (this.intervalId) clearInterval(this.intervalId);
          this.intervalId = setInterval(() => this.pollAnnouncements(), pollingIntervalMs);
          this.pollAnnouncements();
        }
      }, 10000);
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
          // Asynchronous non-blocking dispatch: guarantees 500ms real-time polling loop is NEVER delayed!
          this.processAnnouncement(item).catch((err) => {
            console.error(`[BseNseMonitor] Background processing error for ${item.symbol}: ${err.message}`);
          });
        }
      }
    } catch (error) {
      console.error(`[BseNseMonitor] Error during ingestion poll: ${error.message}`);
    } finally {
      this.isPolling = false;
    }
  }

  async processAnnouncement(item) {
    this.isProcessingAnnouncement = true;
    this.lastPollTimestamp = Date.now();
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
            if (angelOne.circuitBreakerUntil && Date.now() < angelOne.circuitBreakerUntil) {
              return { scripInfo: { exchange: 'NSE', tradingsymbol: item.symbol, symboltoken: '0' }, ltp: null };
            }
            const angelTask = (async () => {
              const scripInfo = await angelOne.searchScrip(item.symbol, 'NSE');
              const ltp = await angelOne.getLTP(scripInfo.exchange, scripInfo.tradingsymbol, scripInfo.symboltoken);
              return { scripInfo, ltp };
            })();
            const timeoutTask = new Promise(resolve =>
              setTimeout(() => resolve({ scripInfo: { exchange: 'NSE', tradingsymbol: item.symbol, symboltoken: '0' }, ltp: null }), 1500)
            );
            return await Promise.race([angelTask, timeoutTask]);
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

      // Resolve clean stock symbol for display & Telegram notification
      const activeSymbol = (fundamentals.symbol && !/^\d+$/.test(fundamentals.symbol)) 
        ? fundamentals.symbol 
        : ((item.symbol && !/^\d+$/.test(item.symbol)) ? item.symbol : (item.scripCode || 'STOCK'));

      // Phase 1: Instant Flash Notice (~1-2s) — ONLY sent for allowed universe stocks!
      if (this.bot) {
        const flashTargetChats = new Set([
          ...config.telegram.authorizedChatIds,
          ...Array.from(this.activeChatIds),
        ]);
        if (config.telegram.targetChannel) {
          const rawCh = config.telegram.targetChannel.trim();
          if (rawCh) {
            const formattedCh = (rawCh.startsWith('@') || rawCh.startsWith('-') || /^-?\d+$/.test(rawCh)) ? rawCh : `@${rawCh}`;
            flashTargetChats.add(formattedCh);
          }
        }
        const cleanTitle = (item.title || 'Quarterly Financial Results').replace(/[*_`]/g, '');
        const flashMsg = `⚡ *BREAKING EARNINGS FILING*\n📢 #${activeSymbol} (${item.source})\n📄 *Title:* ${cleanTitle}\n⏱️ ⚡ *Just Now*\n⏳ *Analyzing financial results with AI... Scorecard Card arriving in seconds!*`;
        for (const chatId of flashTargetChats) {
          this.bot.sendMessage(chatId, flashMsg, { parse_mode: 'Markdown', disable_web_page_preview: true }).catch(() => {});
        }
      }

      let geminiResult = null;
      if (item.pdfUrl || pdfAnalysis.rawText) {
        const hasValidMetrics = (sc) => {
          if (!sc) return false;
          const parseVal = (v) => {
            if (v === null || v === undefined || v === '-' || String(v).toLowerCase() === 'null') return 0;
            const num = parseFloat(String(v).replace(/[^0-9.-]/g, ''));
            return isNaN(num) ? 0 : num;
          };
          return parseVal(sc.Sales?.Qt) !== 0 || parseVal(sc.PAT?.Qt) !== 0 || parseVal(sc.EPS?.Qt) !== 0;
        };

        // === VISION-FIRST ARCHITECTURE (Permanent fix for blank/wrong cards) ===
        // Vision (PDF buffer → Gemini) is always more accurate because Gemini can SEE
        // the financial table directly, even in scanned/image-based PDFs.
        // Text route is unreliable: pdf-parse often extracts only cover letter text
        // from image-based PDFs, causing Gemini to hallucinate plausible-looking wrong numbers.

        // 1. PRIMARY ROUTE: Multimodal Vision Analysis (PDF buffer)
        try {
          if (pdfAnalysis.pdfBuffer) {
            console.log(`[BseNseMonitor] 🔍 ${item.symbol}: Vision-First analysis (PDF buffer → Gemini)...`);
            geminiResult = await geminiAnalyzer.analyzeResultPdf(pdfAnalysis.pdfBuffer, item.symbol, { isLiveBroadcast: true, rawText: pdfAnalysis.rawText });
          }
        } catch (visionErr) {
          console.warn(`[BseNseMonitor] Vision Route failed for ${item.symbol} (${visionErr.message}). Proceeding to Text Fallback...`);
          geminiResult = null;
        }

        // 2. TEXT FALLBACK: Only if vision failed/unavailable AND text passes quality check
        try {
          if ((!geminiResult || !hasValidMetrics(geminiResult.scorecard)) && pdfAnalysis.rawText) {
            // textQualityCheck is a static method on GeminiFinancialAnalyzer class
            const textIsReliable = geminiAnalyzer.constructor.textQualityCheck(pdfAnalysis.rawText);

            if (textIsReliable) {
              console.warn(`[BseNseMonitor] ⚠️ ${item.symbol}: Vision failed or returned blank. Falling back to Text Route (text quality verified)...`);
              geminiResult = await geminiAnalyzer.analyzeResultPdf(pdfAnalysis.rawText, item.symbol, { isLiveBroadcast: true });
            } else {
              console.warn(`[BseNseMonitor] ⚠️ ${item.symbol}: Text quality check FAILED (no readable financial table in extracted text). Skipping text fallback.`);
            }
          }
        } catch (textErr) {
          console.warn(`[BseNseMonitor] Text Fallback failed for ${item.symbol}: ${textErr.message}`);
        }
      }

      // Hard Abort Guard: Prevent broadcasting BLANK scorecards
      const finalCheckValid = (sc) => {
        if (!sc) return false;
        const p = (v) => {
          if (v === null || v === undefined || v === '-' || String(v).toLowerCase() === 'null') return 0;
          const num = parseFloat(String(v).replace(/[^0-9.-]/g, ''));
          return isNaN(num) ? 0 : num;
        };
        // Current quarter must have at least Sales or PAT or EPS
        const hasCurrentQtr = p(sc.Sales?.Qt) !== 0 || p(sc.PAT?.Qt) !== 0 || p(sc.EPS?.Qt) !== 0;
        return hasCurrentQtr;
      };
      
      if (!geminiResult || !finalCheckValid(geminiResult.scorecard)) {
        console.warn(`[BseNseMonitor] 🛑 Aborting Telegram broadcast for ${item.symbol}: Both Vision and Text routes failed to find valid metrics. Suppressing blank image.`);
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

      // Non-blocking asynchronous trade creation to avoid delaying card generation
      const tradeRecordPromise = tradeStore.createTrade({
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
      }).catch(err => {
        console.warn(`[BseNseMonitor] Non-blocking trade creation notice: ${err.message}`);
        return null;
      });

      if (this.bot) {
        const tradeRecord = await tradeRecordPromise;
        const m = pdfAnalysis.metrics;

        // Guaranteed trade ID so 1-Click Buy & Cancel buttons ALWAYS show on earnings messages
        let tradeId = (tradeRecord && tradeRecord._id) ? tradeRecord._id.toString() : null;
        if (!tradeId) {
          tradeId = `MEM_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
          const fallbackTrade = {
            _id: tradeId,
            symbol: activeSymbol,
            action: 'BUY',
            entry: entryPrice || 100,
            stopLoss: stopLoss || ((entryPrice || 100) * 0.98),
            quantity: quantity || 1,
            status: 'ANALYZED',
            save: async function () { return this; },
          };
          tradeStore.createTrade(fallbackTrade).catch(() => {});
        }

        const replyMarkup = {
          inline_keyboard: [
            [
              { text: `⚡ 1-CLICK BUY (${activeSymbol})`, callback_data: `CONFIRM_KITE_${tradeId}` },
            ],
            [
              { text: `❌ CANCEL`, callback_data: `CANCEL_${tradeId}` },
            ]
          ],
        };

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
        const displayHeaderSymbol = item.scripCode && activeSymbol !== item.scripCode
          ? `${activeSymbol} (${item.scripCode})`
          : activeSymbol;

        const hashtagSymbol = `#${activeSymbol.toUpperCase().replace(/[^A-Z0-9_]/g, '')}`;

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

            const tradeRecord = await tradeRecordPromise;
            if (sentMsg && tradeRecord && !tradeRecord.telegramMessageId) {
              tradeRecord.telegramMessageId = sentMsg.message_id.toString();
              tradeRecord.telegramChatId = chatId.toString();
              await tradeRecord.save().catch(() => {});
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
    } finally {
      this.isProcessingAnnouncement = false;
      this.lastPollTimestamp = Date.now();
    }
  }

  getRecentAnnouncements(limit = 50) {
    return this.recentAnnouncements.slice(0, limit);
  }
}

module.exports = new BseNseMonitorService();
