/**
 * Reusable Signal Parser
 * Generic Extractor for Trading Signals & Infographic Cards (Action, Symbol, Entry, StopLoss, Target, Rating, Category)
 */
class SignalParser {
  /**
   * Parse raw OCR text or message text dynamically for ANY stock
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

    // --- STEP 0: Hashtag Symbol Extractor e.g. #PANAMAPET or #TCS or #DIXON ---
    const hashtagMatch = cleanText.match(/#([A-Z0-9_-]{2,15})/i);
    const nonSymbolHashtags = ['RESULTS', 'EARNINGS', 'Q1', 'Q2', 'Q3', 'Q4', 'EXCELLENT', 'GOOD', 'POOR', 'BUY', 'SELL'];
    if (hashtagMatch && !nonSymbolHashtags.includes(hashtagMatch[1].toUpperCase())) {
      symbol = hashtagMatch[1].toUpperCase();
    }

    // --- STEP A: Standard Text Signal Pattern Matching (e.g. BUY TCS @ 3520) ---
    let priceText = upperText;
    if (slMatch) priceText = priceText.replace(slMatch[0], '');
    if (targetMatch) priceText = priceText.replace(targetMatch[0], '');

    const actionPattern = '(?:BUY|SELL|LONG|SHORT)';
    if (!symbol) {
      const mainMatch = priceText.match(
        new RegExp(`${actionPattern}[:\\s]+([A-Z0-9\\.&-]+)(?:[\\s]+(?:@|ENTRY|AT|PRICE))?[:\\s]+([0-9]+(?:\\.[0-9]+)?)`)
      );

      if (mainMatch) {
        symbol = mainMatch[1].replace(/[^A-Z0-9-]/g, '').trim();
        entry = parseFloat(mainMatch[2]);
      } else {
        const fallbackMatch = priceText.match(new RegExp(`${actionPattern}[:\\s]+([A-Z0-9\\.&-]+)[\\s]+([0-9]+(?:\\.[0-9]+)?)`));
        if (fallbackMatch) {
          symbol = fallbackMatch[1].replace(/[^A-Z0-9-]/g, '').trim();
          entry = parseFloat(fallbackMatch[2]);
        }
      }
    }

    // --- STEP B: Generic Infographic Card Parsing (Runs if symbol/entry not found from text regex) ---
    
    // 1. Bracket Symbol Extractor e.g. [ PANAMAPET ], [ TCS ], ( RELIANCE ), [ DIXON ]
    if (!symbol) {
      const bracketSymbolMatch = cleanText.match(/(?:\[|\(|\{)\s*([A-Z0-9_-]{2,15})\s*(?:\]|\)|\})/i);
      const nonSymbolBrackets = ['CR', 'Q1', 'Q2', 'Q3', 'Q4', 'FY24', 'FY25', 'FY26', 'FY27', 'FY28', 'BUY', 'SELL', 'NSE', 'BSE'];
      if (bracketSymbolMatch && !nonSymbolBrackets.includes(bracketSymbolMatch[1].toUpperCase())) {
        symbol = bracketSymbolMatch[1].toUpperCase();
      }
    }

    // 2. Generic Header Scanning Extractor (Runs for ANY stock card when brackets are absent or OCR noise occurs)
    if (!symbol) {
      const lines = rawText.split(/[\r\n]+/).map(line => line.replace(/[^a-zA-Z0-9\s-]/g, ' ').trim()).filter(Boolean);
      
      const noiseWords = new Set([
        'METRIC', 'QOQ', 'YOY', 'PULSE', 'RATING', 'EXCELLENT', 'GOOD', 'POOR', 'FAIR', 'BUY', 'SELL',
        'LIMITED', 'LTD', 'INDUSTRIES', 'CORP', 'CORPORATION', 'HOLDINGS', 'FINANCE', 'BANK', 'INDIA',
        'PRODUCTS', 'LUBRICANTS', 'SERVICES', 'ENTERPRISES', 'IN', 'CR', 'CMP', 'PE', 'EPS', 'PAT', 'OPM', 'OP', 'SALES'
      ]);

      for (let i = 0; i < Math.min(3, lines.length); i++) {
        const words = lines[i].split(/\s+/).filter(w => w.length >= 3 && !noiseWords.has(w.toUpperCase()));
        if (words.length > 0) {
          const candidateTitle = words.slice(0, 3).join(' ').toUpperCase();
          if (candidateTitle.length >= 3) {
            symbol = candidateTitle;
            break;
          }
        }
      }
    }

    // 3. Pulse Rating Extractor e.g. Pulse Rating : Excellent / Good / Excellent Results
    const pulseRatingMatch = upperText.match(/(?:PULSE\s*RATING|RATING|RESULTS?)\s*[:=-]?\s*(EXCELLENT|VERY\s*GOOD|GOOD|FAIR|POOR|VERY\s*POOR)|(EXCELLENT|VERY\s*GOOD|GOOD)\s*RESULTS?/i);
    if (pulseRatingMatch) {
      cardRating = (pulseRatingMatch[1] || pulseRatingMatch[2]).toUpperCase();
      if (!action) {
        if (cardRating.includes('EXCELLENT') || cardRating.includes('GOOD')) {
          action = 'BUY';
        } else if (cardRating.includes('POOR')) {
          action = 'AVOID';
        }
      }
    }

    // 4. CMP (Current Market Price) Extractor e.g. CMP : 563.8 or CMP 1450.5
    if (!entry) {
      const cmpMatch = upperText.match(/\bCMP\s*[:=]?\s*([0-9,]+(?:\.[0-9]+)?)/);
      if (cmpMatch) {
        entry = parseFloat(cmpMatch[1].replace(/,/g, ''));
      }
    }

    // 5. Company Size & Market Cap Extractor e.g. Small-Cap (3.3K Cr) or Mid-Cap
    const capCategoryMatch = cleanText.match(/\b(Large-Cap|Mid-Cap|Small-Cap|Micro-Cap|Penny-Stock)\b/i);
    if (capCategoryMatch) {
      cardCategory = capCategoryMatch[1];
    }

    // 6. P/E Extractor e.g. P/E : 15.2
    const peMatch = upperText.match(/\bP\/?E\s*[:=]?\s*([0-9]+(?:\.[0-9]+)?)/);
    if (peMatch) {
      cardPe = parseFloat(peMatch[1]);
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
