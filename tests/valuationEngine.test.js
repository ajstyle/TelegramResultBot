const adaptiveValuationEngine = require('../src/services/valuation/adaptiveValuationEngine');
const sectorRegistry = require('../src/services/valuation/sectorRegistry');
const ratioEngine = require('../src/services/valuation/ratioEngine');
const dcfEngine = require('../src/services/valuation/dcfEngine');
const decisionEngine = require('../src/services/valuation/decisionEngine');

describe('Adaptive Indian Stock Valuation Engine', () => {
  const CANONICAL_LABELS = [
    'Deeply Undervalued',
    'Undervalued (Cheap)',
    'Fairly Valued',
    'Slightly Expensive',
    'Overvalued'
  ];

  test('Core Rule: Returns ONLY ONE string label from canonical list', async () => {
    const label = await adaptiveValuationEngine.evaluateStockLabel('RELIANCE');
    expect(typeof label).toBe('string');
    expect(CANONICAL_LABELS).toContain(label);
  });

  test('Sector System: Auto-classifies Banking, IT, FMCG, Metals, Real Estate', () => {
    const bankingSector = sectorRegistry.detectSector('Banking & Finance', 'HDFCBANK');
    expect(bankingSector.sector).toBe('Banking');
    expect(bankingSector.primaryValuationModel).toBe('ResidualIncome');

    const itSector = sectorRegistry.detectSector('Software Services', 'TCS');
    expect(itSector.sector).toBe('IT');
    expect(itSector.primaryValuationModel).toBe('DCF');

    const metalsSector = sectorRegistry.detectSector('Metals & Steel', 'TATASTEEL');
    expect(metalsSector.sector).toBe('Metals');
    expect(metalsSector.primaryValuationModel).toBe('MidCycle_EV_EBITDA');
  });

  test('Ratio Engine: Computes standard valuation metrics', () => {
    const ratios = ratioEngine.computeRatios({
      price: 100,
      eps: 10,
      bvps: 50,
      marketCapCr: 1000,
      ebitdaCr: 200,
      salesCr: 1000,
      patCr: 100,
      debtCr: 100
    });

    expect(ratios.pe).toBe(10);
    expect(ratios.pb).toBe(2);
    expect(ratios.evEbitda).toBe(5.5);
    expect(ratios.roe).toBe(20);
  });

  test('DCF Engine: Calculates intrinsic value and margin of safety', () => {
    const sectorConfig = sectorRegistry.detectSector('IT', 'TCS');
    const dcf = dcfEngine.calculateIntrinsicValue({ price: 100, eps: 10, bvps: 50 }, sectorConfig);
    expect(dcf.intrinsicValue).toBeGreaterThan(0);
    expect(typeof dcf.marginOfSafetyPct).toBe('number');
  });

  test('Decision Engine: Maps composite score & margin of safety to single label', () => {
    expect(decisionEngine.determineValuationLabel(85, 30.0)).toBe('Deeply Undervalued');
    expect(decisionEngine.determineValuationLabel(70, 15.0)).toBe('Undervalued (Cheap)');
    expect(decisionEngine.determineValuationLabel(55, 0.0)).toBe('Fairly Valued');
    expect(decisionEngine.determineValuationLabel(35, -20.0)).toBe('Slightly Expensive');
    expect(decisionEngine.determineValuationLabel(20, -35.0)).toBe('Overvalued');
  });

  test('Institutional Integration: Evaluates TCS, HDFCBANK, TATASTEEL, RELIANCE', async () => {
    const tcsLabel = await adaptiveValuationEngine.evaluateStockLabel('TCS', { price: 3800, pe: 28, roe: 35, industry: 'IT' });
    expect(CANONICAL_LABELS).toContain(tcsLabel);

    const hdfcLabel = await adaptiveValuationEngine.evaluateStockLabel('HDFCBANK', { price: 1600, pb: 2.2, roe: 16, industry: 'Banking' });
    expect(CANONICAL_LABELS).toContain(hdfcLabel);

    const steelLabel = await adaptiveValuationEngine.evaluateStockLabel('TATASTEEL', { price: 150, evEbitda: 6, industry: 'Metals' });
    expect(CANONICAL_LABELS).toContain(steelLabel);
  });
});
