const { GoogleGenAI } = require('@google/genai');
const config = require('../../config');

/**
 * Universal Stock-Agnostic Gemini Financial Result Analyzer Engine
 * Uses Gemini 3.5 Flash / 3.6 Flash / gemini-flash-latest to extract 3 comparative periods
 * (Q_t, Q_t1, Q_t4) from SEBI Ind-AS PDF filings and compute universal scorecard metrics.
 */
class GeminiFinancialAnalyzer {
  constructor() {
    this.apiKey = config.geminiApiKey || process.env.GEMINI_API_KEY || process.env.GEMINI_KEY || '';
    this.ai = this.apiKey ? new GoogleGenAI({ apiKey: this.apiKey }) : null;
  }

  /**
   * Universal Stock-Agnostic Scorecard Calculator Engine (Handles Net Losses & Basis Points)
   */
  calculateUniversalScorecard(q_t, q_t1, q_t4, is_financial_sector = false) {
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

      return {
        sales_disp: Math.round(sales),
        other_inc_disp: Math.round(other_inc),
        op_disp: Math.round(op),
        opm_disp: Math.round(opm * 10) / 10,
        pat_disp: Math.round(pat),
        eps_disp: Math.round(eps * 10) / 10,
      };
    };

    const p_t = processPeriod(q_t);
    const p_t1 = processPeriod(q_t1);
    const p_t4 = processPeriod(q_t4);

    const growthPct = (curr, base) => {
      if (!base || base === 0) return '0%';
      // Absolute value in denominator handles negative profit/loss transitions
      const pct = Math.round(((curr - base) / Math.abs(base)) * 100);
      return `${pct >= 0 ? '+' : ''}${pct}%`;
    };

    const bpsChange = (currPct, basePct) => {
      const bps = Math.round((currPct - basePct) * 100);
      return `${bps >= 0 ? '+' : ''}${bps} bps`;
    };

    return {
      p_t,
      p_t1,
      p_t4,
      Sales: {
        QoQ: growthPct(p_t.sales_disp, p_t1.sales_disp),
        YoY: growthPct(p_t.sales_disp, p_t4.sales_disp),
        Qt: p_t.sales_disp,
        Qt1: p_t1.sales_disp,
        Qt4: p_t4.sales_disp,
      },
      'Other Inc.': {
        QoQ: growthPct(p_t.other_inc_disp, p_t1.other_inc_disp),
        YoY: growthPct(p_t.other_inc_disp, p_t4.other_inc_disp),
        Qt: p_t.other_inc_disp,
        Qt1: p_t1.other_inc_disp,
        Qt4: p_t4.other_inc_disp,
      },
      OP: {
        QoQ: growthPct(p_t.op_disp, p_t1.op_disp),
        YoY: growthPct(p_t.op_disp, p_t4.op_disp),
        Qt: p_t.op_disp,
        Qt1: p_t1.op_disp,
        Qt4: p_t4.op_disp,
      },
      OPM: {
        QoQ: bpsChange(p_t.opm_disp, p_t1.opm_disp),
        YoY: bpsChange(p_t.opm_disp, p_t4.opm_disp),
        Qt: `${p_t.opm_disp}%`,
        Qt1: `${p_t1.opm_disp}%`,
        Qt4: `${p_t4.opm_disp}%`,
      },
      PAT: {
        QoQ: growthPct(p_t.pat_disp, p_t1.pat_disp),
        YoY: growthPct(p_t.pat_disp, p_t4.pat_disp),
        Qt: p_t.pat_disp,
        Qt1: p_t1.pat_disp,
        Qt4: p_t4.pat_disp,
      },
      EPS: {
        QoQ: growthPct(p_t.eps_disp, p_t1.eps_disp),
        YoY: growthPct(p_t.eps_disp, p_t4.eps_disp),
        Qt: p_t.eps_disp,
        Qt1: p_t1.eps_disp,
        Qt4: p_t4.eps_disp,
      },
    };
  }

  /**
   * Analyze Quarterly Result PDF file/text using Gemini Flash models (gemini-3.5-flash / gemini-3.6-flash / gemini-flash-latest)
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
Identify and extract data for three comparative periods from the financial tables (Default: Consolidated Results; fallback to Standalone if Consolidated is not reported):
 * Q_t: Current Quarter (e.g., Jun '26 / Period ended 30.06.2026)
 * Q_{t-1}: Immediate Previous Quarter (e.g., Mar '26 / Period ended 31.03.2026)
 * Q_{t-4}: Same Quarter Previous Fiscal Year (e.g., Jun '25 / Period ended 30.06.2025)

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
  "period_labels": { "q_t": "Jun '26", "q_t1": "Mar '26", "q_t4": "Jun '25" },
  "q_t": { "sales": 0, "other_inc": 0, "total_exp": 0, "finance_cost": 0, "depreciation": 0, "op": 0, "pat": 0, "eps": 0 },
  "q_t1": { "sales": 0, "other_inc": 0, "total_exp": 0, "finance_cost": 0, "depreciation": 0, "op": 0, "pat": 0, "eps": 0 },
  "q_t4": { "sales": 0, "other_inc": 0, "total_exp": 0, "finance_cost": 0, "depreciation": 0, "op": 0, "pat": 0, "eps": 0 }
}
`;

    const candidateModels = ['gemini-3.5-flash', 'gemini-3.6-flash', 'gemini-flash-latest'];

    for (const modelName of candidateModels) {
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

        const response = await this.ai.models.generateContent({
          model: modelName,
          contents,
          config: {
            responseMimeType: 'application/json',
            temperature: 0.1,
          },
        });

        const rawJsonText = response.text || '';
        const parsedData = JSON.parse(rawJsonText);

        const scorecard = this.calculateUniversalScorecard(
          parsedData.q_t,
          parsedData.q_t1,
          parsedData.q_t4,
          parsedData.is_financial_sector
        );

        console.log(`[GeminiAnalyzer] Successfully analyzed financial results using ${modelName}!`);

        return {
          modelUsed: modelName,
          rawPayload: parsedData,
          scorecard,
          periodLabels: parsedData.period_labels || { q_t: "Jun '26", q_t1: "Mar '26", q_t4: "Jun '25" },
        };
      } catch (err) {
        console.warn(`[GeminiAnalyzer] Model ${modelName} notice: ${err.message}. Trying next fallback model...`);
      }
    }

    return null;
  }
}

module.exports = new GeminiFinancialAnalyzer();
