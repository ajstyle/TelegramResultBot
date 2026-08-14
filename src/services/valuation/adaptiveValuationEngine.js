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
          const price = liveData.cmp || liveData.metrics?.cmp || null;
          const pe = liveData.pe || liveData.metrics?.pe || null;
          const pb = liveData.pb || liveData.metrics?.pb || null;
          const eps = liveData.eps || (price && pe && pe > 0 ? Math.round((price / pe) * 100) / 100 : null);
          const bvps = liveData.bvps || (price && pb && pb > 0 ? Math.round((price / pb) * 100) / 100 : null);

          financials = {
            price,
            pe,
            pb,
            eps,
            bvps,
            marketCapCr: liveData.marketCapCr || liveData.metrics?.marketCapCr || null,
            roe: liveData.roe !== null && liveData.roe !== undefined ? liveData.roe : (liveData.metrics?.roe || null),
            roce: liveData.roce !== null && liveData.roce !== undefined ? liveData.roce : (liveData.metrics?.roce || null),
            debtCr: liveData.debtCr || null,
            debtToEquity: liveData.debtToEquity !== null && liveData.debtToEquity !== undefined ? liveData.debtToEquity : (liveData.metrics?.debtToEquity || null),
            industry: liveData.sector || liveData.companyCategory || '',
          };
        } catch (_) {
          financials = null;
        }
      }

      if (!financials || (!financials.price && !financials.cmp && !financials.marketCapCr)) {
        return 'Unverified';
      }

      // 1b. Market Cap Universe Hard Filter Guard (LARGE_CAP, MID_CAP, SMALL_CAP only)
      const mcapToValidate = financials.marketCapCr || (financials.price ? Math.max(25000, financials.price * 50) : null);

      const marketCapClassifier = require('../universe/marketCapClassifier');
      const classification = marketCapClassifier.classifyMarketCap(mcapToValidate, 'EQUITY');
      if (!classification.isAllowed) {
        return 'Excluded Universe';
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
