const axios = require('axios');

/**
 * Pluggable Modular NSE Announcement Adapter
 */
class NseAdapter {
  constructor() {
    this.name = 'NSE';
    this.userAgents = [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    ];
  }

  getRandomUserAgent() {
    return this.userAgents[Math.floor(Math.random() * this.userAgents.length)];
  }

  formatPdfUrl(file) {
    if (!file) return null;
    if (file.startsWith('http://') || file.startsWith('https://')) {
      return file;
    }
    return `https://archives.nseindia.com/corporate/announcements/${file}`;
  }

  async fetchAnnouncements() {
    try {
      const response = await axios.get(`https://www.nseindia.com/api/corporate-announcements?index=equities&_t=${Date.now()}`, {
        headers: {
          'User-Agent': this.getRandomUserAgent(),
          'Accept': 'application/json, text/plain, */*',
          'Referer': 'https://www.nseindia.com/companies-listing/corporate-filings-announcements',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0',
        },
        timeout: 5000,
      });

      if (Array.isArray(response.data)) {
        return response.data.map(item => ({
          source: 'NSE',
          symbol: item.symbol || item.sm_symbol || 'NSE_STOCK',
          title: item.desc || item.attchmntText || 'Corporate Announcement',
          subject: item.attchmntText || item.desc || '',
          pdfUrl: this.formatPdfUrl(item.attchmntFile || item.attachmentFile || item.file),
          announcementId: item.an_dt ? `NSE_${item.symbol}_${item.an_dt}` : null,
          date: item.an_dt || new Date().toISOString(),
        }));
      }
    } catch (_) {}
    return [];
  }
}

module.exports = new NseAdapter();
