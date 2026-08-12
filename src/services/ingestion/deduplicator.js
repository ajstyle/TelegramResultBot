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
   * Generate normalized SHA-256 hash for an announcement
   * @param {object} item { symbol, text, source, date }
   * @returns {string}
   */
  generateHash(item) {
    const symbol = (item.symbol || '').toUpperCase().trim();
    const cleanText = (item.text || item.title || item.caption || '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
    
    // Hash first 150 normalized characters + symbol
    const contentKey = `${symbol}:${cleanText.slice(0, 150)}`;
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
