const { GoogleGenAI } = require('@google/genai');
const config = require('../../config');

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
        fields.forEach((f) => {
          const val = copy[f] || 0;
          const r1 = ref1 ? (ref1[f] || 0) : 0;
          const r2 = ref2 ? (ref2[f] || 0) : 0;
          const validRefs = [r1, r2].filter((v) => v !== 0 && !isNaN(v));
          if (validRefs.length > 0) {
            const avgRef = validRefs.reduce((a, b) => Math.abs(a) + Math.abs(b), 0) / validRefs.length;
            if (avgRef > 0 && Math.abs(val) > avgRef * 20) {
              copy[f] = Math.round((val / 100) * 100) / 100;
            }
          }
        });
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
      if (!base || base === 0) return '-';
      // Absolute value in denominator handles negative profit/loss transitions
      const pct = Math.round(((curr - base) / Math.abs(base)) * 100);
      return `${pct >= 0 ? '+' : ''}${pct}%`;
    };

    const bpsChange = (currPct, basePct) => {
      const bps = Math.round((currPct - basePct) * 100);
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
        Qt: p_t.sales_disp || '-',
        Qt1: p_t1.sales_disp || '-',
        Qt4: p_t4.sales_disp || '-',
      },
      'Other Inc.': {
        QoQ: growthPct(p_t.other_inc_disp, p_t1.other_inc_disp),
        YoY: growthPct(p_t.other_inc_disp, p_t4.other_inc_disp),
        Qt: p_t.other_inc_disp || '-',
        Qt1: p_t1.other_inc_disp || '-',
        Qt4: p_t4.other_inc_disp || '-',
      },
      OP: {
        QoQ: growthPct(p_t.op_disp, p_t1.op_disp),
        YoY: growthPct(p_t.op_disp, p_t4.op_disp),
        Qt: p_t.op_disp || '-',
        Qt1: p_t1.op_disp || '-',
        Qt4: p_t4.op_disp || '-',
      },
      OPM: {
        QoQ: bpsChange(p_t.opm_disp, p_t1.opm_disp),
        YoY: bpsChange(p_t.opm_disp, p_t4.opm_disp),
        Qt: p_t.opm_disp ? `${p_t.opm_disp}%` : '-',
        Qt1: p_t1.opm_disp ? `${p_t1.opm_disp}%` : '-',
        Qt4: p_t4.opm_disp ? `${p_t4.opm_disp}%` : '-',
      },
      PAT: {
        QoQ: growthPct(p_t.pat_disp, p_t1.pat_disp),
        YoY: growthPct(p_t.pat_disp, p_t4.pat_disp),
        Qt: p_t.pat_disp || '-',
        Qt1: p_t1.pat_disp || '-',
        Qt4: p_t4.pat_disp || '-',
      },
      EPS: {
        QoQ: growthPct(p_t.eps_disp, p_t1.eps_disp),
        YoY: growthPct(p_t.eps_disp, p_t4.eps_disp),
        Qt: p_t.eps_disp || '-',
        Qt1: p_t1.eps_disp || '-',
        Qt4: p_t4.eps_disp || '-',
      },
    };
  }

  /**
   * Analyze Quarterly Result PDF file/text using Gemini Flash models
   * @param {Buffer|string} pdfInput PDF binary Buffer or extracted text
   * @param {string} symbolName Stock ticker e.g., 'BATAINDIA'
   * @returns {Promise<object>} Scorecard dashboard payload
   */
  async analyzeResultPdf(pdfInput, symbolName = 'STOCK') {
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
- EXTRACT 3-MONTH QUARTERLY NUMBERS ONLY! DO NOT extract 12-Month Full Year / Annual numbers for Q_{t-1} or Q_t!
- CONVERT ALL NUMBERS TO ₹ CRORES! If the table is reported in ₹ Lakhs, divide ALL values by 100! DO NOT leave Q_{t-1} or Q_{t-4} in Lakhs!
- DO NOT LEAVE BLANK OR DUMMY COLUMNS if the numbers exist in the PDF table. Extract all 3 periods (Q_t, Q_{t-1}, Q_{t-4}) for ALL line items!

2. Line Item Extraction Schema
Extract raw line items in ₹ Crores (convert Lakhs to Crores by dividing by 100 if reported in Lakhs):
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

    const candidateModels = [
      'gemini-flash-latest',
      'gemini-pro-latest',
    ];

    for (let i = 0; i < candidateModels.length; i++) {
      const modelName = candidateModels[i];
      const quotaExpiry = this.exhaustedModels.get(modelName);
      if (quotaExpiry && Date.now() < quotaExpiry) {
        continue;
      }

      try {
        const contents = [];

        if (Buffer.isBuffer(pdfInput)) {
          contents.push({
            inlineData: {
              mimeType: 'application/pdf',
              data: pdfInput.toString('base64'),
            },
          });
        } else if (typeof pdfInput === 'string') {
          contents.push({ text: `Document Content:\n${pdfInput.substring(0, 30000)}` });
        }

        contents.push({ text: masterPrompt });

        console.log(`[GeminiAnalyzer] Attempting fast analysis with model: ${modelName}...`);

        const generatePromise = this.ai.models.generateContent({
          model: modelName,
          contents,
          config: {
            responseMimeType: 'application/json',
            temperature: 0.1,
          },
        });

        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`Timeout: ${modelName} did not respond within 12s`)), 12000)
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
          const nextModel = candidateModels[i + 1];
          console.warn(`[GeminiAnalyzer] Model ${modelName} returned 0s for all metrics.${nextModel ? ` Retrying with ${nextModel}...` : ''}`);
          continue;
        }

        const scorecard = this.calculateUniversalScorecard(
          parsedData.q_t,
          parsedData.q_t1,
          parsedData.q_t4,
          parsedData.is_financial_sector
        );

        console.log(`[GeminiAnalyzer] Successfully analyzed financial results using ${modelName}! Pulse Rating: ${scorecard.pulseRating}`);

        return {
          modelUsed: modelName,
          rawPayload: parsedData,
          scorecard,
          periodLabels: parsedData.period_labels || { q_t: "Jun '26", q_t1: "Mar '26", q_t4: "Jun '25" },
        };
      } catch (err) {
        const isRateLimit = err.message && (err.message.includes('429') || err.message.includes('RESOURCE_EXHAUSTED') || err.message.includes('Quota exceeded'));
        if (isRateLimit) {
          // Cache quota exhaustion for 30 minutes to skip repeated 429 rate limit delays
          this.exhaustedModels.set(modelName, Date.now() + 30 * 60 * 1000);
          const nextModel = candidateModels[i + 1];
          console.warn(`[GeminiAnalyzer] Rate/Quota limit (429) hit for ${modelName}.${nextModel ? ` Instantly falling back to ${nextModel}...` : ' No more models available.'}`);
        } else {
          const nextModel = candidateModels[i + 1];
          console.warn(`[GeminiAnalyzer] Model ${modelName} notice: ${err.message}.${nextModel ? ` Retrying with ${nextModel}...` : ''}`);
        }
      }
    }

    console.warn(`[GeminiAnalyzer] PDF models returned no metrics for ${symbolName}. Invoking 100% live Screener quarterly fallback...`);
    return await this.fetchScreenerQuarterlyFallback(symbolName);
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
        const idx = qHtml.indexOf(rowTitle);
        if (idx === -1) return [];
        const rowEnd = qHtml.indexOf('</tr>', idx);
        const rowSub = qHtml.substring(idx, rowEnd !== -1 ? rowEnd : idx + 1500);
        return [...rowSub.matchAll(/<td[^>]*>[\s\n]*([+-]?[\d.,]+)%?[\s\n]*<\/td>/g)].map((m) => {
          const val = parseFloat(m[1].replace(/,/g, ''));
          return isNaN(val) ? 0 : val;
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
