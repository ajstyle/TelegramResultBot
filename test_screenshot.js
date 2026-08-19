const cardGenerator = require('./src/services/cardGenerator');
const fs = require('fs');

async function testScreenshot() {
  const data = {
    symbolName: 'TEST_SYMBOL',
    symbol: 'TEST_SYMBOL',
    subtitle: 'NSE / BSE Listed Company',
    rating: 'GOOD',
    salesQoQ: '10%',
    salesYoY: '20%',
    opm: '15%',
    patQoQ: '5%',
    patYoY: '10%',
    cmp: '100',
    category: 'Small Cap',
    mcapCr: '1000',
    pe: '10',
  };

  const buf = cardGenerator.generatePngCard(data);
  if (buf) {
    console.log("Card generated for screenshotHandler!");
  } else {
    console.log("Card skipped for screenshotHandler.");
  }
}
testScreenshot();
