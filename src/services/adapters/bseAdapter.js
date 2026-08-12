const axios = require('axios');

/**
 * Pluggable Modular BSE Announcement Adapter
 */
class BseAdapter {
  constructor() {
    this.name = 'BSE';
    this.userAgents = [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    ];
  }

  formatPdfUrl(file) {
    if (!file) return null;
    if (file.startsWith('http://') || file.startsWith('https://')) {
      return file;
    }
    return `https://www.bseindia.com/xml-data/corpfiling/AttachLive/${file}`;
  }

  async fetchAnnouncements() {
    try {
      const response = await axios.get('https://api.bseindia.com/BseIndiaAPI/api/AnnSubCategoryData/w?categoryId=-1&subCategoryId=-1&strType=C', {
        headers: {
          'User-Agent': this.userAgents[0],
          'Accept': 'application/json',
          'Origin': 'https://www.bseindia.com',
          'Referer': 'https://www.bseindia.com/',
        },
        timeout: 5000,
      });

      if (response.data && Array.isArray(response.data.Table)) {
        return response.data.Table.map(item => ({
          source: 'BSE',
          symbol: item.SLONGNAME || item.SCRIP_CD || 'BSE_STOCK',
          title: item.NEWSSUB || item.HEADLINE || 'Corporate Announcement',
          subject: item.HEADLINE || item.NEWSSUB || '',
          pdfUrl: this.formatPdfUrl(item.ATTACHMENTNAME),
          announcementId: item.NEWSID ? `BSE_${item.NEWSID}` : null,
          date: item.NEWS_DT || new Date().toISOString(),
        }));
      }
    } catch (_) {}
    return [];
  }
}

module.exports = new BseAdapter();
