const bseAdapter = require('../src/services/adapters/bseAdapter');
const pdfParser = require('../src/services/pdf/pdfParser');

describe('BSE Filing PDF URL Resolution Suite', () => {
  jest.setTimeout(30000);
  test('Resolves correct attachment PDF URL from BSE NewsID GUID', async () => {
    const newsIdGuid = '0DDD4277-848B-4F03-8182-DFB1403B1E53';
    const resolvedUrl = await bseAdapter.resolvePdfUrl(null, newsIdGuid);

    expect(resolvedUrl).toMatch(/https:\/\/www\.bseindia\.com\/xml-data\/corpfiling\/Attach(Live|His)\/[a-f0-9-]+\.pdf/i);
  });

  test('Auto-corrects wrong NewsID PDF URL during PDF parsing', async () => {
    const wrongUrl = 'https://www.bseindia.com/xml-data/corpfiling/AttachLive/0DDD4277-848B-4F03-8182-DFB1403B1E53.pdf';
    const result = await pdfParser.parsePdf(wrongUrl);

    expect(result).toBeDefined();
    expect(result.metrics).toBeDefined();
  });
});
