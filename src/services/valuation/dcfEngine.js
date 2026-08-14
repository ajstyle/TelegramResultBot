/**
 * DCF & Residual Income Valuation Engine
 * Computes 2-stage Discounted Free Cash Flow (DCF) & Residual Income Intrinsic Value.
 */
class DcfEngine {
  calculateIntrinsicValue(financials, sectorConfig) {
    if (!financials || !financials.price) {
      return { intrinsicValue: null, marginOfSafetyPct: 0, modelUsed: sectorConfig.primaryValuationModel };
    }

    const price = financials.price;
    const eps = financials.eps || (financials.pe && financials.pe > 0 ? price / financials.pe : null);
    const bvps = financials.bvps || (financials.pb && financials.pb > 0 ? price / financials.pb : null);

    if (!eps || eps <= 0) {
      return { intrinsicValue: null, marginOfSafetyPct: 0, modelUsed: sectorConfig.primaryValuationModel };
    }

    const growthRate = Math.min(Math.max(((financials.epsGrowth5Yr || financials.salesGrowthYoY || 8) / 100), 0.02), 0.25);
    const wacc = 0.115; // 11.5% Cost of Capital for Indian Market
    const terminalGrowth = 0.045; // 4.5% Terminal GDP Growth
    const projectionYears = 5;

    let intrinsicValue = price;

    if (sectorConfig.primaryValuationModel === 'ResidualIncome') {
      // Residual Income Model for Financial Services (Banks/NBFCs)
      const roe = (financials.roe || 12) / 100;
      let currentBvps = bvps || (price / 3);
      let residualIncomePVSum = 0;

      for (let yr = 1; yr <= projectionYears; yr++) {
        const netIncome = currentBvps * roe;
        const equityCharge = currentBvps * wacc;
        const residualIncome = netIncome - equityCharge;
        const pv = residualIncome / Math.pow(1 + wacc, yr);
        residualIncomePVSum += pv;
        currentBvps = currentBvps * (1 + 0.08);
      }

      const terminalResidualIncome = (currentBvps * (roe - wacc)) / (wacc - terminalGrowth);
      const terminalPV = terminalResidualIncome / Math.pow(1 + wacc, projectionYears);

      intrinsicValue = bvps + residualIncomePVSum + terminalPV;
    } else {
      // 2-Stage DCF Model for Non-Financial Corporates
      let currentEps = eps > 0 ? eps : price / 25;
      let fcfPVSum = 0;

      for (let yr = 1; yr <= projectionYears; yr++) {
        currentEps = currentEps * (1 + growthRate);
        const pv = currentEps / Math.pow(1 + wacc, yr);
        fcfPVSum += pv;
      }

      const terminalValue = (currentEps * (1 + terminalGrowth)) / (wacc - terminalGrowth);
      const terminalPV = terminalValue / Math.pow(1 + wacc, projectionYears);

      intrinsicValue = (fcfPVSum + terminalPV) * 1.2; // Exit Multiple scaling factor
    }

    const marginOfSafetyPct = price > 0 ? ((intrinsicValue - price) / price) * 100 : 0;

    return {
      intrinsicValue: Math.round(intrinsicValue * 100) / 100,
      marginOfSafetyPct: Math.round(marginOfSafetyPct * 10) / 10,
      modelUsed: sectorConfig.primaryValuationModel
    };
  }
}

module.exports = new DcfEngine();
