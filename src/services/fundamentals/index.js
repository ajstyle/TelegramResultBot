const provider = require('./provider');

class FundamentalsService {
  /**
   * Fetch fundamentals and calculate 0-100 score
   * @param {string} symbol
   * @returns {Promise<{ metrics: object|null, score: number|null, rating: string, valuation: string, isAvailable: boolean }>}
   */
  async analyze(symbol) {
    const rawData = await provider.getFundamentals(symbol);

    if (!rawData) {
      return {
        metrics: null,
        score: null,
        rating: 'Data Unavailable',
        valuation: 'Unknown',
        isAvailable: false,
      };
    }

    const score = this.calculateScore(rawData);
    const rating = this.getRating(score);
    const valuation = rawData.valuationRating || this.getValuation(rawData.pe, rawData.sectorPe);

    return {
      metrics: {
        pe: rawData.pe,
        pb: rawData.pb,
        roe: rawData.roe,
        roce: rawData.roce,
        debtToEquity: rawData.debtToEquity,
        salesGrowthQoQ: rawData.salesGrowthQoQ,
        profitGrowthQoQ: rawData.profitGrowthQoQ,
        salesGrowthYoY: rawData.salesGrowthYoY,
        profitGrowthYoY: rawData.profitGrowthYoY,
        promoterHolding: rawData.promoterHolding,
        pledgedPercentage: rawData.pledgedPercentage,
        operatingMargin: rawData.operatingMargin,
        freeCashFlow: rawData.freeCashFlow,
        sectorPe: rawData.sectorPe,
      },
      score,
      rating,
      valuation,
      isAvailable: true,
    };
  }

  /**
   * Calculate 0-100 fundamental quality score based on metrics
   * @param {object} data
   * @returns {number} score 0..100
   */
  calculateScore(data) {
    let totalPoints = 0;
    let maxPoints = 0;

    // 1. ROE (Weight: 15)
    if (data.roe !== null && data.roe !== undefined) {
      maxPoints += 15;
      if (data.roe >= 25) totalPoints += 15;
      else if (data.roe >= 18) totalPoints += 12;
      else if (data.roe >= 12) totalPoints += 8;
      else if (data.roe > 0) totalPoints += 4;
    }

    // 2. ROCE (Weight: 15)
    if (data.roce !== null && data.roce !== undefined) {
      maxPoints += 15;
      if (data.roce >= 25) totalPoints += 15;
      else if (data.roce >= 18) totalPoints += 12;
      else if (data.roce >= 12) totalPoints += 8;
      else if (data.roce > 0) totalPoints += 4;
    }

    // 3. Debt to Equity (Weight: 15)
    if (data.debtToEquity !== null && data.debtToEquity !== undefined) {
      maxPoints += 15;
      if (data.debtToEquity <= 0.1) totalPoints += 15;
      else if (data.debtToEquity <= 0.5) totalPoints += 12;
      else if (data.debtToEquity <= 1.0) totalPoints += 8;
      else if (data.debtToEquity <= 2.0) totalPoints += 4;
    }

    // 4. Profit Growth (QoQ / YoY) (Weight: 15)
    const profitGrowth = data.profitGrowthQoQ ?? data.profitGrowthYoY;
    if (profitGrowth !== null && profitGrowth !== undefined) {
      maxPoints += 15;
      if (profitGrowth >= 20) totalPoints += 15;
      else if (profitGrowth >= 10) totalPoints += 11;
      else if (profitGrowth >= 0) totalPoints += 7;
    }

    // 5. Sales Growth (QoQ / YoY) (Weight: 10)
    const salesGrowth = data.salesGrowthQoQ ?? data.salesGrowthYoY;
    if (salesGrowth !== null && salesGrowth !== undefined) {
      maxPoints += 10;
      if (salesGrowth >= 15) totalPoints += 10;
      else if (salesGrowth >= 8) totalPoints += 7;
      else if (salesGrowth >= 0) totalPoints += 4;
    }

    // 6. Promoter Holding & Pledging (Weight: 15)
    if (data.promoterHolding !== null && data.promoterHolding !== undefined) {
      maxPoints += 15;
      let points = 0;
      if (data.promoterHolding >= 50) points += 9;
      else if (data.promoterHolding >= 35) points += 6;

      const pledge = data.pledgedPercentage ?? 0;
      if (pledge === 0) points += 6;
      else if (pledge < 10) points += 3;

      totalPoints += points;
    }

    // 7. Operating Margin (Weight: 15)
    if (data.operatingMargin !== null && data.operatingMargin !== undefined) {
      maxPoints += 15;
      if (data.operatingMargin >= 20) totalPoints += 15;
      else if (data.operatingMargin >= 12) totalPoints += 10;
      else if (data.operatingMargin > 0) totalPoints += 5;
    }

    if (maxPoints === 0) return 50;

    return Math.min(100, Math.max(0, Math.round((totalPoints / maxPoints) * 100)));
  }

  /**
   * Convert score to exact requested categories:
   * 80+: Strong
   * 60-79: Good
   * 40-59: Neutral
   * Below 40: Avoid
   */
  getRating(score) {
    if (score === null || score === undefined) return 'Data Unavailable';
    if (score >= 80) return 'Strong';
    if (score >= 60) return 'Good';
    if (score >= 40) return 'Neutral';
    return 'Avoid';
  }

  /**
   * Determine valuation rating comparing Stock P/E against Sector P/E
   */
  getValuation(pe, sectorPe) {
    if (!pe || !sectorPe) return 'FAIRLY VALUED ⚖️';
    if (pe <= sectorPe * 0.95) return 'UNDERVALUED / ATTRACTIVE 💎';
    if (pe <= sectorPe * 1.15) return 'FAIRLY VALUED ⚖️';
    return 'OVERVALUED / EXPENSIVE 🔴';
  }
}

module.exports = new FundamentalsService();
