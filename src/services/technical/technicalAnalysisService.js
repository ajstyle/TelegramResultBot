/**
 * Production-Ready Deterministic Technical Analysis Scoring Engine
 * Evaluates genuine NSE/BSE historical OHLCV candle data, computes internal technical indicators,
 * and synthesizes a deterministic 0 to 100 Technical Score and Technical Status.
 *
 * STATUS THRESHOLDS:
 * score >= 80: STRONG      (🔥 STRONG — XX/100)
 * score >= 65: BULLISH     (🟢 BULLISH — XX/100)
 * score >= 50: NEUTRAL     (🟡 NEUTRAL — XX/100)
 * score >= 35: WEAK        (🟠 WEAK — XX/100)
 * score < 35:  VERY_WEAK   (🔴 VERY WEAK — XX/100)
 * Insufficient: DATA_UNAVAILABLE (⚪ DATA UNAVAILABLE)
 */
class TechnicalAnalysisService {
  /**
   * Calculate Simple Moving Average (SMA)
   * @param {Array<{close: number}>} candles
   * @param {number} period
   * @returns {number|null}
   */
  calculateSMA(candles = [], period = 20) {
    if (!Array.isArray(candles) || candles.length < period || period <= 0) {
      return null;
    }
    const slice = candles.slice(-period);
    const sum = slice.reduce((acc, c) => acc + (c.close || c[4] || 0), 0);
    return Math.round((sum / period) * 100) / 100;
  }

  /**
   * Calculate Exponential Moving Average (EMA)
   * @param {Array<{close: number}>} candles
   * @param {number} period
   * @returns {number|null}
   */
  calculateEMA(candles = [], period = 20) {
    if (!Array.isArray(candles) || candles.length < period || period <= 0) {
      return null;
    }
    const k = 2 / (period + 1);
    let ema = this.calculateSMA(candles.slice(0, period), period);
    if (ema === null) return null;

    for (let i = period; i < candles.length; i++) {
      const close = candles[i].close || candles[i][4] || 0;
      ema = close * k + ema * (1 - k);
    }
    return Math.round(ema * 100) / 100;
  }

  /**
   * Calculate Relative Strength Index (RSI 14)
   * @param {Array<{close: number}>} candles
   * @param {number} period
   * @returns {number|null}
   */
  calculateRSI(candles = [], period = 14) {
    if (!Array.isArray(candles) || candles.length <= period) {
      return null;
    }

    let gains = 0;
    let losses = 0;

    for (let i = 1; i <= period; i++) {
      const change = (candles[i].close || candles[i][4]) - (candles[i - 1].close || candles[i - 1][4]);
      if (change >= 0) gains += change;
      else losses += Math.abs(change);
    }

    let avgGain = gains / period;
    let avgLoss = losses / period;

    for (let i = period + 1; i < candles.length; i++) {
      const change = (candles[i].close || candles[i][4]) - (candles[i - 1].close || candles[i - 1][4]);
      if (change >= 0) {
        avgGain = (avgGain * (period - 1) + change) / period;
        avgLoss = (avgLoss * (period - 1)) / period;
      } else {
        avgGain = (avgGain * (period - 1)) / period;
        avgLoss = (avgLoss * (period - 1) + Math.abs(change)) / period;
      }
    }

    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    const rsi = 100 - 100 / (1 + rs);
    return Math.round(rsi * 100) / 100;
  }

  /**
   * Calculate MACD (12, 26, 9)
   * @param {Array<{close: number}>} candles
   * @returns {{macd: number, signal: number, histogram: number}|null}
   */
  calculateMACD(candles = [], fast = 12, slow = 26, signal = 9) {
    if (!Array.isArray(candles) || candles.length < slow + signal) {
      return null;
    }
    const emaFast = this.calculateEMA(candles, fast);
    const emaSlow = this.calculateEMA(candles, slow);

    if (emaFast === null || emaSlow === null) return null;
    const macdLine = emaFast - emaSlow;

    // Calculate signal line as 9-period EMA of MACD series
    const macdSeries = [];
    for (let i = slow; i <= candles.length; i++) {
      const subCandles = candles.slice(0, i);
      const ef = this.calculateEMA(subCandles, fast);
      const es = this.calculateEMA(subCandles, slow);
      if (ef !== null && es !== null) {
        macdSeries.push({ close: ef - es });
      }
    }

    const signalLine = this.calculateEMA(macdSeries, signal) || 0;
    const histogram = Math.round((macdLine - signalLine) * 100) / 100;

    return {
      macd: Math.round(macdLine * 100) / 100,
      signal: Math.round(signalLine * 100) / 100,
      histogram,
    };
  }

  /**
   * Calculate Relative Volume (RVOL) vs 20-period Average Volume
   * @param {Array<{volume: number}>} candles
   * @param {number} period
   * @returns {number|null}
   */
  calculateRelativeVolume(candles = [], period = 20) {
    if (!Array.isArray(candles) || candles.length < period) {
      return null;
    }
    const latestVol = candles[candles.length - 1].volume || candles[candles.length - 1][5] || 0;
    const pastSlice = candles.slice(-period - 1, -1);
    const sumVol = pastSlice.reduce((acc, c) => acc + (c.volume || c[5] || 0), 0);
    const avgVol = sumVol / period;

    if (avgVol === 0) return 1.0;
    return Math.round((latestVol / avgVol) * 100) / 100;
  }

  /**
   * Analyze Price Structure (Higher Highs / Higher Lows vs Lower Highs / Lower Lows)
   * @param {Array<{high: number, low: number, close: number}>} candles
   * @returns {{structure: 'BULLISH_TREND'|'BEARISH_TREND'|'SIDEWAYS', higherHighs: boolean, higherLows: boolean}}
   */
  calculatePriceStructure(candles = []) {
    if (!Array.isArray(candles) || candles.length < 10) {
      return { structure: 'SIDEWAYS', higherHighs: false, higherLows: false };
    }

    const recent = candles.slice(-10);
    const p1High = Math.max(...recent.slice(0, 5).map(c => c.high || c.close));
    const p2High = Math.max(...recent.slice(5).map(c => c.high || c.close));

    const p1Low = Math.min(...recent.slice(0, 5).map(c => c.low || c.close));
    const p2Low = Math.min(...recent.slice(5).map(c => c.low || c.close));

    const higherHighs = p2High > p1High;
    const higherLows = p2Low > p1Low;
    const lowerHighs = p2High < p1High;
    const lowerLows = p2Low < p1Low;

    let structure = 'SIDEWAYS';
    if (higherHighs && higherLows) structure = 'BULLISH_TREND';
    else if (lowerHighs && lowerLows) structure = 'BEARISH_TREND';

    return { structure, higherHighs, higherLows };
  }

  /**
   * Calculate Relative Strength vs Index (NIFTY50)
   * @param {Array<{close: number}>} stockCandles
   * @param {Array<{close: number}>} indexCandles
   * @returns {number|null} Relative outperformance percentage
   */
  calculateRelativeStrength(stockCandles = [], indexCandles = []) {
    if (!stockCandles || stockCandles.length < 20 || !indexCandles || indexCandles.length < 20) {
      return null;
    }
    const stockStart = stockCandles[stockCandles.length - 20].close;
    const stockEnd = stockCandles[stockCandles.length - 1].close;
    const stockReturn = ((stockEnd - stockStart) / stockStart) * 100;

    const idxStart = indexCandles[indexCandles.length - 20].close;
    const idxEnd = indexCandles[indexCandles.length - 1].close;
    const idxReturn = ((idxEnd - idxStart) / idxStart) * 100;

    return Math.round((stockReturn - idxReturn) * 100) / 100;
  }

  /**
   * Compute Deterministic 0 to 100 Technical Score
   * Bounded strictly via: score = Math.max(0, Math.min(100, Math.round(score)))
   * @param {Array<{close: number, high: number, low: number, volume: number}>} candles
   * @param {Array<{close: number}>} indexCandles
   * @returns {number|null} Technical Score (0-100) or null if data is insufficient (<20 candles)
   */
  calculateTechnicalScore(candles = [], indexCandles = []) {
    if (!Array.isArray(candles) || candles.length < 20) {
      return null; // Insufficient historical candles
    }

    const latestPrice = candles[candles.length - 1].close;
    const sma20 = this.calculateSMA(candles, 20);
    const sma50 = candles.length >= 50 ? this.calculateSMA(candles, 50) : null;
    const sma200 = candles.length >= 200 ? this.calculateSMA(candles, 200) : null;

    const rsi = this.calculateRSI(candles, 14);
    const macd = this.calculateMACD(candles);
    const rvol = this.calculateRelativeVolume(candles, 20);
    const structure = this.calculatePriceStructure(candles);
    const relStrength = this.calculateRelativeStrength(candles, indexCandles);

    let score = 50; // Baseline neutral score

    // 1. Moving Average & Trend Structure (+-30 pts)
    if (sma20 !== null && latestPrice > sma20) score += 8;
    else if (sma20 !== null && latestPrice < sma20) score -= 8;

    if (sma50 !== null && latestPrice > sma50) score += 10;
    else if (sma50 !== null && latestPrice < sma50) score -= 10;

    if (sma200 !== null && latestPrice > sma200) score += 12;
    else if (sma200 !== null && latestPrice < sma200) score -= 12;

    // Golden Cross / Death Cross
    if (sma50 !== null && sma200 !== null) {
      if (sma50 > sma200) score += 10; // Golden Cross Alignment
      else if (sma50 < sma200) score -= 10; // Death Cross Alignment
    }

    // 2. Momentum: RSI & MACD (+-25 pts)
    if (rsi !== null) {
      if (rsi >= 50 && rsi <= 68) score += 12; // Bullish momentum zone
      else if (rsi > 68 && rsi <= 80) score += 6; // Overbought strong
      else if (rsi > 80) score -= 8; // Extreme Overbought Risk
      else if (rsi >= 35 && rsi < 50) score -= 6;
      else if (rsi < 35) score -= 14; // Bearish momentum
    }

    if (macd !== null) {
      if (macd.histogram > 0) score += 10; // Bullish MACD Histogram
      else if (macd.histogram < 0) score -= 10;
    }

    // 3. Price Structure: Higher Highs & Higher Lows (+-15 pts)
    if (structure.structure === 'BULLISH_TREND') score += 15;
    else if (structure.structure === 'BEARISH_TREND') score -= 15;

    // 4. Volume Confirmation (+-10 pts)
    if (rvol !== null) {
      if (rvol >= 1.5) score += 10;
      else if (rvol >= 1.1) score += 5;
      else if (rvol < 0.6) score -= 5;
    }

    // 5. NIFTY Outperformance (+-10 pts)
    if (relStrength !== null) {
      if (relStrength > 5.0) score += 10;
      else if (relStrength > 0) score += 5;
      else if (relStrength < -5.0) score -= 10;
    }

    // STRICT BOUNDARY CLAMPING MANDATE: 0 <= score <= 100
    return Math.max(0, Math.min(100, Math.round(score)));
  }

  /**
   * Determine Technical Status Code & Minimal Display String
   * @param {number|null} score
   * @returns {{technicalStatus: string, displayStatus: string}}
   */
  getTechnicalStatus(score) {
    if (score === null || score === undefined || isNaN(score)) {
      return {
        technicalStatus: 'DATA_UNAVAILABLE',
        displayStatus: '⚪ DATA UNAVAILABLE',
      };
    }

    if (score >= 80) {
      return {
        technicalStatus: 'STRONG',
        displayStatus: `🔥 STRONG — ${score}/100`,
      };
    }
    if (score >= 65) {
      return {
        technicalStatus: 'BULLISH',
        displayStatus: `🟢 BULLISH — ${score}/100`,
      };
    }
    if (score >= 50) {
      return {
        technicalStatus: 'NEUTRAL',
        displayStatus: `🟡 NEUTRAL — ${score}/100`,
      };
    }
    if (score >= 35) {
      return {
        technicalStatus: 'WEAK',
        displayStatus: `🟠 WEAK — ${score}/100`,
      };
    }
    return {
      technicalStatus: 'VERY_WEAK',
      displayStatus: `🔴 VERY WEAK — ${score}/100`,
    };
  }

  /**
   * Main Entry Point: Analyze Stock Technical Status
   * Returns ONLY minimal fields required for Frontend Stock Card
   * @param {string} symbol Stock Ticker e.g. 'TCS'
   * @param {Array} candles Stock OHLCV historical candles
   * @param {Array} indexCandles Index benchmark candles
   * @returns {object} Standardized payload
   */
  analyzeStock(symbol = 'STOCK', candles = [], indexCandles = []) {
    const cleanSymbol = (symbol || 'STOCK').toUpperCase().trim();

    if (!Array.isArray(candles) || candles.length < 20) {
      return {
        symbol: cleanSymbol,
        technicalScore: null,
        technicalStatus: 'DATA_UNAVAILABLE',
        displayStatus: '⚪ DATA UNAVAILABLE',
        dataQuality: 'INSUFFICIENT',
      };
    }

    const technicalScore = this.calculateTechnicalScore(candles, indexCandles);
    const { technicalStatus, displayStatus } = this.getTechnicalStatus(technicalScore);

    return {
      symbol: cleanSymbol,
      technicalScore,
      technicalStatus,
      displayStatus,
      dataQuality: 'HIGH',
    };
  }
}

module.exports = new TechnicalAnalysisService();
