const bseAdapter = require('./src/services/adapters/bseAdapter');
const nseAdapter = require('./src/services/adapters/nseAdapter');
const geminiAnalyzer = require('./src/services/ai/geminiAnalyzer');
const cardGenerator = require('./src/services/cardGenerator');
const pdfParserEngine = require('./src/services/pdf/pdfParser');
const fs = require('fs');

(async () => {
  console.log("Fetching BSE & NSE...");
  const bse = await bseAdapter.fetchAnnouncements();
  const nse = await nseAdapter.fetchAnnouncements();
  const all = [...bse, ...nse];
  console.log(`Found ${all.length} announcements.`);
  
  for (const item of all.slice(0, 5)) {
    console.log(`Testing: ${item.symbol} - ${item.title}`);
    let pdfAnalysis = { rawText: '', pdfBuffer: null, metrics: {} };
    if (item.pdfUrl) {
      pdfAnalysis = await pdfParserEngine.parsePdf(item.pdfUrl);
    }
    const result = await geminiAnalyzer.analyzeResultPdf(pdfAnalysis.pdfBuffer || pdfAnalysis.rawText, item.symbol, { isLiveBroadcast: true });
    
    if (result && result.scorecard) {
      console.log(`Scorecard generated for ${item.symbol}. Checking valid metrics...`);
      const card = cardGenerator.generatePngCard({
        scorecard: result.scorecard,
        symbol: item.symbol,
        symbolName: item.symbol,
        pulseRating: result.scorecard.pulseRating || 'Good',
        subtitle: 'Test',
        cmp: '100', category: 'MID CAP', mcapCr: 1000, pe: '20'
      });
      if (card) {
        console.log(`✅ Valid Card GENERATED for ${item.symbol}.`);
        fs.writeFileSync(`${item.symbol}_test.png`, card);
      } else {
        console.log(`❌ Card suppressed (blank/invalid) for ${item.symbol}.`);
      }
    } else {
      console.log(`No scorecard for ${item.symbol}.`);
    }
  }
})();
