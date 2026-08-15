/**
 * Sector Registry & KPI Benchmark Engine for Indian Equities (NSE/BSE)
 * Defines benchmark models, metrics, formulas, and weights for 14 supported sectors:
 * 1. Bank
 * 2. NBFC
 * 3. IT / Software
 * 4. FMCG
 * 5. Pharma
 * 6. Auto
 * 7. Capital Goods / Engineering
 * 8. Real Estate
 * 9. Power / Utility
 * 10. Telecom
 * 11. Oil & Gas / Commodity
 * 12. Consumer / Retail
 * 13. Insurance
 * 14. Other
 */
class SectorRegistry {
  constructor() {
    this.sectors = {
      BANK: {
        id: 'BANK',
        name: 'Banking',
        overrideUniversalDebt: true, // Do NOT use normal Debt-to-Equity scoring for Banks
        kpis: [
          { key: 'gnpa', name: 'Gross NPA Ratio (%)', target: '<3%', weight: 2.0 },
          { key: 'nnpa', name: 'Net NPA Ratio (%)', target: '<1%', weight: 2.0 },
          { key: 'pcr', name: 'Provision Coverage Ratio (%)', target: '>70%', weight: 1.5 },
          { key: 'crar', name: 'Capital Adequacy (CRAR) (%)', target: '>15%', weight: 1.5 },
          { key: 'roa', name: 'Return on Assets (ROA) (%)', target: '>1.0%', weight: 2.0 },
          { key: 'nim', name: 'Net Interest Margin (NIM) (%)', target: '>3.0%', weight: 1.5 },
          { key: 'casa', name: 'CASA Ratio (%)', target: '>35%', weight: 1.5 },
          { key: 'creditGrowth', name: 'Credit Growth YoY (%)', target: '>12%', weight: 1.5 },
          { key: 'depositGrowth', name: 'Deposit Growth YoY (%)', target: '>10%', weight: 1.5 },
        ],
      },

      NBFC: {
        id: 'NBFC',
        name: 'NBFC / Financial Services',
        overrideUniversalDebt: true, // Do NOT use normal Debt-to-Equity scoring for NBFCs
        kpis: [
          { key: 'gnpa', name: 'Gross NPA Ratio (%)', target: '<3.5%', weight: 2.0 },
          { key: 'nnpa', name: 'Net NPA Ratio (%)', target: '<1.5%', weight: 2.0 },
          { key: 'aumGrowth', name: 'AUM Growth YoY (%)', target: '>15%', weight: 2.0 },
          { key: 'nim', name: 'Net Interest Margin (NIM) (%)', target: '>5.0%', weight: 1.5 },
          { key: 'creditCost', name: 'Credit Cost (%)', target: '<1.5%', weight: 1.5 },
          { key: 'crar', name: 'Capital Adequacy (%)', target: '>18%', weight: 1.5 },
          { key: 'borrowingCost', name: 'Cost of Borrowing (%)', target: 'Lower / Stable', weight: 1.5 },
          { key: 'roa', name: 'ROA (%)', target: '>2.0%', weight: 1.5 },
          { key: 'stage3', name: 'Stage 3 Assets (%)', target: '<3.0%', weight: 1.5 },
        ],
      },

      IT: {
        id: 'IT',
        name: 'IT / Software Services',
        overrideUniversalDebt: false,
        kpis: [
          { key: 'debtToEquity', name: 'Debt to Equity', target: '<0.1 (Near Zero)', weight: 2.5 },
          { key: 'fcfMargin', name: 'FCF Margin (%)', target: '>15%', weight: 2.5 },
          { key: 'ebitMargin', name: 'EBIT Margin (%)', target: '>18%', weight: 2.5 },
          { key: 'roe', name: 'ROE (%)', target: '>20%', weight: 2.5 },
          { key: 'attrition', name: 'Attrition Rate (%)', target: '<14%', weight: 2.5 },
          { key: 'utilisation', name: 'Utilisation Rate (%)', target: '>82%', weight: 2.5 },
        ],
      },

      FMCG: {
        id: 'FMCG',
        name: 'FMCG / Consumer Staples',
        overrideUniversalDebt: false,
        kpis: [
          { key: 'roce', name: 'ROCE (%)', target: '>20%', weight: 3.0 },
          { key: 'ebitdaMargin', name: 'EBITDA Margin (%)', target: '>18%', weight: 3.0 },
          { key: 'fcfPositive', name: 'Positive FCF', target: 'Consistently Positive', weight: 3.0 },
          { key: 'inventoryDays', name: 'Inventory Days', target: '<60 Days', weight: 3.0 },
          { key: 'volumeGrowth', name: 'Volume Growth (%)', target: '>5%', weight: 3.0 },
        ],
      },

      PHARMA: {
        id: 'PHARMA',
        name: 'Pharmaceuticals & Healthcare',
        overrideUniversalDebt: false,
        kpis: [
          { key: 'roce', name: 'ROCE (%)', target: '>15%', weight: 3.0 },
          { key: 'rndPercent', name: 'R&D Expense (% of Sales)', target: '6% - 12%', weight: 3.0 },
          { key: 'ebitdaMargin', name: 'EBITDA Margin (%)', target: '>20%', weight: 3.0 },
          { key: 'fcfPositive', name: 'Positive FCF', target: 'Consistently Positive', weight: 3.0 },
          { key: 'debtToEquity', name: 'Debt to Equity', target: '<0.5', weight: 3.0 },
        ],
      },

      AUTO: {
        id: 'AUTO',
        name: 'Automobiles & Auto Components',
        overrideUniversalDebt: false,
        kpis: [
          { key: 'debtToEquity', name: 'Debt to Equity', target: '<0.5', weight: 3.0 },
          { key: 'roce', name: 'ROCE (%)', target: '>15%', weight: 3.0 },
          { key: 'ebitdaMargin', name: 'EBITDA Margin (%)', target: '>12%', weight: 3.0 },
          { key: 'volumeGrowth', name: 'Vehicle Volume Growth (%)', target: '>8%', weight: 3.0 },
          { key: 'fcfPositive', name: 'Positive FCF', target: 'Consistently Positive', weight: 3.0 },
        ],
      },

      CAPITAL_GOODS: {
        id: 'CAPITAL_GOODS',
        name: 'Capital Goods / Engineering',
        overrideUniversalDebt: false,
        kpis: [
          { key: 'orderBookSales', name: 'Order Book / Sales', target: '>2.0x', weight: 3.0 },
          { key: 'orderInflowGrowth', name: 'Order Inflow Growth (%)', target: '>12%', weight: 3.0 },
          { key: 'receivableDays', name: 'Receivable Days', target: '<90 Days', weight: 3.0 },
          { key: 'cfoToPat', name: 'CFO / PAT (%)', target: '>80%', weight: 3.0 },
          { key: 'roce', name: 'ROCE (%)', target: '>14%', weight: 3.0 },
        ],
      },

      REAL_ESTATE: {
        id: 'REAL_ESTATE',
        name: 'Real Estate / Property',
        overrideUniversalDebt: false,
        kpis: [
          { key: 'netDebtToEbitda', name: 'Net Debt / EBITDA', target: '<2.5x', weight: 3.0 },
          { key: 'preSalesGrowth', name: 'Pre-Sales Growth YoY (%)', target: '>15%', weight: 3.0 },
          { key: 'collections', name: 'Collection Efficiency (%)', target: '>80%', weight: 3.0 },
          { key: 'interestCoverage', name: 'Interest Coverage', target: '>2.5x', weight: 3.0 },
          { key: 'debtToEquity', name: 'Debt to Equity', target: '<0.8', weight: 3.0 },
        ],
      },

      POWER: {
        id: 'POWER',
        name: 'Power / Utilities',
        overrideUniversalDebt: false,
        kpis: [
          { key: 'debtToEbitda', name: 'Debt / EBITDA', target: '<3.5x', weight: 3.0 },
          { key: 'interestCoverage', name: 'Interest Coverage', target: '>2.5x', weight: 3.0 },
          { key: 'plr', name: 'Capacity Utilisation / PLF (%)', target: '>65%', weight: 3.0 },
          { key: 'ebitdaMargin', name: 'EBITDA Margin (%)', target: '>25%', weight: 3.0 },
          { key: 'fcf', name: 'FCF / Capex Ratio', target: 'Healthy Cash Conversion', weight: 3.0 },
        ],
      },

      TELECOM: {
        id: 'TELECOM',
        name: 'Telecommunications',
        overrideUniversalDebt: false,
        kpis: [
          { key: 'netDebtToEbitda', name: 'Net Debt / EBITDA', target: '<2.5x (Improving)', weight: 3.0 },
          { key: 'arpu', name: 'ARPU Growth YoY (%)', target: '>8%', weight: 3.0 },
          { key: 'subGrowth', name: 'Subscriber Growth (%)', target: '>4%', weight: 3.0 },
          { key: 'ebitdaMargin', name: 'EBITDA Margin (%)', target: '>45%', weight: 3.0 },
          { key: 'cfoToCapex', name: 'CFO / Capex Ratio', target: '>1.0x', weight: 3.0 },
        ],
      },

      COMMODITY: {
        id: 'COMMODITY',
        name: 'Oil & Gas / Metals & Commodities',
        overrideUniversalDebt: false,
        kpis: [
          { key: 'debtToEbitda', name: 'Debt / EBITDA', target: '<2.0x', weight: 3.0 },
          { key: 'multiYearEarning', name: 'Multi-Year Cycle Stability', target: 'Evaluated across 3-5Y', weight: 3.0 },
          { key: 'fcfYield', name: 'FCF Yield (%)', target: '>8%', weight: 3.0 },
          { key: 'realisation', name: 'Realisation / Margin', target: 'Above Sector Median', weight: 3.0 },
          { key: 'debtToEquity', name: 'Debt to Equity', target: '<0.6', weight: 3.0 },
        ],
      },

      RETAIL: {
        id: 'RETAIL',
        name: 'Consumer / Retail',
        overrideUniversalDebt: false,
        kpis: [
          { key: 'sssg', name: 'Same Store Sales Growth (SSSG) (%)', target: '>8%', weight: 3.0 },
          { key: 'inventoryTurnover', name: 'Inventory Turnover', target: '>6.0x', weight: 3.0 },
          { key: 'roce', name: 'ROCE (%)', target: '>15%', weight: 3.0 },
          { key: 'ebitdaMargin', name: 'EBITDA Margin (%)', target: '>12%', weight: 3.0 },
          { key: 'fcf', name: 'Positive FCF', target: 'Consistently Positive', weight: 3.0 },
        ],
      },

      INSURANCE: {
        id: 'INSURANCE',
        name: 'Insurance',
        overrideUniversalDebt: true, // Do NOT apply D/E to Insurance
        kpis: [
          { key: 'combinedRatio', name: 'Combined Ratio (%)', target: '<100%', weight: 3.0 },
          { key: 'solvencyRatio', name: 'Solvency Ratio (%)', target: '>150%', weight: 3.0 },
          { key: 'vnbMargin', name: 'VNB Margin (%)', target: '>20%', weight: 3.0 },
          { key: 'claimRatio', name: 'Claim Ratio (%)', target: '<75%', weight: 3.0 },
          { key: 'roe', name: 'ROE (%)', target: '>14%', weight: 3.0 },
        ],
      },

      OTHER: {
        id: 'OTHER',
        name: 'Other Sector',
        overrideUniversalDebt: false,
        kpis: [],
        notice: 'Sector-specific score unavailable — Universal Financial Health Score used.',
      },
    };
  }

  /**
   * Detect and map sector string to normalized Sector Model ID
   * @param {string} rawSector Input sector string from Screener / BSE / NSE
   * @param {string} symbol Stock ticker
   * @returns {object} Sector configuration object
   */
  detectSector(rawSector = '', symbol = '') {
    const s = (rawSector || '').toLowerCase().trim();
    const sym = (symbol || '').toUpperCase().trim();

    // Symbol-based overrides for major financial/IT institutions
    if (['HDFCBANK', 'ICICIBANK', 'SBIN', 'AXISBANK', 'KOTAKBANK', 'INDUSINDBK', 'BANKBARODA', 'PNB'].includes(sym)) {
      return this.sectors.BANK;
    }
    if (['BAJFINANCE', 'BAJAJFINSV', 'CHOLAFIN', 'SHRIRAMFIN', 'MUTHOOTFIN', 'POONAWALLA', 'M&MFIN', 'LICHSGFIN'].includes(sym)) {
      return this.sectors.NBFC;
    }
    if (['TCS', 'INFY', 'WIPRO', 'HCLTECH', 'LTIM', 'TECHM', 'PERSISTENT', 'COFORGE', 'KPITTECH', 'MPHASIS'].includes(sym)) {
      return this.sectors.IT;
    }

    if (s.includes('bank') && !s.includes('nbfc')) return this.sectors.BANK;
    if (s.includes('nbfc') || s.includes('finance') || s.includes('housing finance') || s.includes('microfinance')) return this.sectors.NBFC;
    if (s.includes('it') || s.includes('software') || s.includes('computers') || s.includes('technology')) return this.sectors.IT;
    if (s.includes('fmcg') || s.includes('personal care') || s.includes('food') || s.includes('beverage') || s.includes('tobacco')) return this.sectors.FMCG;
    if (s.includes('pharma') || s.includes('drug') || s.includes('healthcare') || s.includes('hospital') || s.includes('diagnostic')) return this.sectors.PHARMA;
    if (s.includes('auto') || s.includes('car') || s.includes('vehicle') || s.includes('tyre') || s.includes('tractor')) return this.sectors.AUTO;
    if (s.includes('capital goods') || s.includes('engineering') || s.includes('infrastructure') || s.includes('construction') || s.includes('machinery')) return this.sectors.CAPITAL_GOODS;
    if (s.includes('real estate') || s.includes('realty') || s.includes('property') || s.includes('housing')) return this.sectors.REAL_ESTATE;
    if (s.includes('power') || s.includes('utility') || s.includes('electricity') || s.includes('energy') || s.includes('renewable')) return this.sectors.POWER;
    if (s.includes('telecom') || s.includes('communication') || s.includes('mobile')) return this.sectors.TELECOM;
    if (s.includes('oil') || s.includes('gas') || s.includes('refinery') || s.includes('steel') || s.includes('metal') || s.includes('mining') || s.includes('commodity')) return this.sectors.COMMODITY;
    if (s.includes('retail') || s.includes('consumer durables') || s.includes('apparel') || s.includes('textile') || s.includes('e-commerce')) return this.sectors.RETAIL;
    if (s.includes('insurance') || s.includes('life insurance') || s.includes('general insurance')) return this.sectors.INSURANCE;

    return this.sectors.OTHER;
  }
}

module.exports = new SectorRegistry();
