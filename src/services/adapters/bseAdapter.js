const https = require('https');

/**
 * Pluggable Modular BSE Announcement Adapter
 * Filters corporate announcements for tradable equity scrips and handles PDF URL resolution.
 */
class BseAdapter {
  constructor() {
    this.name = 'BSE';
  }

  formatPdfUrl(attachmentName, newsid) {
    if (attachmentName) {
      if (attachmentName.startsWith('http://') || attachmentName.startsWith('https://')) {
        return attachmentName;
      }
      return `https://www.bseindia.com/xml-data/corpfiling/AttachLive/${attachmentName}`;
    }
    if (newsid) {
      const match = newsid.match(/([a-f0-9-]{36})/i);
      if (match) {
        return `https://www.bseindia.com/xml-data/corpfiling/AttachLive/${match[1]}.pdf`;
      }
    }
    return null;
  }

  /**
   * Filter out non-tradable debt/debenture instruments
   */
  isEquityScrip(scripCode, title = '') {
    if (!scripCode) return true;
    const scripStr = scripCode.toString();
    if (scripStr.startsWith('73') || scripStr.startsWith('71') || scripStr.startsWith('72')) {
      return false;
    }
    const t = title.toLowerCase();
    if (t.includes('debenture') || t.includes('commercial paper') || t.includes('ncd') || t.includes('subordinated debt')) {
      return false;
    }
    return true;
  }

  fetchAnnouncements() {
    return new Promise((resolve) => {
      const options = {
        hostname: 'api.bseindia.com',
        path: `/BseIndiaAPI/api/CorpAnn/w?scripcode=&cat=&subcat=&_t=${Date.now()}`,
        method: 'GET',
        insecureHTTPParser: true,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
          'Accept': 'application/json, text/plain, */*',
          'Origin': 'https://www.bseindia.com',
          'Referer': 'https://www.bseindia.com/',
          'Cache-Control': 'no-cache',
        },
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            const list = JSON.parse(data);
            if (Array.isArray(list)) {
              const announcements = list
                .filter((item) => {
                  const newsIdStr = item.Newsid || item.NEWSID || item.NEWS_ID || '';
                  const scripMatch = newsIdStr.match(/scrip_CD=(\d+)/i);
                  const scripCode = scripMatch ? scripMatch[1] : (item.SCRIP_CD || item.SLONGNAME || '');
                  return this.isEquityScrip(scripCode, item.Subject || item.NEWSSUB || item.HEADLINE || '');
                })
                .map((item) => {
                  const newsIdStr = item.Newsid || item.NEWSID || item.NEWS_ID || '';
                  const scripMatch = newsIdStr.match(/scrip_CD=(\d+)/i);
                  const scripCode = scripMatch ? scripMatch[1] : (item.SCRIP_CD || item.SLONGNAME || 'BSE_STOCK');
                  const symbolCandidate = item.SLONGNAME || item.SHORT_NAME || scripCode;

                  const cleanNewsId = newsIdStr.split('&')[0] || `${Date.now()}_${Math.random()}`;

                  return {
                    source: 'BSE',
                    symbol: symbolCandidate,
                    title: item.Subject || item.NEWSSUB || item.HEADLINE || 'Corporate Announcement',
                    subject: item.Subject || item.HEADLINE || '',
                    pdfUrl: this.formatPdfUrl(item.ATTACHMENTNAME || item.AttachmentName, newsIdStr),
                    announcementId: `BSE_${cleanNewsId}`,
                    date: item.NEWS_DT || item.News_dt || new Date().toISOString(),
                  };
                });
              return resolve(announcements);
            }
          } catch (_) {}
          resolve([]);
        });
      });

      req.on('error', () => resolve([]));
      req.setTimeout(6000, () => {
        req.destroy();
        resolve([]);
      });
      req.end();
    });
  }
}

module.exports = new BseAdapter();
