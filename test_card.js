const cardGenerator = require('./src/services/cardGenerator');
const fs = require('fs');

async function test() {
  const data = {
    symbol: 'TEST',
    symbolName: 'Test Company',
    cmp: '100',
    category: 'Small Cap',
    mcapCr: '1000 Cr',
    pe: '10',
    qualityScore: 80,
    qualityStatus: 'Good',
    valuationLabel: 'Fair',
    pulseRating: 'Good',
    periodLabels: { q_t: "Jun '26", q_t1: "Mar '26", q_t4: "Jun '25" },
    scorecard: {
      pulseRating: 'Good',
      Sales: { Qt: 100, Qt1: 90, Qt4: 80, QoQ: '+11%', YoY: '+25%' },
      'Other Inc.': { Qt: 10, Qt1: 10, Qt4: 10, QoQ: '-', YoY: '-' },
      OP: { Qt: 50, Qt1: 45, Qt4: 40, QoQ: '+11%', YoY: '+25%' },
      OPM: { Qt: 50, Qt1: 50, Qt4: 50, QoQ: '-', YoY: '-' },
      PAT: { Qt: 30, Qt1: 25, Qt4: 20, QoQ: '+20%', YoY: '+50%' },
      EPS: { Qt: 3, Qt1: 2.5, Qt4: 2, QoQ: '+20%', YoY: '+50%' }
    }
  };

  const buf = cardGenerator.generatePngCard(data);
  if (buf) {
    console.log("Card generated despite 0s!");
  } else {
    console.log("Card skipped correctly.");
  }
}
test();
