/**
 * Dynamic Market Cap Classifier & Universe Hard Filter Engine
 * Classifies Indian listed securities into LARGE_CAP, MID_CAP, and SMALL_CAP based on live market cap in ₹ Cr.
 * Strictly excludes Micro Cap (< ₹500 Cr), Nano Cap, Unlisted securities, ETFs, Mutual Funds, Bonds, REITs, InvITs, Commodities, and Indices.
 */
class MarketCapClassifier {
  /**
   * Classify security by live market cap (in ₹ Crores) and instrument type
   * @param {number|string} marketCapCr Market capitalization in ₹ Crores
   * @param {string} instrumentType Security type e.g., 'EQUITY', 'ETF', 'MUTUAL_FUND', 'INDEX'
   * @returns {object} Classification metadata object
   */
  classifyMarketCap(marketCapCr, instrumentType = 'EQUITY') {
    const now = new Date().toISOString();
    const source = 'BSE/NSE/Screener Official Live API';

    // 1. Non-Equity / Excluded Security Type Guard
    const cleanType = (instrumentType || 'EQUITY').toString().toUpperCase().trim();
    const excludedTypes = ['ETF', 'MUTUAL_FUND', 'MUTUAL FUND', 'BOND', 'DEBT', 'INDEX', 'COMMODITY', 'REIT', 'INVIT', 'GOLD'];
    const isExcludedType = excludedTypes.some(type => cleanType.includes(type));

    if (isExcludedType) {
      return {
        marketCap: marketCapCr || 0,
        capCategory: 'EXCLUDED_SECURITY',
        classificationSource: source,
        classificationDate: now,
        isAllowed: false,
        reason: `Excluded instrument type: ${cleanType}`,
      };
    }

    // 2. Unverified / Invalid Market Cap Guard
    const numMcap = parseFloat(marketCapCr);
    if (isNaN(numMcap) || numMcap <= 0) {
      return {
        marketCap: null,
        capCategory: 'UNVERIFIED',
        classificationSource: source,
        classificationDate: now,
        isAllowed: false,
        reason: 'Unverified or missing market capitalization data',
      };
    }

    // 3. Indian Market Cap Threshold Classification (SEBI / AMFI Standard)
    // LARGE_CAP: Top 100 Companies (>= ₹20,000 Cr)
    // MID_CAP: 101st to 250th Companies (₹5,000 Cr to ₹20,000 Cr)
    // SMALL_CAP: 251st to 500th Companies (₹500 Cr to ₹5,000 Cr)
    // MICRO_CAP: < ₹500 Cr (EXCLUDED)
    let capCategory = 'UNVERIFIED';

    if (numMcap >= 20000) {
      capCategory = 'LARGE_CAP';
    } else if (numMcap >= 5000) {
      capCategory = 'MID_CAP';
    } else if (numMcap >= 500) {
      capCategory = 'SMALL_CAP';
    } else {
      capCategory = 'MICRO_CAP';
    }

    const isAllowed = ['LARGE_CAP', 'MID_CAP', 'SMALL_CAP'].includes(capCategory);

    return {
      marketCap: Math.round(numMcap * 100) / 100,
      capCategory,
      classificationSource: source,
      classificationDate: now,
      isAllowed,
      reason: isAllowed ? `Valid ${capCategory} stock` : `Excluded category: ${capCategory} (Market Cap < ₹500 Cr)`,
    };
  }

  /**
   * Enforce hard filter condition: capCategory IN ['LARGE_CAP', 'MID_CAP', 'SMALL_CAP']
   * @param {object} classificationObj
   * @returns {boolean} True if stock belongs to allowed universe
   */
  isAllowedUniverse(classificationObj) {
    if (!classificationObj || !classificationObj.capCategory) return false;
    return ['LARGE_CAP', 'MID_CAP', 'SMALL_CAP'].includes(classificationObj.capCategory);
  }
}

module.exports = new MarketCapClassifier();
