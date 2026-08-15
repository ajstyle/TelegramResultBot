const express = require('express');
const router = express.Router();
const healthScoringEngine = require('../services/health/healthScoringEngine');
const modularStockAnalyzer = require('../services/health/modularStockAnalyzer');
const sectorRegistry = require('../services/health/sectorRegistry');
const fundamentalsProvider = require('../services/fundamentals/provider');

/**
 * GET /api/health/analyze?symbol=TCS
 * Analyzes stock financial health out of 100 points
 */
router.get('/analyze', async (req, res) => {
  try {
    const symbol = (req.query.symbol || 'TCS').toUpperCase().trim();
    const scripCode = req.query.scripCode || '';

    // Fetch live market & fundamental metrics from Screener / BSE provider
    let liveData = {};
    try {
      liveData = await fundamentalsProvider.getFundamentals(symbol, scripCode);
    } catch (_) {}

    const payload = {
      symbol,
      companyName: liveData.name || liveData.companyName || symbol,
      sector: liveData.sector || liveData.industry || 'General',
      cmp: liveData.cmp || liveData.price || 1000,
      marketCapCr: liveData.marketCapCr || liveData.marketCap || 50000,
      pe: liveData.pe || null,
      pb: liveData.pb || null,

      // Financial Health Parameters
      debtToEquity: liveData.debtToEquity !== undefined ? liveData.debtToEquity : null,
      roe: liveData.roe !== undefined ? liveData.roe : null,
      roce: liveData.roce !== undefined ? liveData.roce : null,
      currentRatio: liveData.currentRatio !== undefined ? liveData.currentRatio : null,
      quickRatio: liveData.quickRatio !== undefined ? liveData.quickRatio : null,
      interestCoverage: liveData.interestCoverage !== undefined ? liveData.interestCoverage : null,
      sales: liveData.sales || liveData.revenue || null,
      pat: liveData.pat || liveData.netProfit || null,
      ebit: liveData.ebit || liveData.operatingProfit || null,
      cfo: liveData.cfo || liveData.operatingCashFlow || null,
      capex: liveData.capex || null,
      fcf: liveData.fcf || null,
      inventoryDays: liveData.inventoryDays || null,
      receivableDays: liveData.receivableDays || null,

      salesCagr3Y: liveData.salesCagr3Y || liveData.salesGrowth3Y || null,
      profitCagr3Y: liveData.profitCagr3Y || liveData.profitGrowth3Y || null,

      // Sector Specific KPIs
      gnpa: liveData.gnpa || null,
      nnpa: liveData.nnpa || null,
      pcr: liveData.pcr || null,
      crar: liveData.crar || null,
      roa: liveData.roa || null,
      nim: liveData.nim || null,
      fcfMargin: liveData.fcfMargin || null,
      orderBookSales: liveData.orderBookSales || null,
      netDebtToEbitda: liveData.netDebtToEbitda || null,
      combinedRatio: liveData.combinedRatio || null,
      solvencyRatio: liveData.solvencyRatio || null,
    };

    const isFullModule = req.query.mode === 'full';
    if (isFullModule) {
      const fullAnalysis = modularStockAnalyzer.analyzeStock(payload);
      return res.json({ success: true, data: fullAnalysis });
    }

    const healthAnalysis = healthScoringEngine.analyze(payload);
    return res.json({ success: true, data: healthAnalysis });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/health/analyze-custom
 * Accept raw JSON payload for custom financial health calculation
 */
router.post('/analyze-custom', (req, res) => {
  try {
    const input = req.body || {};
    const healthAnalysis = healthScoringEngine.analyze(input);
    return res.json({ success: true, data: healthAnalysis });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/health/sectors
 * Returns benchmark metadata for all 14 supported sectors
 */
router.get('/sectors', (req, res) => {
  return res.json({ success: true, data: sectorRegistry.sectors });
});

/**
 * GET /api/health/formula-explain
 * Returns exact formula and explanation for any metric
 */
router.get('/formula-explain', (req, res) => {
  const metric = (req.query.metric || 'debt_to_equity').toLowerCase();
  const formulas = {
    debt_to_equity: { name: 'Debt-to-Equity', formula: 'Total Debt / Shareholders Equity', guideline: '<0.5 Excellent, 0.5-1 Good, 1-2 Average, >2 Risky' },
    current_ratio: { name: 'Current Ratio', formula: 'Current Assets / Current Liabilities', guideline: '>1.5 Strong, 1-1.5 Acceptable, <1 Weak' },
    interest_coverage: { name: 'Interest Coverage Ratio', formula: 'EBIT / Interest Expense', guideline: '>5 Strong, 3-5 Good, 1.5-3 Risk, <1.5 High Risk' },
    cfo_conversion: { name: 'CFO Conversion Rate', formula: '(CFO / PAT) * 100', guideline: '>100% Excellent Earnings Quality, <50% Risk Flag' },
    fcf: { name: 'Free Cash Flow', formula: 'CFO - Capex', guideline: '>0 Positive FCF, <0 Negative FCF Risk' },
    cagr: { name: 'Compound Annual Growth Rate', formula: '(Ending Value / Beginning Value)^(1 / Years) - 1', guideline: '>15% Strong Growth' },
  };

  return res.json({ success: true, data: formulas[metric] || formulas.debt_to_equity });
});

module.exports = router;
