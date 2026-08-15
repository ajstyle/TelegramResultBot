const marketCapClassifier = require('../src/services/universe/marketCapClassifier');
const fundamentalsProvider = require('../src/services/fundamentals/provider');
const announcementFilter = require('../src/services/ingestion/announcementFilter');

describe('MarketCapClassifier & Universe Hard Filter Engine', () => {
  jest.setTimeout(15000);
  test('Classifies Large Cap stock (Market Cap >= ₹20,000 Cr)', () => {
    const res = marketCapClassifier.classifyMarketCap(30000, 'EQUITY');
    expect(res.capCategory).toBe('LARGE_CAP');
    expect(res.isAllowed).toBe(true);
    expect(res.marketCap).toBe(30000);
    expect(res.classificationSource).toBeDefined();
    expect(res.classificationDate).toBeDefined();
  });

  test('Classifies Mid Cap stock (₹5,000 Cr <= Market Cap < ₹20,000 Cr)', () => {
    const res = marketCapClassifier.classifyMarketCap(8500, 'EQUITY');
    expect(res.capCategory).toBe('MID_CAP');
    expect(res.isAllowed).toBe(true);
    expect(res.marketCap).toBe(8500);
  });

  test('Classifies Small Cap stock (₹500 Cr <= Market Cap < ₹5,000 Cr)', () => {
    const res = marketCapClassifier.classifyMarketCap(1200, 'EQUITY');
    expect(res.capCategory).toBe('SMALL_CAP');
    expect(res.isAllowed).toBe(true);
    expect(res.marketCap).toBe(1200);
  });

  test('Excludes Micro Cap stock (Market Cap < ₹500 Cr)', () => {
    const res = marketCapClassifier.classifyMarketCap(250, 'EQUITY');
    expect(res.capCategory).toBe('MICRO_CAP');
    expect(res.isAllowed).toBe(false);
  });

  test('Excludes non-equity instruments (ETFs, Mutual Funds, Bonds, Indices)', () => {
    const etf = marketCapClassifier.classifyMarketCap(50000, 'ETF');
    expect(etf.capCategory).toBe('EXCLUDED_SECURITY');
    expect(etf.isAllowed).toBe(false);

    const mf = marketCapClassifier.classifyMarketCap(100000, 'MUTUAL_FUND');
    expect(mf.capCategory).toBe('EXCLUDED_SECURITY');
    expect(mf.isAllowed).toBe(false);

    const bond = marketCapClassifier.classifyMarketCap(20000, 'DEBT BOND');
    expect(bond.capCategory).toBe('EXCLUDED_SECURITY');
    expect(bond.isAllowed).toBe(false);
  });

  test('Marks missing or zero Market Cap as UNVERIFIED', () => {
    const res = marketCapClassifier.classifyMarketCap(null, 'EQUITY');
    expect(res.capCategory).toBe('UNVERIFIED');
    expect(res.isAllowed).toBe(false);
  });

  test('Fundamentals Provider includes classification metadata', async () => {
    const data = await fundamentalsProvider.getFundamentals('TCS');
    expect(data.capCategory).toBeDefined();
    expect(['LARGE_CAP', 'MID_CAP', 'SMALL_CAP']).toContain(data.capCategory);
    expect(data.classificationSource).toBeDefined();
    expect(data.classificationDate).toBeDefined();
    expect(data.isAllowedUniverse).toBe(true);
  });

  test('AnnouncementFilter enforces isAllowedUniverse', () => {
    expect(announcementFilter.isAllowedUniverse(25000)).toBe(true); // Large Cap
    expect(announcementFilter.isAllowedUniverse(7500)).toBe(true);  // Mid Cap
    expect(announcementFilter.isAllowedUniverse(1500)).toBe(true);  // Small Cap
    expect(announcementFilter.isAllowedUniverse(300)).toBe(false);   // Micro Cap (< ₹500 Cr)
    expect(announcementFilter.isAllowedUniverse(50000, 'ETF')).toBe(false); // ETF
  });
});
