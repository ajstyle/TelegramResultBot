const deduplicator = require('../src/services/ingestion/deduplicator');

describe('Announcement Deduplicator Unit Tests', () => {
  test('Filters out duplicate announcements from different sources (NSE vs BSE vs Telegram)', () => {
    const item1 = {
      source: 'NSE',
      symbol: 'TCS',
      title: 'TCS Board Meeting Financial Outcome Q3 Results',
    };

    const item2 = {
      source: 'BSE',
      symbol: 'TCS',
      title: 'TCS Board Meeting Financial Outcome Q3 Results',
    };

    const isFirstUnique = deduplicator.isUnique(item1);
    const isDuplicateFiltered = deduplicator.isUnique(item2);

    expect(isFirstUnique).toBe(true);
    expect(isDuplicateFiltered).toBe(false);
  });

  test('Allows unique announcement for a different symbol', () => {
    const item = {
      source: 'NSE',
      symbol: 'RELIANCE',
      title: 'RELIANCE Board Meeting Financial Outcome Q3 Results',
    };

    const isUnique = deduplicator.isUnique(item);
    expect(isUnique).toBe(true);
  });

  test('Filters out duplicate cross-exchange filings matching BSE ScripCode 534675 and NSE Ticker PROZONER', () => {
    const bseItem = {
      source: 'BSE',
      symbol: 'PROZONE REALTY LTD',
      scripCode: '534675',
      title: 'Outcome of Board Meeting - Financial Results',
      date: '2026-08-14T16:24:06Z',
    };

    const nseItem = {
      source: 'NSE',
      symbol: 'PROZONER',
      title: 'Financial Result - Outcome of Board Meeting',
      date: '2026-08-14T16:30:37Z',
    };

    expect(deduplicator.isUnique(bseItem)).toBe(true);
    expect(deduplicator.isUnique(nseItem)).toBe(false);
  });
});
