/**
 * Reusable Signal Parser
 * Extracts trading signals & infographic card data (Action, Symbol, Entry, StopLoss, Target, Rating, Category)
 */
class SignalParser {
  /**
   * Parse raw OCR text or message text
   * @param {string} rawText
   * @returns {{ action: string|null, symbol: string|null, entry: number|null, stopLoss: number|null, target: number|null, cardRating: string|null, cardCategory: string|null, cardPe: number|null, isParsed: boolean }}
   */
  parse(rawText) {
    if (!rawText || typeof rawText !== 'string') {
      return { action: null, symbol: null, entry: null, stopLoss: null, target: null, cardRating: null, cardCategory: null, cardPe: null, isParsed: false };
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

    let symbol = null;
    let entry = null;
    let cardRating = null;
    let cardCategory = null;
    let cardPe = null;

    // --- INFOGRAPHIC CARD LAYOUT PARSING (earningspulse.ai & Corporate Result Cards) ---
    // Bracket Symbol e.g. [ PANAMAPET ] or [TCS]
    const bracketSymbolMatch = cleanText.match(/\[\s*([A-Z0-9_-]+)\s*\]/i);
    if (bracketSymbolMatch) {
      symbol = bracketSymbolMatch[1].toUpperCase();
    }

    // Pulse Rating e.g. Pulse Rating : Excellent / Good
    const pulseRatingMatch = upperText.match(/\bPULSE\s*RATING\s*[:=]?\s*(EXCELLENT|VERY\s*GOOD|GOOD|FAIR|POOR|VERY\s*POOR)/i);
    if (pulseRatingMatch) {
      cardRating = pulseRatingMatch[1].toUpperCase();
      if (!action) {
        if (cardRating.includes('EXCELLENT') || cardRating.includes('GOOD')) {
          action = 'BUY';
        } else if (cardRating.includes('POOR')) {
          action = 'AVOID';
        }
      }
    }

    // CMP (Current Market Price) e.g. CMP : 563.8
    const cmpMatch = upperText.match(/\bCMP\s*[:=]?\s*([0-9,]+(?:\.[0-9]+)?)/);
    if (cmpMatch) {
      entry = parseFloat(cmpMatch[1].replace(/,/g, ''));
    }

    // Company Size & Market Cap e.g. Small-Cap (3.3K Cr) or Mid-Cap
    const capCategoryMatch = cleanText.match(/\b(Large-Cap|Mid-Cap|Small-Cap|Micro-Cap|Penny-Stock)\b/i);
    if (capCategoryMatch) {
      cardCategory = capCategoryMatch[1];
    }

    // P/E e.g. P/E : 15.2
    const peMatch = upperText.match(/\bP\/?E\s*[:=]?\s*([0-9]+(?:\.[0-9]+)?)/);
    if (peMatch) {
      cardPe = parseFloat(peMatch[1]);
    }

    // Standard BUY/SELL Text Pattern Extraction
    let priceText = upperText;
    if (slMatch) priceText = priceText.replace(slMatch[0], '');
    if (targetMatch) priceText = priceText.replace(targetMatch[0], '');

    const actionPattern = '(?:BUY|SELL|LONG|SHORT)';
    if (!symbol || !entry) {
      const mainMatch = priceText.match(
        new RegExp(`${actionPattern}[:\\s]+([A-Z0-9\\.&-]+)(?:[\\s]+(?:@|ENTRY|AT|PRICE))?[:\\s]+([0-9]+(?:\\.[0-9]+)?)`)
      );

      if (mainMatch) {
        if (!symbol) symbol = mainMatch[1].replace(/[^A-Z0-9-]/g, '').trim();
        if (!entry) entry = parseFloat(mainMatch[2]);
      } else {
        const fallbackMatch = priceText.match(new RegExp(`${actionPattern}[:\\s]+([A-Z0-9\\.&-]+)[\\s]+([0-9]+(?:\\.[0-9]+)?)`));
        if (fallbackMatch) {
          if (!symbol) symbol = fallbackMatch[1].replace(/[^A-Z0-9-]/g, '').trim();
          if (!entry) entry = parseFloat(fallbackMatch[2]);
        }
      }
    }

    // If action is still not determined but symbol and CMP exist (common in image cards)
    if (!action && symbol && entry) {
      action = 'BUY';
    }

    // Clean up symbol names (remove noise words if matched accidentally)
    const ignoreKeywords = ['ENTRY', 'AT', 'FOR', 'NOW', 'CMP', 'PRICE', 'EQUITY', 'NSE', 'BSE', 'METRIC', 'QOQ', 'YOY', 'PULSE', 'RATING'];
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
      cardRating,
      cardCategory,
      cardPe,
      isParsed,
    };
  }
}

module.exports = new SignalParser();
