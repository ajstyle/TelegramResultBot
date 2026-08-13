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

  async getCookies() {
    try {
      const res = await axios.get('https://www.nseindia.com', {
        headers: {
          'User-Agent': this.getRandomUserAgent(),
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        },
        timeout: 4000,
      });
      if (res.headers['set-cookie']) {
        this.cookies = res.headers['set-cookie'].map(c => c.split(';')[0]).join('; ');
      }
    } catch (_) {}
  }

  async fetchAnnouncements() {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const headers = {
          'User-Agent': this.getRandomUserAgent(),
          'Accept': 'application/json, text/plain, */*',
          'Referer': 'https://www.nseindia.com/companies-listing/corporate-filings-announcements',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
        };
        if (this.cookies) {
          headers['Cookie'] = this.cookies;
        }

        const response = await axios.get(`https://www.nseindia.com/api/corporate-announcements?index=equities&_t=${Date.now()}`, {
          headers,
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
      } catch (err) {
        if (attempt === 0) {
          await this.getCookies();
        }
      }
    }
    return [];
  }
}

module.exports = new NseAdapter();
