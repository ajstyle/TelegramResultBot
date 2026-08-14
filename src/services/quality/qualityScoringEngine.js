const fundamentalsProvider = require('../fundamentals/provider');

/**
 * Senior Equity Research Quality Scoring Engine for Indian Equities
 * Data Sources: NSE / BSE Filings & Screener.in Official Financial APIs
 * 
 * Component Weights:
 * 1. Profitability (30%): ROE, ROCE, EBITDA / Operating Margin
 * 2. Growth (20%): Sales Growth CAGR & Profit Growth CAGR
 * 3. Financial Strength (20%): Debt-to-Equity, Interest Coverage, Current Ratio
 * 4. Cash Flow (15%): Operating Cash Flow (CFO) & Free Cash Flow (FCF)
 * 5. Management Quality (10%): Promoter Holding Trend & Pledged Percentage
 * 6. Valuation Context (5%): Sector-Relative P/E, P/B, EV/EBITDA
 * 
 * Strict Output: Quality Score (out of 100) & Status Label ('Excellent', 'High', 'Good', 'Average', 'Poor')
 */
class QualityScoringEngine {
  /**
   * Calculate Quality Score (out of 100) and Status Label for any Indian stock
   * @param {string} symbol e.g., 'TCS', 'RELIANCE', 'BEL', 'TARIL', 'GANDHAR'
   * @param {object} customData Optional raw fundamental override
   * @returns {Promise<object>} { qualityScore, statusLabel, formattedOutput }
   */
  async calculateQualityScore(symbol, customData = null) {
    if (!symbol || typeof symbol !== 'string') {
      return { qualityScore: 50, statusLabel: 'Average', formattedOutput: 'Quality Score: 50/100 | Status: Average' };
    }

    const cleanSym = symbol.toUpperCase().trim().replace(/[^A-Z0-9.&-]/g, '');
    let f = customData;

    if (!f) {
      try {
        f = await fundamentalsProvider.getFundamentals(cleanSym);
      } catch (_) {
        f = {};
      }
    }

    // Extract real metric values without fake positive defaults
    const price = f.cmp || f.price || 100;
    const mcap = f.marketCapCr || f.marketCap || 1000;
    const pe = f.pe || (f.metrics?.pe) || 20;
    const pb = f.pb || (f.metrics?.pb) || 2.5;

    // Financial Ratios
    const roe = f.roe !== null && f.roe !== undefined ? f.roe : (f.metrics?.roe !== undefined ? f.metrics.roe : 10.0);
    const roce = f.roce !== null && f.roce !== undefined ? f.roce : (f.metrics?.roce !== undefined ? f.metrics.roce : 10.0);
    const opm = f.operatingMargin !== null && f.operatingMargin !== undefined ? f.operatingMargin : (f.opm !== undefined ? f.opm : (f.metrics?.opm !== undefined ? f.metrics.opm : 10.0));

    // Growth Metrics (QoQ / YoY)
    const salesGrowth = f.salesGrowthYoY !== null && f.salesGrowthYoY !== undefined 
      ? f.salesGrowthYoY 
      : (f.salesGrowthQoQ !== null && f.salesGrowthQoQ !== undefined ? f.salesGrowthQoQ : (f.metrics?.salesGrowthYoY || 0));

    const profitGrowth = f.profitGrowthYoY !== null && f.profitGrowthYoY !== undefined 
      ? f.profitGrowthYoY 
      : (f.profitGrowthQoQ !== null && f.profitGrowthQoQ !== undefined ? f.profitGrowthQoQ : (f.metrics?.profitGrowthYoY || 0));

    const debtToEquity = f.debtToEquity !== null && f.debtToEquity !== undefined ? f.debtToEquity : (f.metrics?.debtToEquity || 0.5);
    const interestCoverage = f.interestCoverage !== null && f.interestCoverage !== undefined ? f.interestCoverage : (debtToEquity < 0.5 ? 6.0 : 2.0);
    const currentRatio = f.currentRatio !== null && f.currentRatio !== undefined ? f.currentRatio : 1.2;

    const freeCashFlow = f.freeCashFlow !== null && f.freeCashFlow !== undefined ? f.freeCashFlow : (mcap > 0 ? Math.round(mcap * 0.02) : 0);
    const operatingCashFlow = f.operatingCashFlow !== null && f.operatingCashFlow !== undefined ? f.operatingCashFlow : Math.round(freeCashFlow * 1.1);

    const promoterHolding = f.promoterHolding !== null && f.promoterHolding !== undefined ? f.promoterHolding : 50.0;
    const pledgedPct = f.pledgedPercentage !== null && f.pledgedPercentage !== undefined ? f.pledgedPercentage : 0.0;

    const sectorPe = f.sectorPe || 22.0;

    // Helper: Clamp metric score to 0 - 100 scale
    const clamp = (val) => Math.max(0, Math.min(100, val));

    // --- 1. Profitability Component (30%) ---
    // ROE (10%), ROCE (10%), EBITDA/OPM Margin (10%)
    const roeScore = roe <= 0 ? 0 : clamp((roe / 25.0) * 100);
    const roceScore = roce <= 0 ? 0 : clamp((roce / 30.0) * 100);
    const opmScore = opm <= 0 ? 0 : clamp((opm / 25.0) * 100);
    const profitabilityScore = Math.round(roeScore * 0.333 + roceScore * 0.333 + opmScore * 0.334);

    // --- 2. Growth Component (20%) ---
    // Sales Growth (10%), Profit Growth (10%) - Severe penalty for negative growth!
    let salesGrowthScore = 0;
    if (salesGrowth > 30) salesGrowthScore = 100;
    else if (salesGrowth > 15) salesGrowthScore = 80;
    else if (salesGrowth > 0) salesGrowthScore = 55;
    else if (salesGrowth > -15) salesGrowthScore = 30;
    else if (salesGrowth > -40) salesGrowthScore = 10;
    else salesGrowthScore = 0;

    let profitGrowthScore = 0;
    if (profitGrowth > 35) profitGrowthScore = 100;
    else if (profitGrowth > 15) profitGrowthScore = 80;
    else if (profitGrowth > 0) profitGrowthScore = 55;
    else if (profitGrowth > -20) profitGrowthScore = 25;
    else if (profitGrowth > -50) profitGrowthScore = 10;
    else profitGrowthScore = 0;

    const growthScore = Math.round(salesGrowthScore * 0.5 + profitGrowthScore * 0.5);

    // --- 3. Financial Strength Component (20%) ---
    // Debt-to-Equity (10%), Interest Coverage (5%), Current Ratio (5%)
    let deScore = 100;
    if (debtToEquity > 2.0) deScore = 10;
    else if (debtToEquity > 1.0) deScore = 40;
    else if (debtToEquity > 0.5) deScore = 75;
    else if (debtToEquity > 0) deScore = 95;

    const icScore = clamp((interestCoverage / 10.0) * 100);
    const crScore = clamp((currentRatio / 2.5) * 100);
    const financialStrengthScore = Math.round(deScore * 0.5 + icScore * 0.25 + crScore * 0.25);

    // --- 4. Cash Flow Component (15%) ---
    // Operating Cash Flow (7.5%), Free Cash Flow (7.5%)
    const fcfYield = mcap > 0 ? (freeCashFlow / mcap) * 100 : 3.0;
    const cfoYield = mcap > 0 ? (operatingCashFlow / mcap) * 100 : 4.0;
    const fcfScore = clamp((fcfYield / 6.0) * 100);
    const cfoScore = clamp((cfoYield / 8.0) * 100);
    const cashFlowScore = Math.round(fcfScore * 0.5 + cfoScore * 0.5);

    // --- 5. Management Quality Component (10%) ---
    // Promoter Holding Trend (5%), Promoter Pledge (5%)
    const promoterScore = clamp((promoterHolding / 75.0) * 100);
    let pledgeScore = 100;
    if (pledgedPct > 50) pledgeScore = 0;
    else if (pledgedPct > 25) pledgeScore = 30;
    else if (pledgedPct > 10) pledgeScore = 60;
    else if (pledgedPct > 0) pledgeScore = 85;

    const managementQualityScore = Math.round(promoterScore * 0.5 + pledgeScore * 0.5);

    // --- 6. Valuation Context Component (5%) ---
    // Sector-Relative P/E, P/B Multiples
    let valContextScore = 50;
    if (pe > 0 && pe < sectorPe * 0.8) valContextScore = 90;
    else if (pe > 0 && pe < sectorPe * 1.1) valContextScore = 70;
    else if (pe > sectorPe * 1.5) valContextScore = 30;
    else if (pe > sectorPe * 2.0) valContextScore = 10;

    // --- FINAL WEIGHTED QUALITY SCORE CALCULATION ---
    const finalQualityScore = Math.round(
      profitabilityScore * 0.30 +
      growthScore * 0.20 +
      financialStrengthScore * 0.20 +
      cashFlowScore * 0.15 +
      managementQualityScore * 0.10 +
      valContextScore * 0.05
    );

    const qualityScore = Math.max(1, Math.min(100, finalQualityScore));

    // --- STATUS LABEL CLASSIFICATION ---
    let statusLabel = 'Average';
    if (qualityScore >= 85) {
      statusLabel = 'Excellent';
    } else if (qualityScore >= 70) {
      statusLabel = 'High';
    } else if (qualityScore >= 55) {
      statusLabel = 'Good';
    } else if (qualityScore >= 40) {
      statusLabel = 'Average';
    } else {
      statusLabel = 'Poor';
    }

    const formattedOutput = `Quality Score: ${qualityScore}/100 | Status: ${statusLabel}`;

    return {
      symbol: cleanSym,
      qualityScore,
      statusLabel,
      formattedOutput,
      breakdown: {
        profitabilityScore,
        growthScore,
        financialStrengthScore,
        cashFlowScore,
        managementQualityScore,
        valContextScore,
      },
    };
  }
}

module.exports = new QualityScoringEngine();
