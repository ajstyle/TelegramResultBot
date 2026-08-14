/**
 * Scoring Engine
 * Synthesizes Valuation, Growth, Profitability, Financial Health, Risk, and Peer relative metrics
 * into a sector-weighted composite score (0 to 100).
 */
class ScoringEngine {
  calculateCompositeScore(ratios, peerEval, dcfEval, riskEval, sectorConfig) {
    const weights = sectorConfig.weights || {
      valuation: 0.30,
      growth: 0.20,
      profitability: 0.20,
      financialHealth: 0.15,
      risk: 0.15
    };

    // 1. Valuation Component (0-100)
    let valSubScore = 50;
    if (ratios.pe < 0) {
      valSubScore = 20; // Severe penalty for negative P/E
    } else if (ratios.pe > 50) {
      valSubScore = 15; // Heavy penalty for super high P/E (>50x)
    } else if (ratios.pe > 38) {
      valSubScore = 30; // High P/E penalty (>38x)
    } else if (peerEval.peDiscount > 20) valSubScore += 25;
    else if (peerEval.peDiscount > 0) valSubScore += 12;
    else if (peerEval.peDiscount < -30) valSubScore -= 25;
    else if (peerEval.peDiscount < 0) valSubScore -= 12;

    if (ratios.pe > 0 && ratios.pe <= 38) {
      if (dcfEval.marginOfSafetyPct > 20) valSubScore += 25;
      else if (dcfEval.marginOfSafetyPct > 0) valSubScore += 12;
      else if (dcfEval.marginOfSafetyPct < -20) valSubScore -= 25;
    }

    valSubScore = Math.max(0, Math.min(100, valSubScore));

    // 2. Growth Component (0-100)
    let growthSubScore = 50;
    if (ratios.earningsGrowth > 20) growthSubScore = 90;
    else if (ratios.earningsGrowth > 10) growthSubScore = 70;
    else if (ratios.earningsGrowth > 0) growthSubScore = 50;
    else growthSubScore = 20;

    // 3. Profitability Component (0-100)
    let profSubScore = 50;
    const returnMetric = sectorConfig.sector === 'Banking' ? ratios.roe : ratios.roce;
    if (returnMetric > 20) profSubScore = 90;
    else if (returnMetric > 14) profSubScore = 70;
    else if (returnMetric > 8) profSubScore = 50;
    else profSubScore = 20;

    // 4. Financial Health Component (0-100)
    let healthSubScore = 50;
    if (ratios.debtToEquity < 0.3) healthSubScore = 90;
    else if (ratios.debtToEquity < 0.8) healthSubScore = 70;
    else if (ratios.debtToEquity < 1.5) healthSubScore = 40;
    else healthSubScore = 15;

    // 5. Risk Component (0-100)
    const riskSubScore = riskEval.riskScore;

    // Composite Weighted Score Calculation
    const compositeScore =
      valSubScore * (weights.valuation || 0.3) +
      growthSubScore * (weights.growth || 0.2) +
      profSubScore * (weights.profitability || 0.2) +
      healthSubScore * (weights.financialHealth || 0.15) +
      riskSubScore * (weights.risk || 0.15);

    return Math.round(compositeScore * 10) / 10;
  }
}

module.exports = new ScoringEngine();
