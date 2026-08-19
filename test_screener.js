const geminiAnalyzer = require('./src/services/ai/geminiAnalyzer');

async function testScreener() {
  console.log("Fetching Screener for RELIANCE...");
  try {
    const res = await geminiAnalyzer.fetchScreenerQuarterlyFallback('RELIANCE');
    console.log(JSON.stringify(res, null, 2));
  } catch (err) {
    console.error(err);
  }
}

testScreener();
