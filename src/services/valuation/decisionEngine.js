/**
 * Decision Engine
 * Maps final composite score and margin of safety to ONE of the 5 canonical valuation labels:
 * "Deeply Undervalued" | "Undervalued (Cheap)" | "Fairly Valued" | "Slightly Expensive" | "Overvalued"
 */
class DecisionEngine {
  determineValuationLabel(compositeScore, marginOfSafetyPct, riskFlags = []) {
    // 1. Overvalued: Very low composite score (<32) or severe negative margin of safety (<-25%) or multiple risk flags
    if (compositeScore < 32 || marginOfSafetyPct < -25.0 || (riskFlags.length >= 2 && compositeScore < 45)) {
      return 'Overvalued';
    }

    // 2. Deeply Undervalued: High composite score (>=80) & strong margin of safety (+20%+)
    if (compositeScore >= 80 && marginOfSafetyPct >= 20.0) {
      return 'Deeply Undervalued';
    }

    // 3. Undervalued (Cheap): Strong composite score (>=70) & positive margin of safety (+10%+)
    if (compositeScore >= 70 && marginOfSafetyPct >= 10.0) {
      return 'Undervalued (Cheap)';
    }

    // 4. Slightly Expensive: Below average composite score (<52) or negative margin of safety (-5% to -24%)
    if (compositeScore < 52 || marginOfSafetyPct <= -10.0) {
      return 'Slightly Expensive';
    }

    // 5. Fairly Valued: Central baseline range (52 - 69)
    return 'Fairly Valued';
  }
}

module.exports = new DecisionEngine();
