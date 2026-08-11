const riskEngine = require('../src/services/riskEngine');

describe('Risk Engine Unit Tests', () => {
  test('Calculates 14-period ATR correctly from daily candle data', () => {
    const candles = Array.from({ length: 15 }, (_, i) => ({
      high: 100 + i * 2,
      low: 95 + i * 2,
      close: 98 + i * 2,
    }));

    const atr = riskEngine.calculateATR(candles, 14);
    expect(atr).toBeGreaterThan(0);
    expect(typeof atr).toBe('number');
  });

  test('Calculates BUY Stop Loss using ATR multiplier when SL is missing', () => {
    const entry = 3520;
    const atr = 48.5;
    const providedSL = null;
    const action = 'BUY';

    const { stopLoss, isCalculated } = riskEngine.calculateStopLoss(action, entry, providedSL, atr);

    // Default ATR Multiplier = 2 -> 3520 - (48.5 * 2) = 3423
    expect(stopLoss).toBe(3423);
    expect(isCalculated).toBe(true);
  });

  test('Calculates SELL Stop Loss using ATR multiplier when SL is missing', () => {
    const entry = 1450;
    const atr = 25;
    const providedSL = null;
    const action = 'SELL';

    const { stopLoss, isCalculated } = riskEngine.calculateStopLoss(action, entry, providedSL, atr);

    // Default ATR Multiplier = 2 -> 1450 + (25 * 2) = 1500
    expect(stopLoss).toBe(1500);
    expect(isCalculated).toBe(true);
  });

  test('Uses provided Stop Loss if present in signal', () => {
    const entry = 3520;
    const providedSL = 3450;
    const atr = 48.5;
    const action = 'BUY';

    const { stopLoss, isCalculated } = riskEngine.calculateStopLoss(action, entry, providedSL, atr);

    expect(stopLoss).toBe(3450);
    expect(isCalculated).toBe(false);
  });

  test('Calculates position size and rounds quantity DOWN to an integer', () => {
    // Capital = 100,000; RiskPerTrade = 1% -> Max Risk = ₹1,000
    // Entry = 3520, SL = 3423 -> Risk per share = ₹97
    // Raw quantity = 1000 / 97 = 10.309 -> Floor to integer 10
    const entry = 3520;
    const stopLoss = 3423;
    const capital = 100000;
    const riskPercentage = 0.01;

    const result = riskEngine.calculatePositionSize(entry, stopLoss, capital, riskPercentage);

    expect(result.maxRiskAmount).toBe(1000);
    expect(result.riskPerShare).toBe(97);
    expect(result.quantity).toBe(10); // Floor integer check
  });
});
