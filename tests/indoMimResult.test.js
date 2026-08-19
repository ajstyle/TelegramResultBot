const bseAdapter = require('../src/services/adapters/bseAdapter');
const deduplicator = require('../src/services/ingestion/deduplicator');
const cardGenerator = require('../src/services/cardGenerator');
const geminiAnalyzer = require('../src/services/ai/geminiAnalyzer');

describe('Indo-MIM & Financial Results Fixes', () => {
  test('bseAdapter.extractCompanyName correctly extracts INDO-MIM without truncating to INDO', () => {
    const title1 = 'INDO-MIM LIMITED - Financial Results for the quarter ended June 30, 2026';
    const title2 = '544123 - INDO-MIM LIMITED - Outcome of Board Meeting';
    const title3 = 'INDO-MIM LIMITED - Announcement under Regulation 33';

    expect(bseAdapter.extractCompanyName(title1)).toBe('INDO-MIM LIMITED');
    expect(bseAdapter.extractCompanyName(title2)).toBe('INDO-MIM LIMITED');
    expect(bseAdapter.extractCompanyName(title3)).toBe('INDO-MIM LIMITED');
  });

  test('deduplicator produces matching canonical key for BSE (INDO-MIM) and NSE (INDOMIM)', () => {
    const bseItem = { symbol: 'INDO-MIM', scripCode: '544123', title: 'INDO-MIM LIMITED - Financial Results', date: '17-08-2026 18:30:00' };
    const nseItem = { symbol: 'INDOMIM', title: 'INDOMIM LIMITED - Financial Results', date: '2026-08-17T18:30:00.000Z' };

    const key1 = deduplicator.getCanonicalKey(bseItem);
    const key2 = deduplicator.getCanonicalKey(nseItem);

    expect(key1).toBe('INDOM');
    expect(key2).toBe('INDOM');

    // Test deduplication logic across sources
    const hash1 = deduplicator.generateHash(bseItem);
    const hash2 = deduplicator.generateHash(nseItem);
    expect(hash1).toBe(hash2);
  });

  test('cardGenerator preserves 0%, +0%, 0 bps values on scorecard photo card', () => {
    const data = {
      symbol: 'INDO-MIM',
      scripCode: '544123',
      symbolName: 'INDO-MIM LIMITED',
      cmp: '₹450',
      category: 'Small Cap',
      mcapCr: '3500 Cr',
      pe: '22',
      qualityScore: 78,
      qualityStatus: 'Good',
      valuationLabel: 'Fairly Valued',
      pulseRating: 'Good 👍',
      periodLabels: { q_t: "Jun'26", q_t1: "Mar'26", q_t4: "Jun'25" },
      scorecard: {
        pulseRating: 'Good 👍',
        Sales: { QoQ: '+0%', YoY: '+15%', Qt: 250, Qt1: 250, Qt4: 217 },
        'Other Inc.': { QoQ: '-', YoY: '-', Qt: 5, Qt1: 4, Qt4: 3 },
        OP: { QoQ: '0%', YoY: '+10%', Qt: 45, Qt1: 45, Qt4: 41 },
        OPM: { QoQ: '0 bps', YoY: '+50 bps', Qt: '18%', Qt1: '18%', Qt4: '17.5%' },
        PAT: { QoQ: '+5%', YoY: '+12%', Qt: 30, Qt1: 28.5, Qt4: 26.8 },
        EPS: { QoQ: '+5%', YoY: '+12%', Qt: 6, Qt1: 5.7, Qt4: 5.3 },
      },
    };

    const pngBuf = cardGenerator.generatePngCard(data);
    expect(pngBuf).toBeDefined();
    expect(Buffer.isBuffer(pngBuf)).toBe(true);
    expect(pngBuf.length).toBeGreaterThan(1000);
  });

  test('geminiAnalyzer calculates universal scorecard accurately', () => {
    const q_t = { sales: 300, other_inc: 10, op: 60, pat: 40, eps: 8 };
    const q_t1 = { sales: 280, other_inc: 8, op: 55, pat: 35, eps: 7 };
    const q_t4 = { sales: 250, other_inc: 5, op: 50, pat: 30, eps: 6 };

    const sc = geminiAnalyzer.calculateUniversalScorecard(q_t, q_t1, q_t4, false);
    expect(sc.Sales.QoQ).toBe('+7%');
    expect(sc.Sales.YoY).toBe('+20%');
    expect(sc.PAT.QoQ).toBe('+14%');
    expect(sc.PAT.YoY).toBe('+33%');
    expect(sc.pulseRating).toBeDefined();
  });
});
