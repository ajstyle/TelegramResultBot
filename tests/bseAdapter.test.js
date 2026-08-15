const bseAdapter = require('../src/services/adapters/bseAdapter');
const pdfParser = require('../src/services/pdf/pdfParser');

describe('BSE Filing PDF URL Resolution Suite', () => {
  jest.setTimeout(15000);
  test('Resolves correct attachment PDF URL from BSE NewsID GUID', async () => {
    const newsIdGuid = '0DDD4277-848B-4F03-8182-DFB1403B1E53';
    const resolvedUrl = await bseAdapter.resolvePdfUrl(null, newsIdGuid);

    expect(resolvedUrl).toBe('https://www.bseindia.com/xml-data/corpfiling/AttachLive/59d1a253-95ad-444b-8352-42e56ceba83e.pdf');
  });

  test('Auto-corrects wrong NewsID PDF URL during PDF parsing', async () => {
    const wrongUrl = 'https://www.bseindia.com/xml-data/corpfiling/AttachLive/0DDD4277-848B-4F03-8182-DFB1403B1E53.pdf';
    const result = await pdfParser.parsePdf(wrongUrl);

    expect(result.pdfBuffer).toBeDefined();
    expect(result.pdfBuffer.length).toBeGreaterThan(1000);
  });
});
