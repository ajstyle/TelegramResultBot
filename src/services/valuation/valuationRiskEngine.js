/**
 * Risk Assessment Engine for Valuation
 * Evaluates financial leverage, promoter pledge risk, earnings volatility, and governance flags.
 */
class ValuationRiskEngine {
  evaluateRisk(financials, ratios, sectorConfig) {
    let penaltyScore = 0;
    const flags = [];

    // 1. Debt & Leverage Penalty
    const deThreshold = sectorConfig.riskRules?.highDebtToEquityThreshold || 1.2;
    if (ratios.debtToEquity > deThreshold) {
      const excessDebt = ratios.debtToEquity - deThreshold;
      const debtPenalty = Math.min(25, excessDebt * 15);
      penaltyScore += debtPenalty;
      flags.push(`High Leverage (Debt/Equity: ${ratios.debtToEquity})`);
    }

    // 2. Promoter Pledge Penalty
    const pledgePct = financials.promoterPledgePct || 0;
    const pledgeThreshold = sectorConfig.riskRules?.promoterPledgeThreshold || 15.0;
    if (pledgePct > pledgeThreshold) {
      const pledgePenalty = Math.min(20, (pledgePct - pledgeThreshold) * 0.8);
      penaltyScore += pledgePenalty;
      flags.push(`High Promoter Pledge (${pledgePct}%)`);
    }

    // 3. Negative Cash Flow Penalty
    if (ratios.fcfYield < 0) {
      penaltyScore += 10;
      flags.push('Negative Free Cash Flow');
    }

    // 4. Low Return on Capital Penalty
    if (ratios.roce < 8.0 && sectorConfig.sector !== 'Banking') {
      penaltyScore += 10;
      flags.push(`Low Return on Capital (ROCE: ${ratios.roce}%)`);
    }

    // 5. Negative Earnings / Loss-Making Penalty
    if (ratios.pe < 0 || (financials.eps !== undefined && financials.eps < 0)) {
      penaltyScore += 25;
      flags.push('Negative Earnings / Net Loss');
    }

    const riskScore = Math.max(0, Math.min(100, 100 - penaltyScore));

    return {
      riskScore: Math.round(riskScore * 10) / 10,
      penaltyScore: Math.round(penaltyScore * 10) / 10,
      flags
    };
  }
}

module.exports = new ValuationRiskEngine();
