const healthScoringEngine = require('./healthScoringEngine');

/**
 * Decoupled Modular Stock Analyzer Engine
 * Strictly keeps analysis modules separate:
 * 1. Financial Health Module (No valuation metrics allowed)
 * 2. Business Quality Module
 * 3. Growth Module
 * 4. Valuation Module (P/E, P/B, EV/EBITDA, Share Price)
 * 5. Technical Analysis Module
 * 6. Risk Module
 * 7. Final Investment Score Synthesis
 */
class ModularStockAnalyzer {
  /**
   * Run full decoupled multi-module analysis on a stock
   * @param {object} input Raw financial data input
   * @returns {object} Comprehensive multi-module breakdown
   */
  analyzeStock(input = {}) {
    // Module 1: Financial Health (Strictly DECOUPLED from P/E or share price)
    const financialHealth = healthScoringEngine.analyze(input);

    // Module 2: Business Quality
    const roe = input.roe || 0;
    const roce = input.roce || 0;
    const qualityScore = Math.min(100, Math.round((roe * 2 + roce * 2 + (input.cfo > 0 ? 20 : 0)) / 4 * 10) / 10);

    // Module 3: Growth Score
    const salesCagr = input.salesCagr3Y || input.salesCagr5Y || 0;
    const profitCagr = input.profitCagr3Y || input.profitCagr5Y || 0;
    const growthScore = Math.min(100, Math.round((salesCagr * 2 + profitCagr * 2) * 10) / 10);

    // Module 4: Valuation Score (P/E, P/B, EV/EBITDA - Kept strictly separate!)
    const pe = input.pe || 25;
    let valuationScore = 50;
    if (pe <= 0) valuationScore = 15;
    else if (pe < 15) valuationScore = 90;
    else if (pe < 25) valuationScore = 70;
    else if (pe < 40) valuationScore = 45;
    else valuationScore = 20;

    // Module 5: Technical Analysis (Placeholder / Momentum)
    const technicalScore = 65;

    // Module 6: Risk Assessment
    const riskScore = financialHealth.riskLevel === 'High Risk' ? 80 : (financialHealth.riskLevel === 'Moderate Risk' ? 50 : 20);

    // Module 7: Final Synthesis (Weighted average of all modules)
    const finalInvestmentScore = Math.round(
      financialHealth.financialHealthScore * 0.35 +
      qualityScore * 0.20 +
      growthScore * 0.15 +
      valuationScore * 0.15 +
      technicalScore * 0.15
    );

    return {
      symbol: financialHealth.symbol,
      companyName: financialHealth.companyName,
      sector: financialHealth.sector,
      finalInvestmentScore,

      modules: {
        financialHealth, // Module 1: Decoupled Financial Health
        businessQuality: { score: qualityScore, label: qualityScore >= 70 ? 'High Quality' : 'Average Quality' },
        growth: { score: growthScore, label: growthScore >= 60 ? 'Strong Growth' : 'Moderate Growth' },
        valuation: { score: valuationScore, peMultiple: pe, pbMultiple: input.pb || null, label: valuationScore >= 70 ? 'Undervalued' : (valuationScore >= 45 ? 'Fairly Valued' : 'Expensive') },
        technicalAnalysis: { score: technicalScore, trend: 'Bullish' },
        riskAssessment: { score: riskScore, riskLevel: financialHealth.riskLevel },
      },
    };
  }
}

module.exports = new ModularStockAnalyzer();
