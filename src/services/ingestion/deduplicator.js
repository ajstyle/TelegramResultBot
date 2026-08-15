const crypto = require('crypto');

/**
 * Cross-Source Announcement Deduplicator
 * Filters out duplicate announcements arriving from NSE, BSE, or Telegram channels.
 */
class AnnouncementDeduplicator {
  constructor(ttlMs = 24 * 60 * 60 * 1000) {
    this.seenHashes = new Map(); // hash -> timestamp
    this.ttlMs = ttlMs;
  }

  /**
   * Clean up expired entries in cache
   */
  cleanup() {
    const now = Date.now();
    for (const [hash, timestamp] of this.seenHashes.entries()) {
      if (now - timestamp > this.ttlMs) {
        this.seenHashes.delete(hash);
      }
    }
  }

  /**
   * Resolve symbol/scripCode to a canonical key for cross-exchange matching
   */
  getCanonicalKey(item) {
    const scripMap = {
      '500227': 'JINDALPOLY',
      'JINDALPOLY': 'JINDALPOLY',
      '534675': 'PROZONER',
      'PROZONER': 'PROZONER',
      'PROZONE': 'PROZONER',
      '532540': 'TCS',
      'TCS': 'TCS',
      '500209': 'INFY',
      'INFY': 'INFY',
      '500180': 'HDFCBANK',
      'HDFCBANK': 'HDFCBANK',
      '532667': 'SUZLON',
      'SUZLON': 'SUZLON',
    };

    const rawSym = (item.symbol || '').toUpperCase().trim();
    const rawScrip = (item.scripCode || '').toString().trim();

    if (scripMap[rawScrip]) return scripMap[rawScrip];
    if (scripMap[rawSym]) return scripMap[rawSym];

    // Fallback: extract first 7 clean alphanumeric characters of symbol/title
    const cleanSym = rawSym.replace(/[^A-Z0-9]/g, '');
    if (cleanSym.length >= 3) return cleanSym.slice(0, 10);
    
    const cleanTitle = (item.title || item.text || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    return cleanTitle.slice(0, 12);
  }

  /**
   * Generate normalized SHA-256 hash for an announcement
   * @param {object} item { symbol, scripCode, text, title, date }
   * @returns {string}
   */
  generateHash(item) {
    const canonicalKey = this.getCanonicalKey(item);
    const dateStr = item.date ? new Date(item.date).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
    
    // Extract quarter indicator if present (e.g. Q1, Q2, Q3, Q4, Financial Results, Outcome of Board Meeting)
    const rawText = (item.title || item.text || item.caption || '').toLowerCase();
    const isQuarterResult = rawText.includes('financial result') || rawText.includes('board meeting') || rawText.includes('outcome') || rawText.includes('quarter');
    const resultTag = isQuarterResult ? 'earnings_result' : rawText.slice(0, 50);

    const contentKey = `${canonicalKey}:${dateStr}:${resultTag}`;
    return crypto.createHash('sha256').update(contentKey).digest('hex');
  }

  /**
   * Check if an announcement is unique (not seen before)
   * @param {object} item
   * @returns {boolean} true if unique, false if duplicate
   */
  isUnique(item) {
    this.cleanup();
    const hash = this.generateHash(item);

    if (this.seenHashes.has(hash)) {
      return false;
    }

    this.seenHashes.set(hash, Date.now());
    return true;
  }
}

module.exports = new AnnouncementDeduplicator();
