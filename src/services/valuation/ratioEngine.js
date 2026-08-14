/**
 * Ratio Calculation Engine
 * Computes standardized financial ratios across valuation, profitability, growth, and leverage metrics.
 */
class RatioEngine {
  computeRatios(financials) {
    const price = financials.price || 0;
    const eps = financials.eps || 0;
    const bvps = financials.bvps || 0;
    const mcap = financials.marketCapCr || 0;
    const ev = financials.evCr !== undefined ? financials.evCr : (mcap + (financials.debtCr || 0) - (financials.cashCr || 0));
    const ebitda = financials.ebitdaCr || 0;
    const sales = financials.salesCr || 0;
    const pat = financials.patCr || 0;
    const debt = financials.debtCr || 0;
    const equity = financials.equityCr || (bvps > 0 && price > 0 ? (mcap / price) * bvps : mcap);
    const roe = financials.roe !== undefined ? financials.roe : (equity > 0 ? (pat / equity) * 100 : 0);
    const roce = financials.roce !== undefined ? financials.roce : 15.0;
    const earningsGrowth = financials.epsGrowth5Yr || financials.patGrowthYoY || 10.0;

    const pe = eps > 0 ? price / eps : (pat > 0 ? mcap / pat : 0);
    const pb = bvps > 0 ? price / bvps : (equity > 0 ? mcap / equity : 0);
    const evEbitda = ebitda > 0 ? ev / ebitda : 0;
    const peg = (pe > 0 && earningsGrowth > 0) ? pe / earningsGrowth : 0;
    const debtToEquity = equity > 0 ? debt / equity : 0;
    const opm = sales > 0 ? ((ebitda || pat) / sales) * 100 : 0;
    const fcf = financials.fcfCr !== undefined ? financials.fcfCr : pat * 0.8;
    const fcfYield = mcap > 0 ? (fcf / mcap) * 100 : 0;

    return {
      pe: Math.round(pe * 100) / 100,
      pb: Math.round(pb * 100) / 100,
      evEbitda: Math.round(evEbitda * 100) / 100,
      peg: Math.round(peg * 100) / 100,
      debtToEquity: Math.round(debtToEquity * 100) / 100,
      roe: Math.round(roe * 100) / 100,
      roce: Math.round(roce * 100) / 100,
      opm: Math.round(opm * 100) / 100,
      fcfYield: Math.round(fcfYield * 100) / 100,
      earningsGrowth: Math.round(earningsGrowth * 100) / 100
    };
  }
}

module.exports = new RatioEngine();
