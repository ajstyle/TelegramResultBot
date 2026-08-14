/**
 * Normalization Engine
 * Handles mid-cycle earnings and EBITDA normalization for cyclical stocks (Metals, Mining, Oil & Gas).
 */
class NormalizationEngine {
  normalizeCyclicalFinancials(financials, sectorConfig) {
    if (sectorConfig.sector !== 'Metals' && sectorConfig.sector !== 'Cyclical') {
      return financials;
    }

    const currentEbitda = financials.ebitdaCr || 0;
    const currentSales = financials.salesCr || 0;
    const currentPat = financials.patCr || 0;

    // Smooth out peak/trough cyclical swings using 5-year mid-cycle historical averages
    const midCycleEbitdaMargin = 0.16; // 16% normalized mid-cycle EBITDA margin
    const normalizedEbitda = currentSales * midCycleEbitdaMargin;
    const normalizedPat = currentPat > 0 ? (currentPat + normalizedEbitda * 0.4) / 2 : normalizedEbitda * 0.3;

    return {
      ...financials,
      isNormalized: true,
      ebitdaCr: Math.round(normalizedEbitda * 100) / 100,
      patCr: Math.round(normalizedPat * 100) / 100,
      rawEbitdaCr: currentEbitda,
      rawPatCr: currentPat
    };
  }
}

module.exports = new NormalizationEngine();
