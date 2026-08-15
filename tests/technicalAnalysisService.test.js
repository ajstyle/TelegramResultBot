const technicalAnalysisService = require('../src/services/technical/technicalAnalysisService');

describe('Technical Analysis Service & Scoring Engine', () => {

  function generateMockCandles(count = 210, trend = 'BULLISH', basePrice = 100) {
    const candles = [];
    let price = basePrice;

    for (let i = 0; i < count; i++) {
      let change = 0;
      if (trend === 'BULLISH') change = 0.5 + (Math.sin(i) * 0.2);
      else if (trend === 'BEARISH') change = -0.5 - (Math.sin(i) * 0.2);
      else change = (Math.sin(i * 0.5) * 0.8); // Sideways

      price = Math.max(10, price + change);
      candles.push({
        open: price - 0.2,
        high: price + 1.0,
        low: price - 1.0,
        close: price,
        volume: 10000 + (i % 5) * 2000,
      });
    }
    return candles;
  }

  test('1. SMA & EMA Calculation Correctness', () => {
    const candles = Array.from({ length: 50 }, (_, i) => ({ close: (i + 1) * 10 }));
    const sma20 = technicalAnalysisService.calculateSMA(candles, 20);
    expect(sma20).toBe(405); // Average of 310..500 = 405

    const ema20 = technicalAnalysisService.calculateEMA(candles, 20);
    expect(ema20).toBeGreaterThanOrEqual(405); // EMA tracks recent price momentum
  });

  test('2. RSI Calculation Bounds (0 - 100)', () => {
    const candles = Array.from({ length: 30 }, (_, i) => ({ close: 100 + i * 2 })); // Pure uptrend
    const rsi = technicalAnalysisService.calculateRSI(candles, 14);
    expect(rsi).toBe(100);

    const downtrendCandles = Array.from({ length: 30 }, (_, i) => ({ close: 200 - i * 2 })); // Pure downtrend
    const rsiDown = technicalAnalysisService.calculateRSI(downtrendCandles, 14);
    expect(rsiDown).toBe(0);
  });

  test('3. MACD Calculation Returns Expected Structure', () => {
    const candles = generateMockCandles(60, 'BULLISH');
    const macd = technicalAnalysisService.calculateMACD(candles);
    expect(macd).toHaveProperty('macd');
    expect(macd).toHaveProperty('signal');
    expect(macd).toHaveProperty('histogram');
    expect(typeof macd.histogram).toBe('number');
  });

  test('4. Relative Volume Calculation (RVOL)', () => {
    const candles = generateMockCandles(30, 'SIDEWAYS');
    candles[candles.length - 1].volume = 40000; // Spike volume 4x
    const rvol = technicalAnalysisService.calculateRelativeVolume(candles, 20);
    expect(rvol).toBeGreaterThan(2.0);
  });

  test('5. Price Structure Analysis (Higher High / Higher Low)', () => {
    const bullishCandles = generateMockCandles(30, 'BULLISH');
    const bullishStructure = technicalAnalysisService.calculatePriceStructure(bullishCandles);
    expect(bullishStructure.structure).toBe('BULLISH_TREND');

    const bearishCandles = generateMockCandles(30, 'BEARISH');
    const bearishStructure = technicalAnalysisService.calculatePriceStructure(bearishCandles);
    expect(bearishStructure.structure).toBe('BEARISH_TREND');
  });

  test('6. Golden Cross vs Death Cross Scoring Impact', () => {
    const bullishCandles = generateMockCandles(210, 'BULLISH');
    const scoreBull = technicalAnalysisService.calculateTechnicalScore(bullishCandles);
    expect(scoreBull).toBeGreaterThanOrEqual(80); // Strong Golden Cross

    const bearishCandles = generateMockCandles(210, 'BEARISH');
    const scoreBear = technicalAnalysisService.calculateTechnicalScore(bearishCandles);
    expect(scoreBear).toBeLessThan(35); // Weak Death Cross
  });

  test('7. Deterministic Clamping (Never >100 or <0)', () => {
    const superBullishCandles = generateMockCandles(300, 'BULLISH');
    // Force extreme volume and outperformance
    superBullishCandles.forEach(c => c.volume = 1000000);
    const indexCandles = Array.from({ length: 300 }, () => ({ close: 100 }));
    
    const maxScore = technicalAnalysisService.calculateTechnicalScore(superBullishCandles, indexCandles);
    expect(maxScore).toBeLessThanOrEqual(100);

    const superBearishCandles = generateMockCandles(300, 'BEARISH');
    const minScore = technicalAnalysisService.calculateTechnicalScore(superBearishCandles, indexCandles);
    expect(minScore).toBeGreaterThanOrEqual(0);
  });

  test('8. Status Threshold Mappings', () => {
    expect(technicalAnalysisService.getTechnicalStatus(87)).toEqual({
      technicalStatus: 'STRONG',
      displayStatus: '🔥 STRONG — 87/100',
    });

    expect(technicalAnalysisService.getTechnicalStatus(74)).toEqual({
      technicalStatus: 'BULLISH',
      displayStatus: '🟢 BULLISH — 74/100',
    });

    expect(technicalAnalysisService.getTechnicalStatus(58)).toEqual({
      technicalStatus: 'NEUTRAL',
      displayStatus: '🟡 NEUTRAL — 58/100',
    });

    expect(technicalAnalysisService.getTechnicalStatus(42)).toEqual({
      technicalStatus: 'WEAK',
      displayStatus: '🟠 WEAK — 42/100',
    });

    expect(technicalAnalysisService.getTechnicalStatus(20)).toEqual({
      technicalStatus: 'VERY_WEAK',
      displayStatus: '🔴 VERY WEAK — 20/100',
    });

    expect(technicalAnalysisService.getTechnicalStatus(null)).toEqual({
      technicalStatus: 'DATA_UNAVAILABLE',
      displayStatus: '⚪ DATA UNAVAILABLE',
    });
  });

  test('9. Missing / Insufficient Data Handling (<20 candles)', () => {
    const insufficientCandles = generateMockCandles(15, 'BULLISH');
    const result = technicalAnalysisService.analyzeStock('XYZ', insufficientCandles);

    expect(result).toEqual({
      symbol: 'XYZ',
      technicalScore: null,
      technicalStatus: 'DATA_UNAVAILABLE',
      displayStatus: '⚪ DATA UNAVAILABLE',
      dataQuality: 'INSUFFICIENT',
    });
  });

  test('10. Deterministic Consistency (Identical Inputs Yield Identical Scores)', () => {
    const candles = generateMockCandles(100, 'BULLISH');
    const score1 = technicalAnalysisService.calculateTechnicalScore(candles);
    const score2 = technicalAnalysisService.calculateTechnicalScore(candles);

    expect(score1).toBe(score2);
    expect(score1).not.toBeNull();
  });
});
