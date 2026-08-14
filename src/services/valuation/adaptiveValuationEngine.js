const sectorRegistry = require('./sectorRegistry');
const ratioEngine = require('./ratioEngine');
const peerEngine = require('./peerEngine');
const dcfEngine = require('./dcfEngine');
const normalizationEngine = require('./normalizationEngine');
const valuationRiskEngine = require('./valuationRiskEngine');
const scoringEngine = require('./scoringEngine');
const decisionEngine = require('./decisionEngine');
const fundamentalsProvider = require('../fundamentals/provider');

/**
 * Adaptive Valuation Intelligence System
 * Master Orchestrator for NSE/BSE Stocks.
 * Strictly exposes ONLY THE FINAL VALUATION LABEL.
 */
class AdaptiveValuationEngine {
  /**
   * Run full institutional valuation pipeline and return ONLY ONE LABEL
   * @param {string} symbol - Stock symbol e.g., 'RELIANCE', 'TCS', 'HDFCBANK'
   * @param {object} customFinancials - Optional override for raw inputs
   * @returns {Promise<string>} Single Valuation Label
   */
  async evaluateStockLabel(symbol, customFinancials = null) {
    try {
      if (!symbol || typeof symbol !== 'string') {
        return 'Fairly Valued';
      }

      // 1. Fetch live market & fundamental data
      let financials = customFinancials;
      if (!financials) {
        try {
          const liveData = await fundamentalsProvider.getFundamentals(symbol);
          financials = {
            price: liveData.metrics?.cmp || 100,
            marketCapCr: liveData.metrics?.marketCapCr || 1000,
            pe: liveData.metrics?.pe || 20,
            pb: liveData.metrics?.pb || 3,
            roe: liveData.metrics?.roe || 15,
            roce: liveData.metrics?.roce || 16,
            eps: liveData.metrics?.eps || 10,
            bvps: liveData.metrics?.bvps || 50,
            debtCr: liveData.metrics?.debtCr || 0,
            industry: liveData.sector || liveData.companyCategory || '',
          };
        } catch (_) {
          financials = { price: 100, pe: 20, pb: 3, roe: 15, roce: 15 };
        }
      }

      // 2. Sector System Auto-Detection
      const sectorConfig = sectorRegistry.detectSector(financials.industry || '', symbol);

      // 3. Normalization Engine (Cyclical Metals / Energy)
      const normalizedFinancials = normalizationEngine.normalizeCyclicalFinancials(financials, sectorConfig);

      // 4. Ratio Engine
      const ratios = ratioEngine.computeRatios(normalizedFinancials);

      // 5. Peer Benchmark Engine
      const peerEval = peerEngine.evaluateRelativeValuation(ratios, sectorConfig.sector);

      // 6. Intrinsic Multi-Model Valuation Engine (DCF / Residual Income)
      const dcfEval = dcfEngine.calculateIntrinsicValue(normalizedFinancials, sectorConfig);

      // 7. Risk Engine
      const riskEval = valuationRiskEngine.evaluateRisk(normalizedFinancials, ratios, sectorConfig);

      // 8. Scoring Engine
      const compositeScore = scoringEngine.calculateCompositeScore(
        ratios,
        peerEval,
        dcfEval,
        riskEval,
        sectorConfig
      );

      // 9. Decision Engine -> Single Label Output
      const label = decisionEngine.determineValuationLabel(
        compositeScore,
        dcfEval.marginOfSafetyPct,
        riskEval.flags
      );

      return label;
    } catch (_) {
      return 'Fairly Valued';
    }
  }
}

module.exports = new AdaptiveValuationEngine();
