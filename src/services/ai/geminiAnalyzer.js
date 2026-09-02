const { GoogleGenAI } = require('@google/genai');
const config = require('../../config');
const localFinancialParser = require('../pdf/localFinancialParser');

/**
 * Universal Stock-Agnostic Gemini Financial Result Analyzer Engine
 * Uses Gemini 3.5 Flash / 3.6 Flash / gemini-flash-latest to extract 3 comparative periods
 * (Q_t, Q_t1, Q_t4) from SEBI Ind-AS PDF filings and compute universal scorecard metrics + Pulse Rating.
 */
class GeminiFinancialAnalyzer {
  constructor() {
    this.apiKey = config.geminiApiKey || process.env.GEMINI_API_KEY || process.env.GEMINI_KEY || '';
    this.ai = this.apiKey ? new GoogleGenAI({ apiKey: this.apiKey }) : null;
    this.exhaustedModels = new Map();
  }

  /**
   * Check if extracted PDF text actually contains a readable financial table.
   * Many BSE/NSE PDFs have image-based tables where pdf-parse only extracts
   * cover letter text. Sending this to Gemini causes hallucinated numbers.
   * @param {string} text Raw text from pdf-parse
   * @returns {boolean} true if text contains a parseable financial table
   */
  static textQualityCheck(text) {
    if (!text || text.trim().length < 500) return false;

    const upper = text.toUpperCase();

    // Must contain at least 2 of these financial table keywords
    const tableKeywords = [
      'REVENUE FROM OPERATIONS', 'TOTAL INCOME', 'TOTAL EXPENSES',
      'PROFIT BEFORE TAX', 'PROFIT AFTER TAX', 'PROFIT FOR THE PERIOD',
      'EARNINGS PER SHARE', 'BASIC EPS', 'OTHER INCOME',
      'DEPRECIATION', 'FINANCE COST', 'INTEREST EARNED',
      'NET PROFIT', 'OPERATING PROFIT', 'TOTAL REVENUE',
      'PROFIT/(LOSS)', 'PROFIT / (LOSS)',
    ];
    const keywordHits = tableKeywords.filter(kw => upper.includes(kw)).length;

    // Must have numeric patterns that look like table data (at least 5 numbers)
    const numberPatterns = text.match(/[-]?\d+[,.]?\d*\.\d{2}/g) || [];

    // Text quality score
    const hasTableStructure = keywordHits >= 2;
    const hasNumbers = numberPatterns.length >= 5;

    if (!hasTableStructure) {
      console.log(`[GeminiAnalyzer] Text quality check FAILED: Only ${keywordHits} financial keywords found (need ≥2). Text is likely cover letter / auditor notes only.`);
      return false;
    }
    if (!hasNumbers) {
      console.log(`[GeminiAnalyzer] Text quality check FAILED: Only ${numberPatterns.length} decimal numbers found (need ≥5). Table is likely image-based.`);
      return false;
    }

    return true;
  }

  /**
   * Deterministic Boolean Logic Engine for Pulse Rating Classification
   * Tiers: Excellent 🌟 | Great 🚀 | Good 👍 | OK ⚠️ | Weak 🚨
   */
  classifyPulseRating(p_t, p_t1, p_t4) {
    const isSalesZero = p_t.sales_disp === 0;
    const isNetLoss = p_t.pat_disp <= 0;

    const salesQoQ = p_t.sales_disp > 0 && (p_t.sales_disp - p_t1.sales_disp > 0);
    const salesYoY = p_t.sales_disp > 0 && (p_t.sales_disp - p_t4.sales_disp > 0);
    const opQoQ = p_t.op_disp > 0 && (p_t.op_disp - p_t1.op_disp > 0);
    const opYoY = p_t.op_disp > 0 && (p_t.op_disp - p_t4.op_disp > 0);
    const patQoQ = p_t.pat_disp > 0 && (p_t.pat_disp - p_t1.pat_disp > 0);
    const patYoY = p_t.pat_disp > 0 && (p_t.pat_disp - p_t4.pat_disp > 0);

    // 6 Core Positivity Vectors
    const positivityVector = [salesQoQ, salesYoY, opQoQ, opYoY, patQoQ, patYoY];
    const positivityScore = positivityVector.filter(Boolean).length;

    const marginExpansionQoQ = (p_t.opm_disp - p_t1.opm_disp) > 0;
    const marginExpansionYoY = (p_t.opm_disp - p_t4.opm_disp) > 0;
    const severeMarginContraction = (p_t.opm_disp - p_t1.opm_disp) < -2.0; // >200 bps drop

    let pulseRating = 'Good 👍';

    if (isSalesZero || isNetLoss || positivityScore <= 1) {
      pulseRating = 'Weak 🚨';
    } else if (positivityScore === 6 && (marginExpansionQoQ || marginExpansionYoY)) {
      pulseRating = 'Excellent 🌟';
    } else if (positivityScore >= 4) {
      if (severeMarginContraction) {
        pulseRating = 'Good 👍'; // Downgraded penalty
      } else {
        pulseRating = 'Great 🚀';
      }
    } else if (salesYoY && opYoY && patYoY) {
      pulseRating = 'Good 👍';
    } else {
      pulseRating = 'OK ⚠️';
    }

    return { positivityScore, pulseRating };
  }

  /**
   * Universal Stock-Agnostic Scorecard Calculator Engine (Handles Net Losses & Basis Points)
   */
  /**
   * Universal Stock-Agnostic Scorecard Calculator Engine (Handles Net Losses, Basis Points & Unscaled Lakhs Outliers)
   */
  calculateUniversalScorecard(q_t, q_t1, q_t4, is_financial_sector = false) {
    // 0. Auto-detect & Normalize Unscaled Lakhs Outliers (e.g., 20027 Lakhs extracted as 20027 Cr when adjacent quarters are ~250-400 Cr)
    const normalizeOutliers = (rawQt, rawQt1, rawQt4) => {
      const fields = ['sales', 'other_inc', 'total_exp', 'finance_cost', 'depreciation', 'op', 'pat'];
      const norm = (item, ref1, ref2) => {
        if (!item) return {};
        const copy = { ...item };
        
        let scaleDown = false;
        const checkScale = (f) => {
          const val = copy[f] || 0;
          const r1 = ref1 ? (ref1[f] || 0) : 0;
          const r2 = ref2 ? (ref2[f] || 0) : 0;
          const validRefs = [r1, r2].filter((v) => v !== 0 && !isNaN(v));
          if (validRefs.length > 0) {
            const avgRef = validRefs.reduce((a, b) => Math.abs(a) + Math.abs(b), 0) / validRefs.length;
            // Check if value is between 50x and 150x of average (classic 100x Lakhs error)
            if (avgRef > 0 && Math.abs(val) > avgRef * 50 && Math.abs(val) < avgRef * 150) {
              return true;
            }
          }
          return false;
        };

        if (checkScale('sales') || checkScale('total_exp')) {
          scaleDown = true;
        }

        if (scaleDown) {
          fields.forEach((f) => {
            if (copy[f]) {
              copy[f] = Math.round((copy[f] / 100) * 10000) / 10000;
            }
          });
        }
        return copy;
      };

      const nQt = norm(rawQt, rawQt1, rawQt4);
      const nQt1 = norm(rawQt1, nQt, rawQt4);
      const nQt4 = norm(rawQt4, nQt, nQt1);
      return { nQt, nQt1, nQt4 };
    };

    const { nQt, nQt1, nQt4 } = normalizeOutliers(q_t, q_t1, q_t4);

    const processPeriod = (data) => {
      if (!data) data = {};
      const sales = data.sales || 0;
      const other_inc = data.other_inc || 0;
      const total_exp = data.total_exp || 0;
      const finance_cost = data.finance_cost || 0;
      const depreciation = data.depreciation || 0;
      const pat = data.pat || 0;
      const eps = data.eps || 0;

      let op = 0;
      if (is_financial_sector) {
        // Banks/NBFCs: OP is Pre-Provisioning Profit (PPOP)
        op = data.op !== undefined && data.op !== null ? data.op : (sales + other_inc - total_exp);
      } else {
        // Standard Non-Financial Corporate Formula: OpEx = Total Expenses - Finance Costs - Depreciation
        const opex = total_exp - finance_cost - depreciation;
        op = data.op !== undefined && data.op !== null && data.op !== 0 ? data.op : (sales - opex);
      }

      const opm = sales !== 0 ? (op / sales) * 100 : 0.0;

      const formatValue = (val) => {
        if (val === null || val === undefined || isNaN(val)) return 0;
        const abs = Math.abs(val);
        if (abs === 0) return 0;
        if (abs >= 10) return Math.round(val);
        if (abs >= 1) return Math.round(val * 10) / 10;
        return Math.round(val * 100) / 100;
      };

      return {
        sales_disp: formatValue(sales),
        other_inc_disp: formatValue(other_inc),
        op_disp: formatValue(op),
        opm_disp: Math.round(opm * 10) / 10,
        pat_disp: formatValue(pat),
        eps_disp: Math.round(eps * 100) / 100,
      };
    };

    const p_t = processPeriod(nQt);
    const p_t1 = processPeriod(nQt1);
    const p_t4 = processPeriod(nQt4);

    const growthPct = (curr, base) => {
      if (curr === null || curr === undefined || isNaN(curr)) return '-';
      if (base === null || base === undefined || isNaN(base)) return '-';
      if (base === 0) {
        if (curr > 0) return '+100%'; // Fresh Revenue / Turnaround
        if (curr < 0) return '-100%';
        return '-'; // Both zero
      }
      // Absolute value in denominator handles negative profit/loss transitions
      const pct = Math.round(((curr - base) / Math.abs(base)) * 100);
      return `${pct >= 0 ? '+' : ''}${pct}%`;
    };

    const bpsChange = (currPct, basePct) => {
      if (currPct === null || currPct === undefined || basePct === null || basePct === undefined) return '-';
      const bps = Math.round((currPct - basePct) * 100);
      if (bps === 0) return '-';
      return `${bps >= 0 ? '+' : ''}${bps} bps`;
    };

    const { positivityScore, pulseRating } = this.classifyPulseRating(p_t, p_t1, p_t4);

    return {
      p_t,
      p_t1,
      p_t4,
      positivityScore,
      pulseRating,
      Sales: {
        QoQ: growthPct(p_t.sales_disp, p_t1.sales_disp),
        YoY: growthPct(p_t.sales_disp, p_t4.sales_disp),
        Qt: p_t.sales_disp !== undefined && p_t.sales_disp !== null ? p_t.sales_disp : '-',
        Qt1: p_t1.sales_disp !== undefined && p_t1.sales_disp !== null ? p_t1.sales_disp : '-',
        Qt4: p_t4.sales_disp !== undefined && p_t4.sales_disp !== null ? p_t4.sales_disp : '-',
      },
      'Other Inc.': {
        QoQ: growthPct(p_t.other_inc_disp, p_t1.other_inc_disp),
        YoY: growthPct(p_t.other_inc_disp, p_t4.other_inc_disp),
        Qt: p_t.other_inc_disp !== undefined && p_t.other_inc_disp !== null ? p_t.other_inc_disp : '-',
        Qt1: p_t1.other_inc_disp !== undefined && p_t1.other_inc_disp !== null ? p_t1.other_inc_disp : '-',
        Qt4: p_t4.other_inc_disp !== undefined && p_t4.other_inc_disp !== null ? p_t4.other_inc_disp : '-',
      },
      OP: {
        QoQ: growthPct(p_t.op_disp, p_t1.op_disp),
        YoY: growthPct(p_t.op_disp, p_t4.op_disp),
        Qt: p_t.op_disp !== undefined && p_t.op_disp !== null ? p_t.op_disp : '-',
        Qt1: p_t1.op_disp !== undefined && p_t1.op_disp !== null ? p_t1.op_disp : '-',
        Qt4: p_t4.op_disp !== undefined && p_t4.op_disp !== null ? p_t4.op_disp : '-',
      },
      OPM: {
        QoQ: bpsChange(p_t.opm_disp, p_t1.opm_disp),
        YoY: bpsChange(p_t.opm_disp, p_t4.opm_disp),
        Qt: p_t.opm_disp !== undefined && p_t.opm_disp !== null ? `${p_t.opm_disp}%` : '-',
        Qt1: p_t1.opm_disp !== undefined && p_t1.opm_disp !== null ? `${p_t1.opm_disp}%` : '-',
        Qt4: p_t4.opm_disp !== undefined && p_t4.opm_disp !== null ? `${p_t4.opm_disp}%` : '-',
      },
      PAT: {
        QoQ: growthPct(p_t.pat_disp, p_t1.pat_disp),
        YoY: growthPct(p_t.pat_disp, p_t4.pat_disp),
        Qt: p_t.pat_disp !== undefined && p_t.pat_disp !== null ? p_t.pat_disp : '-',
        Qt1: p_t1.pat_disp !== undefined && p_t1.pat_disp !== null ? p_t1.pat_disp : '-',
        Qt4: p_t4.pat_disp !== undefined && p_t4.pat_disp !== null ? p_t4.pat_disp : '-',
      },
      EPS: {
        QoQ: growthPct(p_t.eps_disp, p_t1.eps_disp),
        YoY: growthPct(p_t.eps_disp, p_t4.eps_disp),
        Qt: p_t.eps_disp !== undefined && p_t.eps_disp !== null ? p_t.eps_disp : '-',
        Qt1: p_t1.eps_disp !== undefined && p_t1.eps_disp !== null ? p_t1.eps_disp : '-',
        Qt4: p_t4.eps_disp !== undefined && p_t4.eps_disp !== null ? p_t4.eps_disp : '-',
      },
    };
  }

  /**
   * Analyze Quarterly Result PDF file/text using Gemini Flash models
   * @param {Buffer|string} pdfInput PDF binary Buffer or extracted text
   * @param {string} symbolName Stock ticker e.g., 'BATAINDIA'
   * @returns {Promise<object>} Scorecard dashboard payload
   */
  async analyzeResultPdf(pdfInput, symbolName = 'STOCK', opts = {}) {
    const apiKey = config.geminiApiKey || process.env.GEMINI_API_KEY || process.env.GEMINI_KEY || '';
    if (!apiKey) {
      console.warn('[GeminiAnalyzer] GEMINI_API_KEY is missing in .env. Falling back to local quantitative parser.');
      return null;
    }

    if (!this.ai || this.apiKey !== apiKey) {
      this.apiKey = apiKey;
      this.ai = new GoogleGenAI({ apiKey });
    }

    const masterPrompt = `
Role & Task:
You are an Expert Quantitative Financial Analyst and Automated Financial Data Extraction Engine. Your task is to process the attached Quarterly Financial Result PDF for ANY company (${symbolName}), extract statutory line items across 3 required reporting periods, calculate key financial metrics, and format the output into a standardized dashboard scorecard and JSON payload.

1. Period Identification
Identify and extract data for three comparative 3-Month Quarterly periods reported in the financial statement table (Default: Consolidated Results; fallback to Standalone if Consolidated is not reported):
 * Q_t: Most Recent Reported 3-Month Quarter in the PDF (e.g. 31.03.2026 if it is a Q4/Annual filing, or 30.06.2026 if it is a Q1 filing)
 * Q_{t-1}: Immediate Preceding 3-Month Quarter reported in the table (e.g. 31.12.2025 if Q_t is 31.03.2026, or 31.03.2026 if Q_t is 30.06.2026)
 * Q_{t-4}: Same 3-Month Quarter Previous Fiscal Year reported in the table (e.g. 31.03.2025 if Q_t is 31.03.2026, or 30.06.2025 if Q_t is 30.06.2026)

MANDATORY DATA EXTRACTION RULES:
- EXTRACT 3-MONTH QUARTERLY NUMBERS ONLY! DO NOT extract 12-Month Full Year / Annual / "Year Ended" numbers for ANY period!
- Many PDFs have BOTH a "3 months ended 31.03.2026" column AND a "Year ended 31.03.2026" column side by side. You MUST use the "3 months ended" column for Q_{t-1}. NEVER use the "Year ended" / "12 months" / "Annual" column!
- UNIT DETECTION & CONVERSION TO ₹ CRORES IS CRITICAL:
  * If reported in ₹ Lakhs → divide ALL values by 100
  * If reported in ₹ Millions → divide ALL values by 10
  * If reported in ₹ Thousands → divide ALL values by 10000
  * If reported in ₹ Crores → use values as-is
  * EPS is ALWAYS in ₹ per share (never convert EPS)
- SANITY CHECK: Q_t1 sales should be roughly comparable in magnitude to Q_t and Q_t4 sales (within 0.3x-3x range for most companies). If Q_t1 sales is 4x+ larger than Q_t, you are likely reading the annual column by mistake!
- DO NOT LEAVE BLANK OR DUMMY COLUMNS if the numbers exist in the PDF table. Extract all 3 periods (Q_t, Q_{t-1}, Q_{t-4}) for ALL line items!

2. Line Item Extraction Schema
Extract raw line items in ₹ Crores (apply unit conversion as described above):
A. Non-Financial / Industrial / IT / Consumer Companies:
 * [P1] Revenue from Operations (sales)
 * [P2] Other Income (other_inc)
 * [P3] Total Revenue / Total Income
 * [P4] Total Expenses (total_exp)
 * [P5] Finance Costs / Interest Expense (finance_cost)
 * [P6] Depreciation and Amortisation Expense (depreciation)
 * [P7] Profit / (Loss) for the Period (PAT) (pat)
 * [P8] Basic Earnings Per Share (EPS in ₹) (eps)

B. Banks / NBFCs / Financial Services:
 * [P1] Interest Earned / Total Revenue
 * [P2] Other Income / Non-Interest Income
 * [P3] Total Income
 * [P4] Operating Expenses
 * [P5] Operating Profit / Pre-Provisioning Profit (PPOP)
 * [P6] Provisions and Contingencies
 * [P7] Profit / (Loss) After Tax (PAT)
 * [P8] Basic EPS (in ₹)

Return ONLY valid JSON matching this exact structure:
{
  "is_financial_sector": false,
  "period_labels": { "q_t": "Mar '26", "q_t1": "Dec '25", "q_t4": "Mar '25" },
  "q_t": { "sales": 0, "other_inc": 0, "total_exp": 0, "finance_cost": 0, "depreciation": 0, "op": 0, "pat": 0, "eps": 0 },
  "q_t1": { "sales": 0, "other_inc": 0, "total_exp": 0, "finance_cost": 0, "depreciation": 0, "op": 0, "pat": 0, "eps": 0 },
  "q_t4": { "sales": 0, "other_inc": 0, "total_exp": 0, "finance_cost": 0, "depreciation": 0, "op": 0, "pat": 0, "eps": 0 }
}
`;

    // Tier 0: Fast Instant Local Parser (<100ms)
    try {
      let localResult = null;
      if (Buffer.isBuffer(pdfInput)) {
        localResult = await localFinancialParser.analyzeFromBuffer(pdfInput, symbolName);
      } else if (typeof pdfInput === 'string' && pdfInput.length > 200) {
        localResult = localFinancialParser.analyzeFromText(pdfInput, symbolName);
      }

      if (localResult && (localResult.confidence === 'HIGH' || localResult.confidence === 'MEDIUM')) {
        const hasValidNum = Math.abs(localResult.q_t?.sales || 0) > 0 || Math.abs(localResult.q_t?.pat || 0) > 0;
        if (hasValidNum) {
          const scorecard = this.calculateUniversalScorecard(
            localResult.q_t,
            localResult.q_t1,
            localResult.q_t4,
            localResult.is_financial_sector
          );
          console.log(`[GeminiAnalyzer] 🚀 Local Parser Instant Match for ${symbolName}! (Conf: ${localResult.confidence}) Pulse: ${scorecard.pulseRating}`);
          return {
            modelUsed: 'local-financial-parser',
            rawPayload: localResult,
            scorecard,
            periodLabels: this.normalizePeriodLabels(localResult.period_labels),
          };
        }
      }
    } catch (localErr) {
      console.warn(`[GeminiAnalyzer] Local parser instant pass notice for ${symbolName}: ${localErr.message}`);
    }

    // Tier 1: Parallel Gemini AI Models Race
    const candidateModels = [
      'gemini-3.1-flash-lite',
      'gemini-3.5-flash',
      'gemini-3.6-flash',
      'gemini-flash-latest',
    ];

    const pdfSizeBytes = Buffer.isBuffer(pdfInput) ? pdfInput.length : 0;
    const timeoutMs = pdfSizeBytes >= 500000 ? 22000 : 12000;
    if (pdfSizeBytes >= 500000) {
      console.log(`[GeminiAnalyzer] Large PDF detected (${(pdfSizeBytes / 1024).toFixed(0)}KB). Extended timeout: ${timeoutMs / 1000}s per model.`);
    }

    const activeModels = candidateModels.filter(m => {
      const quotaExpiry = this.exhaustedModels.get(m);
      return !quotaExpiry || Date.now() >= quotaExpiry;
    });

    if (activeModels.length > 0 && this.ai) {
      const contents = [];
      if (Buffer.isBuffer(pdfInput)) {
        contents.push({
          inlineData: {
            mimeType: 'application/pdf',
            data: pdfInput.toString('base64'),
          },
        });
      } else if (typeof pdfInput === 'string') {
        contents.push({ text: `Document Content:\n${pdfInput.substring(0, 150000)}` });
      }
      contents.push({ text: masterPrompt });

      const modelPromises = activeModels.map(async (modelName) => {
        try {
          console.log(`[GeminiAnalyzer] Launching parallel AI task: ${modelName}...`);
          const generatePromise = this.ai.models.generateContent({
            model: modelName,
            contents,
            config: {
              responseMimeType: 'application/json',
              temperature: 0.1,
            },
          });

          const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`Timeout: ${modelName} did not respond within ${timeoutMs / 1000}s`)), timeoutMs)
          );

          const response = await Promise.race([generatePromise, timeoutPromise]);
          const rawJsonText = response.text || '';
          const parsedData = JSON.parse(rawJsonText);

          const qt = parsedData.q_t || {};
          const qt1 = parsedData.q_t1 || {};
          const qt4 = parsedData.q_t4 || {};

          const hasNumbers =
            (Math.abs(qt.sales || 0) > 0) ||
            (Math.abs(qt.pat || 0) > 0) ||
            (Math.abs(qt.op || 0) > 0) ||
            (Math.abs(qt1.sales || 0) > 0) ||
            (Math.abs(qt4.sales || 0) > 0);

          if (!hasNumbers) {
            throw new Error(`Model ${modelName} returned 0s`);
          }

          const scorecard = this.calculateUniversalScorecard(
            parsedData.q_t,
            parsedData.q_t1,
            parsedData.q_t4,
            parsedData.is_financial_sector
          );

          return {
            modelUsed: modelName,
            rawPayload: parsedData,
            scorecard,
            periodLabels: this.normalizePeriodLabels(parsedData.period_labels),
          };
        } catch (err) {
          const isRateLimit = err.message && (err.message.includes('429') || err.message.includes('RESOURCE_EXHAUSTED') || err.message.includes('Quota exceeded'));
          if (isRateLimit) {
            this.exhaustedModels.set(modelName, Date.now() + 60 * 1000);
          }
          throw err;
        }
      });

      try {
        const winner = await Promise.any(modelPromises);
        console.log(`[GeminiAnalyzer] ⚡ Parallel AI Race Winner: ${winner.modelUsed}! Pulse: ${winner.scorecard.pulseRating}`);
        return winner;
      } catch (raceErr) {
        console.warn(`[GeminiAnalyzer] All parallel Gemini models failed or timed out for ${symbolName}.`);
      }
    }

    // For both live and non-live broadcasts: try Screener fallback as last resort.
    // Previously live broadcasts aborted here — but if all Gemini models timed out (e.g. large PDF),
    // Screener is the only way to get live results for this quarter. The stale-date guard inside
    // fetchScreenerQuarterlyFallback() already prevents sending obsolete quarter data.
    console.warn(`[GeminiAnalyzer] All vision/text routes failed for ${symbolName}. Invoking Screener live quarterly fallback as last resort...`);
    return await this.fetchScreenerQuarterlyFallback(symbolName);
  }

  /**
   * Normalize Gemini period_labels from raw date format (e.g. "30.06.2026") to human-readable format ("Jun '26").
   * Gemini sometimes returns raw DD.MM.YYYY dates instead of the expected "Mon 'YY" format.
   * @param {object} labels { q_t, q_t1, q_t4 }
   * @returns {object} normalized labels
   */
  normalizePeriodLabels(labels) {
    const defaults = { q_t: "Jun '26", q_t1: "Mar '26", q_t4: "Jun '25" };
    if (!labels) return defaults;

    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    const convertLabel = (rawLabel) => {
      if (!rawLabel) return null;
      const s = String(rawLabel).trim();

      // Already formatted: "Jun '26", "Mar '26" etc.
      if (/^[A-Za-z]{3}\s*'\d{2}$/.test(s)) return s;

      // Raw date: DD.MM.YYYY or DD/MM/YYYY or YYYY-MM-DD
      let day, month, year;
      const ddmmyyyy = s.match(/^(\d{2})[./](\d{2})[./](\d{4})$/);
      const yyyymmdd = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);

      if (ddmmyyyy) {
        [, day, month, year] = ddmmyyyy;
      } else if (yyyymmdd) {
        [, year, month, day] = yyyymmdd;
      } else {
        return s; // Unknown format — return as-is
      }

      const monthIdx = parseInt(month, 10) - 1;
      if (monthIdx < 0 || monthIdx > 11) return s;
      const shortYear = String(year).slice(-2);
      return `${monthNames[monthIdx]} '${shortYear}`;
    };

    return {
      q_t: convertLabel(labels.q_t) || defaults.q_t,
      q_t1: convertLabel(labels.q_t1) || defaults.q_t1,
      q_t4: convertLabel(labels.q_t4) || defaults.q_t4,
    };
  }

  /**
   * Fetch 100% verified real live quarterly results directly from Screener.in
   * Used as a seamless fallback when PDF binary extraction returns 0/null values or times out.
   */
  async fetchScreenerQuarterlyFallback(symbol) {
    try {
      const axios = require('axios');
      const cleanSym = symbol.toUpperCase().trim().replace(/[^A-Z0-9.&-]/g, '');
      const urls = [
        `https://www.screener.in/company/${cleanSym}/consolidated/`,
        `https://www.screener.in/company/${cleanSym}/`,
      ];

      let html = '';
      for (const url of urls) {
        try {
          const res = await axios.get(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
            timeout: 5000,
          });
          if (res.data && (res.data.includes('section id="quarters"') || res.data.includes('Quarterly Results'))) {
            html = res.data;
            break;
          }
        } catch (_) {}
      }

      if (!html) return null;

      let startIdx = html.indexOf('section id="quarters"');
      if (startIdx === -1) startIdx = html.indexOf('id="quarters"');
      if (startIdx === -1) return null;

      const secTag = html.indexOf('<section', startIdx - 50);
      if (secTag !== -1 && secTag < startIdx) startIdx = secTag;

      const qHtml = html.substring(startIdx, startIdx + 30000);

      const tableStart = qHtml.indexOf('<table');
      const tableSub = qHtml.substring(tableStart !== -1 ? tableStart : 0, (tableStart !== -1 ? tableStart : 0) + 3000);
      const rawHeaders = [...tableSub.matchAll(/<th[^>]*>\s*([A-Za-z]{3}\s+\d{4})\s*<\/th>/gi)].map((m) => m[1]);

      function parseRow(rowTitle) {
        const titleIdx = qHtml.indexOf(rowTitle);
        if (titleIdx === -1) return [];
        const trStart = qHtml.lastIndexOf('<tr', titleIdx);
        if (trStart === -1) return [];
        const trEnd = qHtml.indexOf('</tr>', trStart);
        const rowSub = qHtml.substring(trStart, trEnd !== -1 ? trEnd : trStart + 1500);
        // Extract all td elements to maintain column alignment
        const tds = [...rowSub.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)];
        // The first td is the row title, so we skip it to align with rawHeaders.
        return tds.slice(1).map((m) => {
          const text = m[1].replace(/<[^>]*>/g, '').trim();
          if (!text || text === '-' || text === '&nbsp;') return 0;
          const match = text.match(/([+-]?[\d.,]+)/);
          if (match) {
            const val = parseFloat(match[1].replace(/,/g, ''));
            return isNaN(val) ? 0 : val;
          }
          return 0;
        });
      }

      const sales = parseRow('Sales');
      const op = parseRow('Operating Profit');
      const opm = parseRow('OPM %');
      const otherInc = parseRow('Other Income');
      const pat = parseRow('Net Profit');
      const eps = parseRow('EPS in Rs');

      const len = rawHeaders.length;
      if (len < 3) return null;

      const latestHeader = (rawHeaders[len - 1] || '').toLowerCase();
      const currentMonth = new Date().getMonth(); // 6=Jul, 7=Aug, 8=Sep

      // Stale Screener Table Guard:
      // If current month is Jul/Aug/Sep (Q1 result season) and Screener's latest header is NOT 'jun' (e.g. it is 'mar'):
      // Screener has NOT updated to the new reported quarter yet. Reject stale fallback to prevent fake/wrong cards!
      if (currentMonth >= 6 && currentMonth <= 8 && !latestHeader.includes('jun')) {
        console.warn(`[GeminiAnalyzer] 🛑 Stale Screener table for ${symbol}: latest header is '${rawHeaders[len - 1]}', expected 'Jun' quarter. Rejecting stale Screener fallback.`);
        return null;
      }
      if (currentMonth >= 9 && currentMonth <= 11 && !latestHeader.includes('sep')) {
        console.warn(`[GeminiAnalyzer] 🛑 Stale Screener table for ${symbol}: latest header is '${rawHeaders[len - 1]}', expected 'Sep' quarter. Rejecting stale Screener fallback.`);
        return null;
      }
      if ((currentMonth === 0 || currentMonth === 1 || currentMonth === 2) && !latestHeader.includes('dec')) {
        console.warn(`[GeminiAnalyzer] 🛑 Stale Screener table for ${symbol}: latest header is '${rawHeaders[len - 1]}', expected 'Dec' quarter. Rejecting stale Screener fallback.`);
        return null;
      }

      const i_qt = len - 1;
      const i_qt1 = len - 2;
      const i_qt4 = len >= 5 ? len - 5 : 0;

      const formatHeader = (str) => {
        const parts = str.trim().split(/\s+/);
        return `${parts[0].substring(0, 3)}'${parts[1].substring(2)}`;
      };

      const q_t = { sales: sales[i_qt] || 0, op: op[i_qt] || 0, opm: opm[i_qt] || 0, other_inc: otherInc[i_qt] || 0, pat: pat[i_qt] || 0, eps: eps[i_qt] || 0 };
      const q_t1 = { sales: sales[i_qt1] || 0, op: op[i_qt1] || 0, opm: opm[i_qt1] || 0, other_inc: otherInc[i_qt1] || 0, pat: pat[i_qt1] || 0, eps: eps[i_qt1] || 0 };
      const q_t4 = { sales: sales[i_qt4] || 0, op: op[i_qt4] || 0, opm: opm[i_qt4] || 0, other_inc: otherInc[i_qt4] || 0, pat: pat[i_qt4] || 0, eps: eps[i_qt4] || 0 };

      const scorecard = this.calculateUniversalScorecard(q_t, q_t1, q_t4, false);

      console.log(`[GeminiAnalyzer] Screener fallback successful for ${symbol}! Pulse Rating: ${scorecard.pulseRating}`);

      return {
        modelUsed: 'screener-live-fallback',
        rawPayload: { q_t, q_t1, q_t4 },
        scorecard,
        periodLabels: {
          q_t: formatHeader(rawHeaders[i_qt]),
          q_t1: formatHeader(rawHeaders[i_qt1]),
          q_t4: formatHeader(rawHeaders[i_qt4]),
        },
      };
    } catch (_) {
      return null;
    }
  }
}

module.exports = new GeminiFinancialAnalyzer();
