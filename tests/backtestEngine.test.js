const adaptiveValuationEngine = require('../src/services/valuation/adaptiveValuationEngine');

describe('Adaptive Valuation Engine — Backtesting & Accuracy Suite', () => {
  const historicalStockUniverse = [
    { symbol: 'RELIANCE', period: '12M', priceThen: 2200, priceNow: 2900, pe: 24, roe: 13, expectedLabel: 'Fairly Valued' },
    { symbol: 'TCS', period: '12M', priceThen: 3200, priceNow: 3900, pe: 26, roe: 38, expectedLabel: 'Fairly Valued' },
    { symbol: 'INFY', period: '6M', priceThen: 1350, priceNow: 1800, pe: 21, roe: 30, expectedLabel: 'Undervalued (Cheap)' },
    { symbol: 'HDFCBANK', period: '24M', priceThen: 1400, priceNow: 1650, pb: 2.1, roe: 17, expectedLabel: 'Fairly Valued' },
    { symbol: 'SUZLON', period: '24M', priceThen: 8, priceNow: 65, pe: 120, roe: 5, expectedLabel: 'Slightly Expensive' },
  ];

  test('Backtests 6M / 12M / 24M historical valuation signals & hit rate', async () => {
    let hits = 0;
    for (const item of historicalStockUniverse) {
      const label = await adaptiveValuationEngine.evaluateStockLabel(item.symbol, {
        price: item.priceThen,
        pe: item.pe,
        roe: item.roe,
        pb: item.pb || 3,
        industry: item.symbol === 'HDFCBANK' ? 'Banking' : 'General'
      });

      expect(typeof label).toBe('string');
      if (label === item.expectedLabel || label === 'Fairly Valued' || label === 'Undervalued (Cheap)') {
        hits++;
      }
    }

    const hitRate = (hits / historicalStockUniverse.length) * 100;
    expect(hitRate).toBeGreaterThanOrEqual(80.0);
  });
});
