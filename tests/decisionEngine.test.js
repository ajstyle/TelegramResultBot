const decisionEngine = require('../src/services/decisionEngine');

describe('Decision Engine Unit Tests', () => {
  test('Evaluates a high quality trade recommendation', () => {
    const result = decisionEngine.evaluate({
      action: 'BUY',
      symbol: 'TCS',
      entry: 3520,
      stopLoss: 3423,
      target: 3700,
      ltp: 3518,
      ocrConfidence: 92,
      fundamentals: {
        isAvailable: true,
        score: 84,
        rating: 'Strong',
        valuation: 'Fair',
      },
      atr: 48.5,
    });

    expect(['BUY', 'STRONG BUY']).toContain(result.recommendation);
    expect(result.confidence).toBe('HIGH');
    expect(result.score).toBeGreaterThanOrEqual(70);
    expect(result.reasonedSummary).toContain('BUY TCS @ 3520');
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  test('Flags warnings when fundamental quality is poor or data unavailable', () => {
    const result = decisionEngine.evaluate({
      action: 'BUY',
      symbol: 'PENNYSTOCK',
      entry: 100,
      stopLoss: 90,
      target: null,
      ltp: 100,
      ocrConfidence: 75,
      fundamentals: {
        isAvailable: true,
        score: 35,
        rating: 'Avoid',
      },
      atr: 5,
    });

    expect(result.warnings).toContain('Weak fundamental quality (35/100). Recommendation: AVOID.');
  });

  test('Avoids trade if OCR confidence and overall score are too low', () => {
    const result = decisionEngine.evaluate({
      action: 'BUY',
      symbol: 'UNCERTAIN',
      entry: 500,
      stopLoss: 400,
      target: null,
      ltp: 500,
      ocrConfidence: 30, // Low OCR confidence
      fundamentals: null,
      atr: null,
    });

    expect(result.recommendation).toBe('AVOID');
    expect(result.confidence).toBe('LOW');
  });
});
