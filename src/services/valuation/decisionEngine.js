/**
 * Decision Engine
 * Maps final composite score and margin of safety to ONE of the 5 canonical valuation labels:
 * "Deeply Undervalued" | "Undervalued (Cheap)" | "Fairly Valued" | "Slightly Expensive" | "Overvalued"
 */
class DecisionEngine {
  determineValuationLabel(compositeScore, marginOfSafetyPct, riskFlags = []) {
    // 1. Deeply Undervalued: High composite score & strong margin of safety (+15%+)
    if (compositeScore >= 72 && marginOfSafetyPct >= 15.0) {
      return 'Deeply Undervalued';
    }

    // 2. Undervalued (Cheap): Above average composite score or moderate margin of safety (+10%+)
    if (compositeScore >= 64 || (compositeScore >= 55 && marginOfSafetyPct >= 10.0)) {
      return 'Undervalued (Cheap)';
    }

    // 3. Overvalued: Very low composite score (<30) or severe negative margin of safety (<-25%)
    if (compositeScore < 30 || marginOfSafetyPct < -25.0 || (riskFlags.length >= 3 && compositeScore < 45)) {
      return 'Overvalued';
    }

    // 4. Slightly Expensive: Low composite score (30-44) or negative margin of safety (-10% to -24%)
    if (compositeScore <= 44 || marginOfSafetyPct <= -10.0) {
      return 'Slightly Expensive';
    }

    // 5. Fairly Valued: Default central range (45-63)
    return 'Fairly Valued';
  }
}

module.exports = new DecisionEngine();
