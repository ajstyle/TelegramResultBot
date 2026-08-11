/**
 * Reusable Signal Parser
 * Extracts trading signals (Action, Symbol, Entry, StopLoss, Target) from raw text.
 */
class SignalParser {
  /**
   * Parse text and return structured signal object
   * @param {string} rawText
   * @returns {{ action: string|null, symbol: string|null, entry: number|null, stopLoss: number|null, target: number|null, isParsed: boolean }}
   */
  parse(rawText) {
    if (!rawText || typeof rawText !== 'string') {
      return { action: null, symbol: null, entry: null, stopLoss: null, target: null, isParsed: false };
    }

    // Clean up text: replace line breaks with spaces, convert multiple spaces to single space
    const cleanText = rawText.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
    const upperText = cleanText.toUpperCase();

    // 1. Detect Action (BUY or SELL)
    let action = null;
    if (/\b(BUY|LONG)\b/.test(upperText)) {
      action = 'BUY';
    } else if (/\b(SELL|SHORT)\b/.test(upperText)) {
      action = 'SELL';
    }

    if (!action) {
      return { action: null, symbol: null, entry: null, stopLoss: null, target: null, isParsed: false };
    }

    // 2. Extract Stop Loss (SL, S.L., STOPLOSS, STOP LOSS)
    let stopLoss = null;
    const slMatch = upperText.match(/\b(?:SL|S\.L\.|STOP\s*LOSS|STOPLOSS)[:\s=@]*([0-9]+(?:\.[0-9]+)?)/);
    if (slMatch) {
      stopLoss = parseFloat(slMatch[1]);
    }

    // 3. Extract Target (TGT, TARGET, TP, TAKE PROFIT)
    let target = null;
    const targetMatch = upperText.match(/\b(?:TGT|TARGET|TP|TAKE\s*PROFIT)[:\s=@]*([0-9]+(?:\.[0-9]+)?)/);
    if (targetMatch) {
      target = parseFloat(targetMatch[1]);
    }

    // 4. Extract Symbol & Entry Price
    // Patterns to consider:
    // - BUY TCS @ 3520
    // - BUY TCS ENTRY 3520
    // - BUY: TCS 3520
    // - BUY TCS 3520
    // - SELL RELIANCE @ 1450

    let symbol = null;
    let entry = null;

    // Remove SL and TGT portions to prevent price confusion in symbol/entry extraction
    let priceText = upperText;
    if (slMatch) priceText = priceText.replace(slMatch[0], '');
    if (targetMatch) priceText = priceText.replace(targetMatch[0], '');

    // Common action prefixes
    const actionPattern = '(?:BUY|SELL|LONG|SHORT)';

    // Pattern 1: Action [:]? [SYMBOL] [@] [ENTRY]
    // e.g. BUY TCS @ 3520, BUY: RELIANCE 1450, BUY TCS ENTRY 3520
    const mainMatch = priceText.match(
      new RegExp(`${actionPattern}[:\\s]+([A-Z0-9\\.&-]+)(?:[\\s]+(?:@|ENTRY|AT|PRICE))?[:\\s]+([0-9]+(?:\\.[0-9]+)?)`)
    );

    if (mainMatch) {
      symbol = mainMatch[1].replace(/[^A-Z0-9-]/g, '').trim();
      entry = parseFloat(mainMatch[2]);
    } else {
      // Fallback Pattern 2: Action [SYMBOL] [NUMERIC_ENTRY]
      const fallbackMatch = priceText.match(new RegExp(`${actionPattern}[:\\s]+([A-Z0-9\\.&-]+)[\\s]+([0-9]+(?:\\.[0-9]+)?)`));
      if (fallbackMatch) {
        symbol = fallbackMatch[1].replace(/[^A-Z0-9-]/g, '').trim();
        entry = parseFloat(fallbackMatch[2]);
      }
    }

    // Clean up symbol names (remove noise words if matched accidentally)
    const ignoreKeywords = ['ENTRY', 'AT', 'FOR', 'NOW', 'CMP', 'PRICE', 'EQUITY', 'NSE', 'BSE'];
    if (symbol && ignoreKeywords.includes(symbol)) {
      symbol = null;
    }

    const isParsed = Boolean(action && symbol && entry && !isNaN(entry));

    return {
      action,
      symbol,
      entry,
      stopLoss,
      target,
      isParsed,
    };
  }
}

module.exports = new SignalParser();
