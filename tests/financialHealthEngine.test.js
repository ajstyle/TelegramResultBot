const healthScoringEngine = require('../src/services/health/healthScoringEngine');
const modularStockAnalyzer = require('../src/services/health/modularStockAnalyzer');
const sectorRegistry = require('../src/services/health/sectorRegistry');
const dataValidator = require('../src/services/health/dataValidator');

describe('Sector-Specific Stock Financial Health Analyzer Test Suite', () => {
  // 1. Sector Identification Tests
  describe('Sector Identification Engine', () => {
    test('identifies HDFCBANK as BANK sector', () => {
      const sec = sectorRegistry.detectSector('Banking', 'HDFCBANK');
      expect(sec.id).toBe('BANK');
      expect(sec.overrideUniversalDebt).toBe(true);
    });

    test('identifies BAJFINANCE as NBFC sector', () => {
      const sec = sectorRegistry.detectSector('Finance', 'BAJFINANCE');
      expect(sec.id).toBe('NBFC');
      expect(sec.overrideUniversalDebt).toBe(true);
    });

    test('identifies TCS as IT sector', () => {
      const sec = sectorRegistry.detectSector('IT Services', 'TCS');
      expect(sec.id).toBe('IT');
      expect(sec.overrideUniversalDebt).toBe(false);
    });

    test('identifies HINDUNILVR as FMCG sector', () => {
      const sec = sectorRegistry.detectSector('FMCG / Personal Care', 'HINDUNILVR');
      expect(sec.id).toBe('FMCG');
    });

    test('defaults unknown sector to OTHER model with notice', () => {
      const sec = sectorRegistry.detectSector('Space Tourism', 'UNKNOWN');
      expect(sec.id).toBe('OTHER');
    });
  });

  // 2. Data Validator & Formulas Tests
  describe('Data Validator & Formula Calculations', () => {
    test('calculates 3Y CAGR accurately', () => {
      const cagr = dataValidator.calculateCAGR(100, 172.8, 3);
      expect(cagr).toBe(20.0);
    });

    test('calculates CFO Conversion (% of PAT) accurately', () => {
      const conv = dataValidator.calculateCfoConversion(120, 100);
      expect(conv).toBe(120.0);
    });

    test('calculates Free Cash Flow (CFO - Capex) accurately', () => {
      const fcf = dataValidator.calculateFCF(200, 50);
      expect(fcf).toBe(150);
    });

    test('handles missing metrics with proportional weight redistribution', () => {
      const metrics = [
        { key: 'm1', weight: 10, score: 80 },
        { key: 'm2', weight: 10, score: null }, // Missing
      ];
      const result = dataValidator.redistributeWeights(metrics);
      expect(result.finalCategoryScore).toBe(80);
      expect(result.missingKeys).toContain('m2');
    });
  });

  // 3. Health Scoring & Rating Tests
  describe('Health Scoring Engine & Rating Classification', () => {
    test('classifies score 85 as Excellent Financial Health', () => {
      const result = healthScoringEngine.classifyRating(85);
      expect(result.rating).toBe('Excellent');
    });

    test('classifies score 72 as Strong Financial Health', () => {
      const result = healthScoringEngine.classifyRating(72);
      expect(result.rating).toBe('Strong');
    });

    test('classifies score 55 as Average Financial Health', () => {
      const result = healthScoringEngine.classifyRating(55);
      expect(result.rating).toBe('Average');
    });

    test('classifies score 40 as Weak Financial Health', () => {
      const result = healthScoringEngine.classifyRating(40);
      expect(result.rating).toBe('Weak');
    });

    test('classifies score 25 as Risky Financial Health', () => {
      const result = healthScoringEngine.classifyRating(25);
      expect(result.rating).toBe('Risky');
    });
  });

  // 4. Full Stock Analysis & Sector Model Verification
  describe('Full Stock Analysis Across Sectors', () => {
    test('evaluates TCS (IT Sector) with high score & green flags', () => {
      const input = {
        symbol: 'TCS',
        sector: 'IT Services',
        cmp: 3800,
        debtToEquity: 0.02,
        roe: 38,
        roce: 48,
        currentRatio: 2.2,
        interestCoverage: 80,
        cfo: 42000,
        pat: 40000,
        capex: 3000,
        fcfMargin: 22,
        ebitMargin: 25,
        attrition: 12,
        utilisation: 85,
        salesCagr3Y: 14,
        profitCagr3Y: 15,
      };

      const result = healthScoringEngine.analyze(input);
      expect(result.financialHealthScore).toBeGreaterThanOrEqual(75);
      expect(result.rating).toMatch(/Excellent|Strong/);
      expect(result.sectorId).toBe('IT');
      expect(result.categoryScores.debtHealth).toBe(100);
      expect(result.conclusion).toBe('Financially Strong');
    });

    test('evaluates HDFCBANK (Bank Sector) skipping normal D/E and using GNPA/NIM', () => {
      const input = {
        symbol: 'HDFCBANK',
        sector: 'Banking',
        gnpa: 1.2,
        nnpa: 0.33,
        pcr: 75,
        crar: 19.5,
        roa: 1.9,
        nim: 4.1,
        casa: 42,
        creditGrowth: 15,
        roe: 17,
        cfo: 50000,
        pat: 45000,
      };

      const result = healthScoringEngine.analyze(input);
      expect(result.sectorId).toBe('BANK');
      expect(result.financialHealthScore).toBeGreaterThanOrEqual(75);
      expect(result.sectorKPIs.length).toBeGreaterThan(0);
    });

    test('evaluates loss-making company as Risky with Red Quality Flags', () => {
      const input = {
        symbol: 'RISKYSTK',
        sector: 'General',
        pat: -50,
        cfo: -20,
        debtToEquity: 3.5,
        interestCoverage: 0.8,
        roe: -15,
        roce: -10,
      };

      const result = healthScoringEngine.analyze(input);
      expect(result.financialHealthScore).toBeLessThan(40);
      expect(result.rating).toMatch(/Weak|Risky/);
      expect(result.riskLevel).toBe('High Risk');
      expect(result.warningSignals.length).toBeGreaterThan(0);
    });
  });

  // 5. Decoupling Test (Valuation vs Financial Health)
  describe('Decoupled Modular Stock Analyzer', () => {
    test('ensures changing P/E multiple does NOT alter Financial Health Score', () => {
      const baseInput = {
        symbol: 'DECOUPLE_TEST',
        sector: 'IT',
        debtToEquity: 0.1,
        roe: 25,
        roce: 30,
        cfo: 100,
        pat: 90,
      };

      const cheapStock = modularStockAnalyzer.analyzeStock({ ...baseInput, pe: 10 });
      const expensiveStock = modularStockAnalyzer.analyzeStock({ ...baseInput, pe: 90 });

      // Financial Health Score must be IDENTICAL regardless of P/E valuation!
      expect(cheapStock.modules.financialHealth.financialHealthScore).toBe(
        expensiveStock.modules.financialHealth.financialHealthScore
      );

      // Valuation Module scores will differ correctly
      expect(cheapStock.modules.valuation.score).toBeGreaterThan(expensiveStock.modules.valuation.score);
    });
  });
});
