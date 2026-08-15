const dataValidator = require('./dataValidator');

/**
 * Sector-Specific KPI Scoring Engine
 * Computes the 15-point Sector Specific Score based on tailored sector KPI rules:
 * - Bank / NBFC
 * - IT / Software
 * - FMCG / Retail
 * - Pharma / Auto
 * - Capital Goods / Engineering
 * - Real Estate / Power / Telecom / Commodity / Insurance
 */
class SectorScoringEngine {
  /**
   * Calculate Sector KPI Score (0-100 normalized, weighted at 15 points)
   * @param {object} data Validated financial input
   * @param {object} sectorConfig Sector configuration from SectorRegistry
   * @returns {object} Sector KPI score breakdown
   */
  evaluateSectorKPIs(data, sectorConfig) {
    if (!sectorConfig || !sectorConfig.kpis || sectorConfig.kpis.length === 0) {
      return {
        score: 50,
        weight: 15,
        notice: sectorConfig?.notice || 'Sector-specific score unavailable — Universal Financial Health Score used.',
        kpiBreakdown: [],
        missingKeys: [],
      };
    }

    const kpiBreakdown = [];
    const scoredMetrics = [];

    sectorConfig.kpis.forEach((kpi) => {
      const val = data[kpi.key];
      let score = null;

      if (val !== null && val !== undefined) {
        score = this.scoreSingleKPI(kpi.key, val, data, sectorConfig.id);
      }

      kpiBreakdown.push({
        key: kpi.key,
        name: kpi.name,
        target: kpi.target,
        value: val,
        score,
        weight: kpi.weight,
      });

      scoredMetrics.push({
        key: kpi.key,
        weight: kpi.weight,
        score,
      });
    });

    const { finalCategoryScore, missingKeys } = dataValidator.redistributeWeights(scoredMetrics);

    return {
      score: finalCategoryScore,
      weight: 15,
      sectorId: sectorConfig.id,
      sectorName: sectorConfig.name,
      kpiBreakdown,
      missingKeys,
    };
  }

  /**
   * Score an individual sector KPI on a 0-100 scale based on sector benchmarks
   */
  scoreSingleKPI(key, val, data, sectorId) {
    if (typeof val === 'boolean') {
      return val ? 100 : 20;
    }

    switch (key) {
      // 1. Banking & NBFC KPIs
      case 'gnpa':
        if (val <= 1.5) return 100;
        if (val <= 3.0) return 85;
        if (val <= 5.0) return 50;
        if (val <= 8.0) return 25;
        return 5;

      case 'nnpa':
        if (val <= 0.5) return 100;
        if (val <= 1.0) return 85;
        if (val <= 2.0) return 50;
        if (val <= 3.5) return 25;
        return 0;

      case 'pcr':
        if (val >= 75) return 100;
        if (val >= 65) return 80;
        if (val >= 50) return 50;
        return 20;

      case 'crar':
        if (val >= 18) return 100;
        if (val >= 15) return 85;
        if (val >= 12) return 50;
        return 10;

      case 'roa':
        if (val >= 2.0) return 100;
        if (val >= 1.2) return 85;
        if (val >= 0.8) return 55;
        if (val >= 0.4) return 30;
        return 5;

      case 'nim':
        if (sectorId === 'NBFC') {
          if (val >= 7.0) return 100;
          if (val >= 5.0) return 80;
          if (val >= 3.0) return 50;
          return 20;
        } else {
          if (val >= 4.0) return 100;
          if (val >= 3.2) return 85;
          if (val >= 2.5) return 55;
          return 20;
        }

      case 'casa':
        if (val >= 45) return 100;
        if (val >= 35) return 80;
        if (val >= 25) return 50;
        return 20;

      case 'aumGrowth':
      case 'creditGrowth':
      case 'depositGrowth':
        if (val >= 20) return 100;
        if (val >= 12) return 80;
        if (val >= 6) return 55;
        if (val >= 0) return 35;
        return 10;

      // 2. IT / Software KPIs
      case 'debtToEquity':
        if (val <= 0.05) return 100;
        if (val <= 0.3) return 80;
        if (val <= 0.8) return 45;
        return 15;

      case 'fcfMargin':
        if (val >= 20) return 100;
        if (val >= 15) return 85;
        if (val >= 10) return 60;
        if (val >= 5) return 35;
        return 10;

      case 'ebitMargin':
      case 'ebitdaMargin':
        if (val >= 25) return 100;
        if (val >= 18) return 80;
        if (val >= 12) return 55;
        if (val >= 5) return 30;
        return 10;

      case 'attrition':
        if (val <= 12) return 100;
        if (val <= 18) return 75;
        if (val <= 24) return 45;
        return 15;

      case 'utilisation':
        if (val >= 85) return 100;
        if (val >= 80) return 80;
        if (val >= 75) return 50;
        return 20;

      // 3. FMCG & Retail KPIs
      case 'roce':
      case 'roe':
        if (val >= 25) return 100;
        if (val >= 18) return 85;
        if (val >= 12) return 55;
        if (val >= 5) return 30;
        return 10;

      case 'inventoryDays':
      case 'receivableDays':
        if (val <= 45) return 100;
        if (val <= 75) return 75;
        if (val <= 120) return 45;
        return 15;

      case 'sssg':
      case 'volumeGrowth':
        if (val >= 10) return 100;
        if (val >= 6) return 80;
        if (val >= 2) return 50;
        if (val >= 0) return 35;
        return 10;

      // 4. Capital Goods & Real Estate KPIs
      case 'orderBookSales':
        if (val >= 3.0) return 100;
        if (val >= 2.0) return 85;
        if (val >= 1.0) return 55;
        return 25;

      case 'netDebtToEbitda':
      case 'debtToEbitda':
        if (val <= 1.5) return 100;
        if (val <= 2.5) return 80;
        if (val <= 4.0) return 45;
        return 10;

      case 'interestCoverage':
        if (val >= 4.0) return 100;
        if (val >= 2.5) return 80;
        if (val >= 1.5) return 45;
        return 10;

      case 'rndPercent':
        if (val >= 8) return 100;
        if (val >= 5) return 80;
        if (val >= 2) return 50;
        return 20;

      // 5. Insurance KPIs
      case 'combinedRatio':
        if (val <= 95) return 100;
        if (val <= 100) return 80;
        if (val <= 108) return 45;
        return 10;

      case 'solvencyRatio':
        if (val >= 180) return 100;
        if (val >= 150) return 80;
        if (val >= 120) return 50;
        return 15;

      default:
        // Generic percentage metric fallback
        if (val >= 15) return 85;
        if (val >= 5) return 60;
        if (val >= 0) return 40;
        return 15;
    }
  }
}

module.exports = new SectorScoringEngine();
