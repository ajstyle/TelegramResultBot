/**
 * Data Validator & Calculation Helper Engine
 * Validates units, consolidated vs standalone filings, period (TTM vs Annual),
 * computes CAGR, CFO Conversion, FCF, detects missing values, and performs
 * proportional weight redistribution for missing metrics.
 */
class DataValidator {
  /**
   * Calculate Compound Annual Growth Rate (CAGR)
   * Formula: CAGR = (Ending Value / Beginning Value)^(1 / Years) - 1
   * @param {number} startVal Beginning period value
   * @param {number} endVal Ending period value
   * @param {number} years Number of years (3 or 5)
   * @returns {number|null} CAGR percentage (e.g. 15.4 for 15.4%) or null if invalid
   */
  calculateCAGR(startVal, endVal, years) {
    if (startVal === null || startVal === undefined || endVal === null || endVal === undefined || !years || years <= 0) {
      return null;
    }
    if (startVal <= 0 || endVal <= 0) {
      // Return percentage change fallback if base or ending is negative
      const simpleGrowth = ((endVal - startVal) / Math.abs(startVal)) * 100;
      return Math.round((simpleGrowth / years) * 10) / 10;
    }
    const cagr = (Math.pow(endVal / startVal, 1 / years) - 1) * 100;
    return Math.round(cagr * 10) / 10;
  }

  /**
   * Calculate CFO Conversion Rate (% of Net Profit converted to CFO)
   * Formula: CFO / PAT * 100
   * @param {number} cfo Cash Flow from Operations
   * @param {number} pat Net Profit (PAT)
   * @returns {number|null} Percentage or null
   */
  calculateCfoConversion(cfo, pat) {
    if (cfo === null || cfo === undefined || pat === null || pat === undefined || pat === 0) {
      return null;
    }
    const conversion = (cfo / pat) * 100;
    return Math.round(conversion * 10) / 10;
  }

  /**
   * Calculate Free Cash Flow (FCF)
   * Formula: CFO - Capex
   * @param {number} cfo Cash Flow from Operations
   * @param {number} capex Capital Expenditure
   * @returns {number|null}
   */
  calculateFCF(cfo, capex) {
    if (cfo === null || cfo === undefined) return null;
    const cleanCapex = Math.abs(capex || 0);
    return Math.round((cfo - cleanCapex) * 10) / 10;
  }

  /**
   * Validate and Normalize Financial Input Data Structure
   * @param {object} input Raw financial data dictionary
   * @returns {object} Validated, sanitized financial data
   */
  validateAndSanitize(input = {}) {
    const sanitizeNum = (val) => {
      if (val === null || val === undefined || val === '' || val === 'N/A' || val === '-') return null;
      const num = parseFloat(String(val).replace(/,/g, ''));
      return isNaN(num) ? null : num;
    };

    const isConsolidated = input.isConsolidated !== false; // Default: Consolidated preferred
    const period = input.period || 'TTM';
    const reportingUnit = input.reportingUnit || 'INR_CRORES'; // ₹ Crores

    return {
      symbol: (input.symbol || 'STOCK').toUpperCase().trim(),
      companyName: input.companyName || input.symbol || 'Stock',
      sector: input.sector || 'General',
      isConsolidated,
      period,
      reportingUnit,

      // Market & Fundamental Ratios
      cmp: sanitizeNum(input.cmp || input.price),
      marketCapCr: sanitizeNum(input.marketCapCr || input.marketCap),
      pe: sanitizeNum(input.pe),
      pb: sanitizeNum(input.pb),
      evEbitda: sanitizeNum(input.evEbitda),

      // Balance Sheet & Leverage
      totalDebt: sanitizeNum(input.totalDebt || input.debt),
      equity: sanitizeNum(input.equity || input.shareCapital),
      debtToEquity: sanitizeNum(input.debtToEquity),
      currentAssets: sanitizeNum(input.currentAssets),
      currentLiabilities: sanitizeNum(input.currentLiabilities),
      currentRatio: sanitizeNum(input.currentRatio),
      quickRatio: sanitizeNum(input.quickRatio),

      // Income Statement & Profitability
      sales: sanitizeNum(input.sales || input.revenue),
      ebit: sanitizeNum(input.ebit || input.operatingProfit),
      ebitda: sanitizeNum(input.ebitda),
      interestExpense: sanitizeNum(input.interestExpense || input.financeCosts),
      interestCoverage: sanitizeNum(input.interestCoverage),
      pat: sanitizeNum(input.pat || input.netProfit),
      eps: sanitizeNum(input.eps),
      roe: sanitizeNum(input.roe),
      roce: sanitizeNum(input.roce),
      opm: sanitizeNum(input.opm || input.ebitdaMargin),
      netMargin: sanitizeNum(input.netMargin || input.patMargin),

      // Cash Flow
      cfo: sanitizeNum(input.cfo || input.operatingCashFlow),
      capex: sanitizeNum(input.capex),
      fcf: sanitizeNum(input.fcf),

      // Working Capital
      inventoryDays: sanitizeNum(input.inventoryDays),
      receivableDays: sanitizeNum(input.receivableDays),
      payableDays: sanitizeNum(input.payableDays),
      cashConversionCycle: sanitizeNum(input.cashConversionCycle),

      // Historical Growth Metrics
      sales3Y: sanitizeNum(input.sales3Y),
      sales5Y: sanitizeNum(input.sales5Y),
      salesCagr3Y: sanitizeNum(input.salesCagr3Y),
      salesCagr5Y: sanitizeNum(input.salesCagr5Y),
      profit3Y: sanitizeNum(input.profit3Y),
      profit5Y: sanitizeNum(input.profit5Y),
      profitCagr3Y: sanitizeNum(input.profitCagr3Y),
      profitCagr5Y: sanitizeNum(input.profitCagr5Y),
      epsCagr3Y: sanitizeNum(input.epsCagr3Y),
      epsCagr5Y: sanitizeNum(input.epsCagr5Y),

      // Sector Specific Raw Metrics
      gnpa: sanitizeNum(input.gnpa),
      nnpa: sanitizeNum(input.nnpa),
      pcr: sanitizeNum(input.pcr),
      crar: sanitizeNum(input.crar),
      roa: sanitizeNum(input.roa),
      nim: sanitizeNum(input.nim),
      casa: sanitizeNum(input.casa),
      creditGrowth: sanitizeNum(input.creditGrowth),
      depositGrowth: sanitizeNum(input.depositGrowth),
      aumGrowth: sanitizeNum(input.aumGrowth),
      borrowingCost: sanitizeNum(input.borrowingCost),
      fcfMargin: sanitizeNum(input.fcfMargin),
      orderBookSales: sanitizeNum(input.orderBookSales),
      netDebtToEbitda: sanitizeNum(input.netDebtToEbitda),
      combinedRatio: sanitizeNum(input.combinedRatio),
      solvencyRatio: sanitizeNum(input.solvencyRatio),
      arpu: sanitizeNum(input.arpu),
      sssg: sanitizeNum(input.sssg),
      inventoryTurnover: sanitizeNum(input.inventoryTurnover),
    };
  }

  /**
   * Proportional Weight Redistribution Engine
   * Redistributes missing metric weights proportionally among available metrics.
   * @param {Array<{ key: string, weight: number, score: number|null }>} metrics List of scored metrics
   * @returns {{ finalCategoryScore: number, missingKeys: string[], weightMap: object }}
   */
  redistributeWeights(metrics = []) {
    const missingKeys = [];
    let availableTotalWeight = 0;
    let originalTotalWeight = 0;

    metrics.forEach((m) => {
      originalTotalWeight += m.weight;
      if (m.score !== null && m.score !== undefined) {
        availableTotalWeight += m.weight;
      } else {
        missingKeys.push(m.key);
      }
    });

    if (availableTotalWeight === 0) {
      return { finalCategoryScore: 50, missingKeys, weightMap: {} }; // Neutral fallback if all missing
    }

    let weightedSum = 0;
    const weightMap = {};

    metrics.forEach((m) => {
      if (m.score !== null && m.score !== undefined) {
        // Scaled Weight = Original Weight * (Original Category Total Weight / Available Weight)
        const adjustedWeight = m.weight * (originalTotalWeight / availableTotalWeight);
        weightMap[m.key] = Math.round(adjustedWeight * 100) / 100;
        weightedSum += m.score * adjustedWeight;
      } else {
        weightMap[m.key] = 0;
      }
    });

    const finalCategoryScore = Math.round((weightedSum / originalTotalWeight) * 10) / 10;
    return { finalCategoryScore: Math.max(0, Math.min(100, finalCategoryScore)), missingKeys, weightMap };
  }
}

module.exports = new DataValidator();
