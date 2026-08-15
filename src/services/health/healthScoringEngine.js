const sectorRegistry = require('./sectorRegistry');
const dataValidator = require('./dataValidator');
const universalMetricsEngine = require('./universalMetricsEngine');
const sectorScoringEngine = require('./sectorScoringEngine');

/**
 * Master Financial Health Scoring & Analysis Engine
 * Synthesizes Universal Financial Health Parameters (85 pts) + Sector Specific KPIs (15 pts)
 * into a final Financial Health Score out of 100.
 *
 * RATING CLASSIFICATION:
 * 80–100 = Excellent Financial Health
 * 65–79  = Strong Financial Health
 * 50–64  = Average Financial Health
 * 35–49  = Weak Financial Health
 * 0–34   = Risky Financial Health
 */
class HealthScoringEngine {
  /**
   * Main Entry Point: Analyze stock financial health
   * @param {object} input Raw financial data input
   * @returns {object} Comprehensive Financial Health Dashboard Payload
   */
  analyze(input = {}) {
    const data = dataValidator.validateAndSanitize(input);

    // 1. Sector Identification
    const sectorConfig = sectorRegistry.detectSector(data.sector, data.symbol);
    const isBankOrNbfc = sectorConfig.overrideUniversalDebt;

    // 2. Evaluate Universal Parameters
    const debtEval = universalMetricsEngine.evaluateDebt(data, isBankOrNbfc);
    const liqEval = universalMetricsEngine.evaluateLiquidity(data, isBankOrNbfc);
    const profEval = universalMetricsEngine.evaluateProfitability(data);
    const cfoEval = universalMetricsEngine.evaluateCashFlow(data);
    const growthEval = universalMetricsEngine.evaluateGrowth(data);

    // 3. Evaluate Sector-Specific Parameters (15 pts)
    const sectorKpiEval = sectorScoringEngine.evaluateSectorKPIs(data, sectorConfig);

    // 4. Weighted Score Calculation
    // Normal Universe (Non-Bank): Debt 20, CashFlow 20, Profit 20, Liquidity 10, Growth 15, Sector 15 = 100 pts
    // Bank/NBFC Universe: Debt & Liquidity skipped. Weight redistributed to Sector KPIs (45 pts) & Cash/Profit/Growth (55 pts)
    let totalScore = 0;
    let categoryScores = {};

    if (isBankOrNbfc) {
      categoryScores = {
        debt: { score: 100, weight: 0, isSkipped: true },
        liquidity: { score: 100, weight: 0, isSkipped: true },
        profitability: { score: profEval.score, weight: 25 },
        cashFlow: { score: cfoEval.score, weight: 25 },
        growth: { score: growthEval.score, weight: 20 },
        sectorKpis: { score: sectorKpiEval.score, weight: 30 },
      };

      totalScore =
        profEval.score * 0.25 +
        cfoEval.score * 0.25 +
        growthEval.score * 0.20 +
        sectorKpiEval.score * 0.30;
    } else {
      categoryScores = {
        debt: { score: debtEval.score, weight: 20 },
        liquidity: { score: liqEval.score, weight: 10 },
        profitability: { score: profEval.score, weight: 20 },
        cashFlow: { score: cfoEval.score, weight: 20 },
        growth: { score: growthEval.score, weight: 15 },
        sectorKpis: { score: sectorKpiEval.score, weight: 15 },
      };

      totalScore =
        debtEval.score * 0.20 +
        liqEval.score * 0.10 +
        profEval.score * 0.20 +
        cfoEval.score * 0.20 +
        growthEval.score * 0.15 +
        sectorKpiEval.score * 0.15;
    }

    const financialHealthScore = Math.round(totalScore * 10) / 10;
    const ratingInfo = this.classifyRating(financialHealthScore);

    // 5. Quality Flags (GREEN, YELLOW, RED)
    const qualityFlags = this.evaluateQualityFlags(data, debtEval, profEval, cfoEval, sectorKpiEval);

    // 6. Warning Signals Detection
    const warningSignals = this.detectWarningSignals(data, debtEval, profEval, cfoEval, growthEval);

    // 7. "Why This Score?" Audit Section
    const whyThisScore = this.generateWhyThisScore(data, debtEval, liqEval, profEval, cfoEval, growthEval, sectorKpiEval, qualityFlags);

    // 8. Overall Conclusion
    const conclusion = this.generateConclusion(financialHealthScore, qualityFlags.riskLevel);

    return {
      symbol: data.symbol,
      companyName: data.companyName,
      sector: sectorConfig.name,
      sectorId: sectorConfig.id,
      marketCapCr: data.marketCapCr,
      cmp: data.cmp,
      isConsolidated: data.isConsolidated,
      period: data.period,

      financialHealthScore,
      rating: ratingInfo.rating,
      ratingDescription: ratingInfo.description,
      riskLevel: qualityFlags.riskLevel,

      categoryScores: {
        debtHealth: Math.round(categoryScores.debt.score),
        liquidityHealth: Math.round(categoryScores.liquidity.score),
        profitabilityHealth: Math.round(categoryScores.profitability.score),
        cashFlowHealth: Math.round(categoryScores.cashFlow.score),
        growthHealth: Math.round(categoryScores.growth.score),
        sectorHealth: Math.round(categoryScores.sectorKpis.score),
      },

      keyMetrics: {
        roe: data.roe,
        roce: data.roce,
        debtToEquity: debtEval.deValue,
        currentRatio: liqEval.crValue,
        interestCoverage: debtEval.icValue,
        salesGrowth: growthEval.salesCagr,
        profitGrowth: growthEval.profitCagr,
        cfo: cfoEval.cfoValue,
        fcf: cfoEval.fcfValue,
        cfoToPatRatio: cfoEval.cfoConversion,
        operatingMargin: profEval.opmValue,
        netMargin: data.netMargin,
        workingCapitalDays: data.cashConversionCycle,
      },

      sectorKPIs: sectorKpiEval.kpiBreakdown,
      qualityFlags: qualityFlags.flags,
      warningSignals,
      whyThisScore,
      topStrengths: whyThisScore.positiveFactors,
      topRisks: whyThisScore.negativeFactors,
      trend: qualityFlags.trend,
      conclusion,
      dataValidation: {
        missingMetrics: [
          ...(debtEval.missingKeys || []),
          ...(liqEval.missingKeys || []),
          ...(profEval.missingKeys || []),
          ...(cfoEval.missingKeys || []),
          ...(growthEval.missingKeys || []),
          ...(sectorKpiEval.missingKeys || []),
        ],
        weightRedistributed: true,
      },
    };
  }

  /**
   * Classify Financial Health Score into 1 of 5 Rating Tiers
   */
  classifyRating(score) {
    if (score >= 80) return { rating: 'Excellent', description: 'Excellent Financial Health' };
    if (score >= 65) return { rating: 'Strong', description: 'Strong Financial Health' };
    if (score >= 50) return { rating: 'Average', description: 'Average Financial Health' };
    if (score >= 35) return { rating: 'Weak', description: 'Weak Financial Health' };
    return { rating: 'Risky', description: 'Risky Financial Health' };
  }

  /**
   * Generate Quality Flags (GREEN, YELLOW, RED)
   */
  evaluateQualityFlags(data, debtEval, profEval, cfoEval, sectorKpiEval) {
    const flags = [];
    let greenCount = 0;
    let yellowCount = 0;
    let redCount = 0;

    // Green Flag 1: High ROCE + Positive FCF + Low Debt
    if ((data.roce >= 20 || data.roe >= 20) && cfoEval.fcfValue > 0 && (debtEval.deValue < 0.5 || debtEval.isSkipped)) {
      flags.push({ color: 'GREEN', title: 'High Capital Efficiency & FCF', description: 'ROCE >20% combined with positive Free Cash Flow and low leverage.' });
      greenCount++;
    }

    // Green Flag 2: Strong Earnings Quality (CFO > PAT)
    if (cfoEval.cfoConversion >= 100) {
      flags.push({ color: 'GREEN', title: 'Strong Cash Conversion', description: 'CFO is equal to or higher than Reported PAT (>100% conversion).' });
      greenCount++;
    }

    // Yellow Flag 1: ROCE declining or weak CFO
    if ((data.roce < 12 && data.roce > 0) || (cfoEval.cfoConversion < 60 && cfoEval.cfoConversion >= 0)) {
      flags.push({ color: 'YELLOW', title: 'Moderate Capital Efficiency / Cash Conversion', description: 'ROCE below 12% or CFO conversion below 60%.' });
      yellowCount++;
    }

    // Red Flag 1: High Debt + Low Interest Coverage + Negative FCF
    if (debtEval.deValue > 1.8 || (debtEval.icValue !== null && debtEval.icValue < 1.5) || (cfoEval.fcfValue !== null && cfoEval.fcfValue < 0 && data.cfo < 0)) {
      flags.push({ color: 'RED', title: 'Elevated Financial / Liquidity Stress', description: 'Debt-to-Equity >1.8x, Interest Coverage <1.5x, or persistent Negative Cash Flow.' });
      redCount++;
    }

    // Red Flag 2: Net Loss / Crashing Margins
    if (profEval.isNetLoss) {
      flags.push({ color: 'RED', title: 'Reported Net Loss', description: 'Company is reporting negative Net Profit / Earnings per Share.' });
      redCount++;
    }

    let riskLevel = 'Low Risk';
    if (redCount >= 2) riskLevel = 'High Risk';
    else if (redCount === 1 || yellowCount >= 2) riskLevel = 'Moderate Risk';

    let trend = 'Stable';
    if (greenCount > redCount) trend = 'Improving';
    else if (redCount > greenCount) trend = 'Deteriorating';

    return { flags, riskLevel, trend };
  }

  /**
   * Detect 11 Key Financial Warning Signals
   */
  detectWarningSignals(data, debtEval, profEval, cfoEval, growthEval) {
    const warnings = [];

    if (debtEval.deValue > 2.0 && !debtEval.isSkipped) {
      warnings.push({ signal: 'High Leverage Risk', message: `Debt-to-Equity is high at ${debtEval.deValue}x (>2.0x limit).` });
    }
    if (debtEval.icValue !== null && debtEval.icValue < 1.5 && !debtEval.isSkipped) {
      warnings.push({ signal: 'Declining Interest Coverage', message: `Interest coverage is weak at ${debtEval.icValue}x (<1.5x threshold).` });
    }
    if (profEval.roceValue !== null && profEval.roceValue < 8 && !profEval.isNetLoss) {
      warnings.push({ signal: 'Low Capital Efficiency', message: `ROCE is low at ${profEval.roceValue}% (<8% benchmark).` });
    }
    if (data.cfo !== null && data.pat !== null && data.cfo < data.pat && data.pat > 0) {
      warnings.push({ signal: 'Earnings Quality Risk (CFO < PAT)', message: 'Operating cash flow (CFO) is below reported Net Profit (PAT).' });
    }
    if (cfoEval.fcfValue !== null && cfoEval.fcfValue < 0) {
      warnings.push({ signal: 'Negative Free Cash Flow', message: `Free Cash Flow is negative at ₹${cfoEval.fcfValue} Cr after Capex.` });
    }
    if (data.receivableDays > 120) {
      warnings.push({ signal: 'Stretched Receivables', message: `Receivable days are high at ${data.receivableDays} Days (>120 Days).` });
    }
    if (data.inventoryDays > 150) {
      warnings.push({ signal: 'Elevated Inventory Days', message: `Inventory days are elevated at ${data.inventoryDays} Days (>150 Days).` });
    }
    if (growthEval.profitCagr > 15 && cfoEval.cfoConversion < 40) {
      warnings.push({ signal: 'Profit Growth Without Cash Flow', message: 'Reported profit is rising but Operating Cash Flow conversion is weak.' });
    }

    return warnings;
  }

  /**
   * Generate "Why This Score?" Audit Factors
   */
  generateWhyThisScore(data, debtEval, liqEval, profEval, cfoEval, growthEval, sectorKpiEval, qualityFlags) {
    const positiveFactors = [];
    const negativeFactors = [];

    if (profEval.roceValue >= 18) positiveFactors.push(`Strong Capital Efficiency: ROCE is healthy at ${profEval.roceValue}%.`);
    if (debtEval.deValue < 0.5 && !debtEval.isSkipped) positiveFactors.push(`Low Balance Sheet Leverage: Debt-to-Equity is low at ${debtEval.deValue}x.`);
    if (cfoEval.fcfValue > 0) positiveFactors.push(`Positive Free Cash Flow: Generated ₹${cfoEval.fcfValue} Cr FCF.`);
    if (growthEval.profitCagr >= 15) positiveFactors.push(`Strong Historical Growth: 3Y/5Y Profit CAGR is ${growthEval.profitCagr}%.`);
    if (sectorKpiEval.score >= 75) positiveFactors.push(`Strong Sector Performance: Sector Specific Score is ${sectorKpiEval.score}/100.`);

    if (profEval.isNetLoss) negativeFactors.push('Reported Net Loss: Negative Net Profit / EPS.');
    if (debtEval.deValue > 1.5 && !debtEval.isSkipped) negativeFactors.push(`High Leverage: Debt-to-Equity is high at ${debtEval.deValue}x.`);
    if (cfoEval.cfoConversion < 60) negativeFactors.push(`Weak Cash Conversion: Operating Cash Flow is below 60% of Net Profit.`);
    if (data.receivableDays > 90) negativeFactors.push(`Stretched Working Capital: Receivable days at ${data.receivableDays} Days.`);

    return { positiveFactors, negativeFactors };
  }

  /**
   * Generate Final Financial Health Conclusion
   */
  generateConclusion(score, riskLevel) {
    if (score >= 80 && riskLevel === 'Low Risk') return 'Financially Strong';
    if (score >= 65) return 'Financially Healthy but Watch';
    if (score >= 50) return 'Average Financial Health';
    if (score >= 35) return 'Weak Financial Health';
    return 'High Financial Risk';
  }
}

module.exports = new HealthScoringEngine();
