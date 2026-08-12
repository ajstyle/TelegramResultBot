const config = require('../config');

class DecisionEngine {
  /**
   * Evaluate trade parameters and output unified decision, confidence, and reasoned analysis
   * @param {object} params
   * @returns {{ recommendation: string, score: number, confidence: string, reasonedSummary: string, reasons: string[], warnings: string[] }}
   */
  evaluate({
    action,
    symbol,
    entry,
    stopLoss,
    target,
    quantity,
    ltp,
    ocrConfidence,
    fundamentals,
    atr,
  }) {
    const reasons = [];
    const warnings = [];
    let scorePoints = 0;
    let maxPoints = 0;

    // 1. OCR Confidence check
    maxPoints += 20;
    if (ocrConfidence >= config.ocr.confidenceThreshold) {
      scorePoints += 20;
      reasons.push(`OCR Confidence is high (${Math.round(ocrConfidence)}%).`);
    } else {
      scorePoints += 5;
      warnings.push(`OCR Confidence is low (${Math.round(ocrConfidence)}%). Manual verification required.`);
    }

    // 2. Risk/Reward & Stop Loss Check
    const risk = Math.abs(entry - stopLoss);
    maxPoints += 20;
    let riskLevel = 'Low';
    if (risk > 0) {
      const riskPercent = (risk / entry) * 100;
      if (riskPercent <= 3) {
        riskLevel = 'Low';
        scorePoints += 20;
        reasons.push(`Stop Loss distance (${riskPercent.toFixed(1)}%) is tight & low-risk.`);
      } else if (riskPercent <= 7) {
        riskLevel = 'Moderate';
        scorePoints += 15;
        reasons.push(`Stop Loss distance (${riskPercent.toFixed(1)}%) is moderate.`);
      } else {
        riskLevel = 'High';
        scorePoints += 8;
        warnings.push(`Stop Loss distance (${riskPercent.toFixed(1)}%) is wide; position size adjusted.`);
      }

      if (target) {
        const reward = Math.abs(target - entry);
        const rrRatio = reward / risk;
        if (rrRatio >= 1.5) {
          reasons.push(`Risk-to-Reward ratio is favorable (1:${rrRatio.toFixed(1)}).`);
        } else {
          warnings.push(`Risk-to-Reward ratio is low (1:${rrRatio.toFixed(1)}). Minimum recommended is 1:1.5.`);
        }
      }
    } else {
      warnings.push('Invalid Stop Loss value.');
    }

    // 3. LTP vs Entry Deviation
    if (ltp && entry) {
      maxPoints += 15;
      const deviation = Math.abs((ltp - entry) / entry) * 100;
      if (deviation <= 2) {
        scorePoints += 15;
        reasons.push(`Current LTP (₹${ltp}) is close to signal entry (₹${entry}).`);
      } else if (deviation <= 5) {
        scorePoints += 8;
        warnings.push(`Current LTP (₹${ltp}) has diverged ${deviation.toFixed(1)}% from signal entry price (₹${entry}).`);
      } else {
        warnings.push(`Current LTP (₹${ltp}) has drifted significantly (${deviation.toFixed(1)}%) from entry price.`);
      }
    }

    // 4. Fundamental Quality Check
    maxPoints += 30;
    let fScoreText = 'Data Unavailable';
    let valuationText = 'Fair';
    if (fundamentals && fundamentals.isAvailable && fundamentals.score !== null) {
      const fScore = fundamentals.score;
      scorePoints += Math.round((fScore / 100) * 30);
      fScoreText = `${fScore}/100 (${fundamentals.rating})`;
      valuationText = fundamentals.valuation || 'Fair';

      reasons.push(`Fundamental Quality score is ${fScore}/100 (${fundamentals.rating}). Valuation: ${valuationText}.`);

      if (fScore < 40) {
        warnings.push(`Weak fundamental quality (${fScore}/100). Recommendation: AVOID.`);
      }
    } else {
      scorePoints += 15;
      warnings.push('Fundamental data unavailable from provider. Score calculated using technical & risk parameters only.');
    }

    // 5. ATR Volatility Check
    maxPoints += 15;
    if (atr) {
      scorePoints += 15;
      reasons.push(`ATR volatility (₹${atr}) incorporated into Stop Loss & sizing.`);
    } else {
      scorePoints += 10;
      warnings.push('Historical candle data for ATR calculation was unavailable; default risk model applied.');
    }

    // Calculate Overall Score (0..100)
    const finalScore = Math.min(100, Math.max(0, Math.round((scorePoints / maxPoints) * 100)));

    // Confidence Level
    let confidence = 'MEDIUM';
    if (ocrConfidence >= 80 && finalScore >= 75 && warnings.length <= 1) {
      confidence = 'HIGH';
    } else if (ocrConfidence < 60 || finalScore < 40 || warnings.length >= 3) {
      confidence = 'LOW';
    }

    // Recommendation Categories: STRONG BUY, BUY, HOLD, SELL, AVOID
    let recommendation = action;
    if (ocrConfidence < 40 || finalScore < 40) {
      recommendation = 'AVOID';
    } else if (finalScore >= 85) {
      recommendation = action === 'BUY' ? 'STRONG BUY' : 'STRONG SELL';
    } else if (finalScore >= 60) {
      recommendation = action;
    } else if (finalScore >= 45) {
      recommendation = 'HOLD';
    } else {
      recommendation = 'AVOID';
    }

    // Format Reasoned Decision Summary
    const reasonedSummary = `${action} ${symbol} @ ${entry}, Fundamental Score ${fScoreText}, Valuation ${valuationText}, Risk ${riskLevel}, Suggested SL ${stopLoss}, Qty ${quantity || 'N/A'}, Proceed to Angel One.`;

    return {
      recommendation,
      score: finalScore,
      confidence,
      reasonedSummary,
      reasons,
      warnings,
    };
  }
}

module.exports = new DecisionEngine();
