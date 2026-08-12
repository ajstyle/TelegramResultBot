const pdfParser = require('../src/services/pdf/pdfParser');

describe('PDF Parser Financial Metrics Unit Tests', () => {
  test('Extracts Revenue, PAT, EBITDA, and Margin metrics correctly from text', () => {
    const text = `
      TCS Q3 Financial Results
      Revenue from Operations: ₹35000 Cr
      Net Profit (PAT): ₹11000 Cr
      EBITDA: ₹12500 Cr
      EBITDA Margin: 25.5%
      Basic EPS: ₹30.2
    `;

    const metrics = pdfParser.extractFinancialMetrics(text);

    expect(metrics.revenue).toBe(35000);
    expect(metrics.netProfit).toBe(11000);
    expect(metrics.ebitda).toBe(12500);
    expect(metrics.ebitdaMargin).toBe(25.5);
    expect(metrics.eps).toBe(30.2);
  });

  test('Returns null for missing metrics without fabricating values', () => {
    const text = 'Random board meeting announcement text without financial tables';
    const metrics = pdfParser.extractFinancialMetrics(text);

    expect(metrics.revenue).toBeNull();
    expect(metrics.netProfit).toBeNull();
    expect(metrics.ebitda).toBeNull();
  });
});
