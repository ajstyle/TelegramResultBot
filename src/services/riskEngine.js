const config = require('../config');

class RiskEngine {
  /**
   * Calculate ATR (Average True Range) from candle data
   * @param {Array<{ high: number, low: number, close: number }>} candles
   * @param {number} period default 14
   * @returns {number|null}
   */
  calculateATR(candles, period = config.risk.atrPeriod) {
    if (!Array.isArray(candles) || candles.length < 2) {
      return null;
    }

    const trueRanges = [];
    for (let i = 1; i < candles.length; i++) {
      const high = candles[i].high;
      const low = candles[i].low;
      const prevClose = candles[i - 1].close;

      const tr = Math.max(
        high - low,
        Math.abs(high - prevClose),
        Math.abs(low - prevClose)
      );
      trueRanges.push(tr);
    }

    if (trueRanges.length === 0) return null;

    const calcPeriod = Math.min(period, trueRanges.length);
    const recentTRs = trueRanges.slice(-calcPeriod);
    const sum = recentTRs.reduce((acc, val) => acc + val, 0);
    const atr = sum / calcPeriod;

    return parseFloat(atr.toFixed(2));
  }

  /**
   * Calculate Stop Loss if missing
   * @param {string} action BUY or SELL
   * @param {number} entry Entry Price
   * @param {number|null} providedSL Stop loss from OCR signal if available
   * @param {number|null} atr ATR value
   * @returns {{ stopLoss: number, atrUsed: number, isCalculated: boolean }}
   */
  calculateStopLoss(action, entry, providedSL, atr) {
    if (providedSL && !isNaN(providedSL) && providedSL > 0) {
      return {
        stopLoss: parseFloat(providedSL.toFixed(2)),
        atrUsed: atr,
        isCalculated: false,
      };
    }

    // Default ATR fallback if not provided (2% of entry price)
    const effectiveATR = atr || parseFloat((entry * 0.02).toFixed(2));
    const atrMultiplier = config.risk.atrMultiplier;

    let stopLoss;
    if (action.toUpperCase() === 'BUY') {
      stopLoss = entry - effectiveATR * atrMultiplier;
    } else {
      stopLoss = entry + effectiveATR * atrMultiplier;
    }

    // Ensure stop loss is positive
    if (stopLoss <= 0) {
      stopLoss = parseFloat((entry * 0.95).toFixed(2));
    }

    return {
      stopLoss: parseFloat(stopLoss.toFixed(2)),
      atrUsed: effectiveATR,
      isCalculated: true,
    };
  }

  /**
   * Calculate Position Sizing (Quantity)
   * @param {number} entry Price
   * @param {number} stopLoss Price
   * @param {number} capital Account Capital (default from config)
   * @param {number} riskPercentage Risk per trade (e.g. 0.01 for 1%)
   * @returns {{ quantity: number, maxRiskAmount: number, riskPerShare: number }}
   */
  calculatePositionSize(
    entry,
    stopLoss,
    capital = config.risk.accountCapital,
    riskPercentage = config.risk.riskPerTrade
  ) {
    const riskPerShare = Math.abs(entry - stopLoss);

    if (riskPerShare <= 0) {
      return { quantity: 0, maxRiskAmount: 0, riskPerShare: 0 };
    }

    const maxRiskAmount = capital * riskPercentage;
    const rawQuantity = maxRiskAmount / riskPerShare;
    
    // Always round quantity down to an integer
    const quantity = Math.floor(rawQuantity);

    return {
      quantity: Math.max(0, quantity),
      maxRiskAmount: parseFloat(maxRiskAmount.toFixed(2)),
      riskPerShare: parseFloat(riskPerShare.toFixed(2)),
    };
  }
}

module.exports = new RiskEngine();
