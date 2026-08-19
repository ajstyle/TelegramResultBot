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
      Sales: { Qt: 0, Qt1: 0, Qt4: 0, QoQ: '-', YoY: '-' },
      'Other Inc.': { Qt: 0, Qt1: 0, Qt4: 0, QoQ: '-', YoY: '-' },
      OP: { Qt: 0, Qt1: 0, Qt4: 0, QoQ: '-', YoY: '-' },
      OPM: { Qt: 0, Qt1: 0, Qt4: 0, QoQ: '-', YoY: '-' },
      PAT: { Qt: 0, Qt1: 0, Qt4: 0, QoQ: '-', YoY: '-' },
      EPS: { Qt: 0, Qt1: 0, Qt4: 0, QoQ: '-', YoY: '-' }
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
