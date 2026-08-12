const signalParser = require('../src/parser/signalParser');

describe('Signal Parser Unit Tests', () => {
  test('Parses standard BUY format: BUY TCS @ 3520', () => {
    const input = 'BUY TCS @ 3520';
    const result = signalParser.parse(input);

    expect(result.isParsed).toBe(true);
    expect(result.action).toBe('BUY');
    expect(result.symbol).toBe('TCS');
    expect(result.entry).toBe(3520);
    expect(result.stopLoss).toBeNull();
    expect(result.target).toBeNull();
  });

  test('Parses SELL format: SELL RELIANCE 1450', () => {
    const input = 'SELL RELIANCE 1450';
    const result = signalParser.parse(input);

    expect(result.isParsed).toBe(true);
    expect(result.action).toBe('SELL');
    expect(result.symbol).toBe('RELIANCE');
    expect(result.entry).toBe(1450);
  });

  test('Parses variation with ENTRY keyword: BUY TCS ENTRY 3520', () => {
    const input = 'BUY TCS ENTRY 3520';
    const result = signalParser.parse(input);

    expect(result.isParsed).toBe(true);
    expect(result.action).toBe('BUY');
    expect(result.symbol).toBe('TCS');
    expect(result.entry).toBe(3520);
  });

  test('Parses variation with colon: BUY: TCS 3520', () => {
    const input = 'BUY: TCS 3520';
    const result = signalParser.parse(input);

    expect(result.isParsed).toBe(true);
    expect(result.action).toBe('BUY');
    expect(result.symbol).toBe('TCS');
    expect(result.entry).toBe(3520);
  });

  test('Parses signal with explicit Stop Loss and Target', () => {
    const input = 'BUY INFOSYS @ 1800 SL: 1750 TGT: 1900';
    const result = signalParser.parse(input);

    expect(result.isParsed).toBe(true);
    expect(result.action).toBe('BUY');
    expect(result.symbol).toBe('INFOSYS');
    expect(result.entry).toBe(1800);
    expect(result.stopLoss).toBe(1750);
    expect(result.target).toBe(1900);
  });

  test('Gracefully handles missing SL (does not reject signal)', () => {
    const input = 'BUY TATAMOTORS 980';
    const result = signalParser.parse(input);

    expect(result.isParsed).toBe(true);
    expect(result.stopLoss).toBeNull();
  });

  test('Returns isParsed: false for invalid text', () => {
    const input = 'Random chat message with no trade recommendation';
    const result = signalParser.parse(input);

    expect(result.isParsed).toBe(false);
    expect(result.action).toBeNull();
  });

  test('Parses earningspulse.ai card layout for PANAMAPET', () => {
    const cardInput = `
      Panama Petrochem [PANAMAPET]
      Petroleum Products | Lubricants
      Q1 FY27 Pulse Rating : Excellent in Cr
      Metric QoQ YoY Jun'26 Mar'26 Jun'25
      Sales 111% 150% 1,735 823 693
      Other Inc. - - 4 3 4
      OP 325% 607% 388 91 55
      OPM 1125 bps 1443 bps 22.4% 11.1% 7.9%
      PAT 334% 625% 309 71 43
      EPS 333% 630% 51.1 11.8 7.0
      CMP : 563.8 | Small-Cap (3.3K Cr) | P/E : 15.2
    `;

    const result = signalParser.parse(cardInput);

    expect(result.isParsed).toBe(true);
    expect(result.action).toBe('BUY');
    expect(result.symbol).toBe('PANAMAPET');
    expect(result.entry).toBe(563.8);
    expect(result.cardRating).toBe('EXCELLENT');
    expect(result.cardCategory).toBe('Small-Cap');
    expect(result.cardPe).toBe(15.2);
  });
});
