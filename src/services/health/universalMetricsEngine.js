const dataValidator = require('./dataValidator');

/**
 * Universal Financial Health Metrics Engine
 * Calculates individual component scores (0-100) for universal parameters:
 * 1. Debt / Leverage (20 points)
 * 2. Cash Flow (20 points)
 * 3. Profitability (20 points)
 * 4. Liquidity (10 points)
 * 5. Growth (15 points)
 */
class UniversalMetricsEngine {
  /**
   * Evaluate Debt & Leverage Component (20 points)
   * Formula: Debt-to-Equity = Total Debt / Shareholders Equity
   * Interest Coverage = EBIT / Interest Expense
   * Guidelines: <0.5 Excellent, 0.5-1 Good, 1-2 Average, >2 Risky
   * Note: Skipped/Overridden for Banks & NBFCs
   */
  evaluateDebt(data, isBankOrNbfc = false) {
    if (isBankOrNbfc) {
      return { score: 100, weight: 20, isSkipped: true, reason: 'Overridden for Banking/NBFC sector model' };
    }

    let deScore = null;
    let de = data.debtToEquity;
    if (de === null && data.totalDebt !== null && data.equity !== null && data.equity > 0) {
      de = Math.round((data.totalDebt / data.equity) * 100) / 100;
    }

    if (de !== null) {
      if (de <= 0.1) deScore = 100; // Near Zero Debt
      else if (de < 0.5) deScore = 90; // Excellent
      else if (de <= 1.0) deScore = 70; // Good
      else if (de <= 2.0) deScore = 45; // Average
      else if (de <= 3.0) deScore = 20; // Risky
      else deScore = 0; // High Risk
    }

    let icScore = null;
    let ic = data.interestCoverage;
    if (ic === null && data.ebit !== null && data.interestExpense !== null && data.interestExpense > 0) {
      ic = Math.round((data.ebit / data.interestExpense) * 10) / 10;
    }

    if (ic !== null) {
      if (ic >= 5.0) icScore = 100; // Strong
      else if (ic >= 3.0) icScore = 75; // Good
      else if (ic >= 1.5) icScore = 40; // Risk
      else icScore = 10; // High Risk (<1.5)
    }

    const metrics = [
      { key: 'debtToEquity', weight: 12, score: deScore },
      { key: 'interestCoverage', weight: 8, score: icScore },
    ];

    const { finalCategoryScore, missingKeys } = dataValidator.redistributeWeights(metrics);
    return {
      score: finalCategoryScore,
      weight: 20,
      deValue: de,
      icValue: ic,
      missingKeys,
    };
  }

  /**
   * Evaluate Liquidity Component (10 points)
   * Guidelines: Current Ratio >1.5 Strong, 1-1.5 Acceptable, <1 Weak
   */
  evaluateLiquidity(data, isBankOrNbfc = false) {
    if (isBankOrNbfc) {
      return { score: 100, weight: 10, isSkipped: true, reason: 'Overridden for Banking/NBFC sector model' };
    }

    let crScore = null;
    let cr = data.currentRatio;
    if (cr === null && data.currentAssets !== null && data.currentLiabilities !== null && data.currentLiabilities > 0) {
      cr = Math.round((data.currentAssets / data.currentLiabilities) * 100) / 100;
    }

    if (cr !== null) {
      if (cr >= 2.0) crScore = 100;
      else if (cr >= 1.5) crScore = 85;
      else if (cr >= 1.0) crScore = 55;
      else if (cr >= 0.8) crScore = 30;
      else crScore = 10;
    }

    let qrScore = null;
    const qr = data.quickRatio;
    if (qr !== null) {
      if (qr >= 1.2) qrScore = 100;
      else if (qr >= 1.0) qrScore = 80;
      else if (qr >= 0.7) qrScore = 50;
      else qrScore = 20;
    }

    const metrics = [
      { key: 'currentRatio', weight: 7, score: crScore },
      { key: 'quickRatio', weight: 3, score: qrScore },
    ];

    const { finalCategoryScore, missingKeys } = dataValidator.redistributeWeights(metrics);
    return {
      score: finalCategoryScore,
      weight: 10,
      crValue: cr,
      qrValue: qr,
      missingKeys,
    };
  }

  /**
   * Evaluate Profitability Component (20 points)
   * ROE >15% Strong, ROCE >15-20% Strong
   */
  evaluateProfitability(data) {
    const isNetLoss = data.pat !== null && data.pat < 0;

    let roeScore = null;
    const roe = data.roe;
    if (roe !== null) {
      if (isNetLoss || roe <= 0) roeScore = 10;
      else if (roe >= 25) roeScore = 100;
      else if (roe >= 18) roeScore = 85;
      else if (roe >= 15) roeScore = 70;
      else if (roe >= 10) roeScore = 45;
      else roeScore = 25;
    }

    let roceScore = null;
    const roce = data.roce;
    if (roce !== null) {
      if (isNetLoss || roce <= 0) roceScore = 10;
      else if (roce >= 25) roceScore = 100;
      else if (roce >= 20) roceScore = 90;
      else if (roce >= 15) roceScore = 70;
      else if (roce >= 10) roceScore = 45;
      else roceScore = 25;
    }

    let marginScore = null;
    const opm = data.opm;
    if (opm !== null) {
      if (opm < 0) marginScore = 10;
      else if (opm >= 25) marginScore = 100;
      else if (opm >= 18) marginScore = 80;
      else if (opm >= 10) marginScore = 60;
      else marginScore = 30;
    }

    const metrics = [
      { key: 'roe', weight: 8, score: roeScore },
      { key: 'roce', weight: 8, score: roceScore },
      { key: 'opm', weight: 4, score: marginScore },
    ];

    const { finalCategoryScore, missingKeys } = dataValidator.redistributeWeights(metrics);
    return {
      score: finalCategoryScore,
      weight: 20,
      roeValue: roe,
      roceValue: roce,
      opmValue: opm,
      isNetLoss,
      missingKeys,
    };
  }

  /**
   * Evaluate Cash Flow Component (20 points)
   * CFO, FCF = CFO - Capex, CFO/PAT Earnings Quality Ratio
   */
  evaluateCashFlow(data) {
    let cfoScore = null;
    const cfo = data.cfo;
    if (cfo !== null) {
      if (cfo > 0) cfoScore = 90;
      else if (cfo === 0) cfoScore = 40;
      else cfoScore = 10; // Negative CFO Risk
    }

    let fcfScore = null;
    let fcf = data.fcf;
    if (fcf === null && cfo !== null) {
      fcf = dataValidator.calculateFCF(cfo, data.capex);
    }
    if (fcf !== null) {
      if (fcf > 0) fcfScore = 100;
      else if (fcf === 0) fcfScore = 50;
      else fcfScore = 15;
    }

    let cfoConvScore = null;
    const cfoConv = dataValidator.calculateCfoConversion(cfo, data.pat);
    if (cfoConv !== null) {
      if (cfoConv >= 100) cfoConvScore = 100; // Strong Earnings Quality
      else if (cfoConv >= 80) cfoConvScore = 80;
      else if (cfoConv >= 50) cfoConvScore = 50;
      else if (cfoConv >= 0) cfoConvScore = 30;
      else cfoConvScore = 0; // Negative CFO despite Profit = High Risk Flag
    }

    const metrics = [
      { key: 'cfo', weight: 8, score: cfoScore },
      { key: 'fcf', weight: 7, score: fcfScore },
      { key: 'cfoConversion', weight: 5, score: cfoConvScore },
    ];

    const { finalCategoryScore, missingKeys } = dataValidator.redistributeWeights(metrics);
    return {
      score: finalCategoryScore,
      weight: 20,
      cfoValue: cfo,
      fcfValue: fcf,
      cfoConversion: cfoConv,
      missingKeys,
    };
  }

  /**
   * Evaluate Growth Component (15 points)
   * Sales CAGR 3Y/5Y, Profit CAGR 3Y/5Y, EPS CAGR
   */
  evaluateGrowth(data) {
    const salesCagr = data.salesCagr3Y !== null ? data.salesCagr3Y : (data.salesCagr5Y !== null ? data.salesCagr5Y : dataValidator.calculateCAGR(data.sales3Y, data.sales, 3));
    const profitCagr = data.profitCagr3Y !== null ? data.profitCagr3Y : (data.profitCagr5Y !== null ? data.profitCagr5Y : dataValidator.calculateCAGR(data.profit3Y, data.pat, 3));
    const epsCagr = data.epsCagr3Y !== null ? data.epsCagr3Y : data.epsCagr5Y;

    let sScore = null;
    if (salesCagr !== null) {
      if (salesCagr >= 20) sScore = 100;
      else if (salesCagr >= 12) sScore = 80;
      else if (salesCagr >= 5) sScore = 55;
      else if (salesCagr >= 0) sScore = 35;
      else sScore = 15;
    }

    let pScore = null;
    if (profitCagr !== null) {
      if (profitCagr >= 25) pScore = 100;
      else if (profitCagr >= 15) pScore = 80;
      else if (profitCagr >= 8) pScore = 55;
      else if (profitCagr >= 0) pScore = 35;
      else pScore = 10;
    }

    let eScore = null;
    if (epsCagr !== null) {
      if (epsCagr >= 20) eScore = 100;
      else if (epsCagr >= 10) eScore = 75;
      else if (epsCagr >= 0) eScore = 45;
      else eScore = 15;
    }

    const metrics = [
      { key: 'salesCagr', weight: 6, score: sScore },
      { key: 'profitCagr', weight: 6, score: pScore },
      { key: 'epsCagr', weight: 3, score: eScore },
    ];

    const { finalCategoryScore, missingKeys } = dataValidator.redistributeWeights(metrics);
    return {
      score: finalCategoryScore,
      weight: 15,
      salesCagr,
      profitCagr,
      epsCagr,
      missingKeys,
    };
  }
}

module.exports = new UniversalMetricsEngine();
