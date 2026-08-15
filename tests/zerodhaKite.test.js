const zerodhaKite = require('../src/services/zerodhaKite');
const config = require('../src/config');

describe('Zerodha Kite Service Module Tests', () => {
  let origMode;

  beforeAll(() => {
    origMode = config.tradingMode;
    config.tradingMode = 'PAPER';
  });

  afterAll(() => {
    config.tradingMode = origMode;
  });

  test('resolveInstrument returns formatted instrument structure', async () => {
    const inst = await zerodhaKite.resolveInstrument('SHALPAINTS', 'NSE');
    expect(inst.tradingsymbol).toBe('SHALPAINTS');
    expect(inst.exchange).toBe('NSE');
    expect(inst.exchangeSymbol).toBe('NSE:SHALPAINTS');
  });

  test('placeOrder simulates PAPER mode order placement cleanly', async () => {
    const res = await zerodhaKite.placeOrder({
      symbol: 'BLACKBOX',
      action: 'BUY',
      quantity: 10,
      price: 1718.5,
    });
    expect(res.success).toBe(true);
    expect(res.orderId).toContain('KITE_PAPER_');
    expect(res.symbol).toBe('BLACKBOX');
    expect(res.broker).toBe('Zerodha Kite');
    expect(res.isSimulated).toBe(true);
  });
});
