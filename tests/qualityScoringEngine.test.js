const qualityScoringEngine = require('../src/services/quality/qualityScoringEngine');

describe('Stock Quality Scoring Engine for Indian Equities', () => {
  test('Calculates quality score and status label for TCS', async () => {
    const res = await qualityScoringEngine.calculateQualityScore('TCS');
    expect(res.qualityScore).toBeGreaterThanOrEqual(1);
    expect(res.qualityScore).toBeLessThanOrEqual(100);
    expect(['Excellent', 'High', 'Good', 'Average', 'Poor']).toContain(res.statusLabel);
    expect(res.formattedOutput).toMatch(/^Quality Score: \d+\/100 \| Status: (Excellent|High|Good|Average|Poor)$/);
  });

  test('Calculates quality score for RELIANCE', async () => {
    const res = await qualityScoringEngine.calculateQualityScore('RELIANCE');
    expect(res.qualityScore).toBeGreaterThanOrEqual(1);
    expect(res.qualityScore).toBeLessThanOrEqual(100);
    expect(res.formattedOutput).toContain('Quality Score');
  });

  test('Evaluates custom fundamentals payload accurately', async () => {
    const custom = {
      cmp: 1500,
      marketCapCr: 10000,
      pe: 18,
      roe: 28,
      roce: 32,
      operatingMargin: 24,
      salesGrowthYoY: 20,
      profitGrowthYoY: 22,
      debtToEquity: 0.1,
      interestCoverage: 15,
      currentRatio: 2.1,
      freeCashFlow: 500,
      operatingCashFlow: 650,
      promoterHolding: 68,
      pledgedPercentage: 0,
      sectorPe: 25,
    };

    const res = await qualityScoringEngine.calculateQualityScore('HIGHQUAL', custom);
    expect(res.qualityScore).toBeGreaterThanOrEqual(80);
    expect(['Excellent', 'High']).toContain(res.statusLabel);
    expect(res.formattedOutput).not.toContain('{');
    expect(res.formattedOutput).not.toContain('Overvalued');
    expect(res.formattedOutput).not.toContain('Undervalued');
  });
});
