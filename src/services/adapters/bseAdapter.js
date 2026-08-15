const https = require('https');

/**
 * Pluggable Modular BSE Announcement Adapter
 * Filters corporate announcements for tradable equity scrips, resolves company stock names, and handles PDF URLs.
 */
class BseAdapter {
  constructor() {
    this.name = 'BSE';
  }

  /**
   * Resolve exact BSE filing PDF URL dynamically by querying BSE CorpAnnouncementDTNewDataBeta API
   */
  resolvePdfUrl(attachmentName, newsid) {
    return new Promise((resolve) => {
      if (attachmentName) {
        if (attachmentName.startsWith('http://') || attachmentName.startsWith('https://')) {
          return resolve(attachmentName);
        }
        if (!attachmentName.includes('&') && attachmentName.toLowerCase().endsWith('.pdf')) {
          return resolve(`https://www.bseindia.com/xml-data/corpfiling/AttachLive/${attachmentName}`);
        }
      }

      let guid = null;
      if (attachmentName) {
        const match = attachmentName.match(/([a-f0-9-]{36})/i);
        if (match) guid = match[1];
      }
      if (!guid && newsid) {
        const match = newsid.match(/([a-f0-9-]{36})/i);
        if (match) guid = match[1];
      }

      if (!guid) {
        return resolve(null);
      }

      const options = {
        hostname: 'api.bseindia.com',
        path: `/BseIndiaAPI/api/CorpAnnouncementDTNewDataBeta/w?newsid=${guid}`,
        method: 'GET',
        insecureHTTPParser: true,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
          'Accept': 'application/json, text/plain, */*',
          'Origin': 'https://www.bseindia.com',
          'Referer': 'https://www.bseindia.com/',
        },
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (json && json.Table && json.Table.length > 0) {
              const item = json.Table[0];
              if (item.PDF_Link) {
                const fullUrl = item.PDF_Link.startsWith('http')
                  ? item.PDF_Link
                  : `https://www.bseindia.com${item.PDF_Link.startsWith('/') ? '' : '/'}${item.PDF_Link}`;
                return resolve(fullUrl);
              }
              if (item.AttachmentName) {
                return resolve(`https://www.bseindia.com/xml-data/corpfiling/AttachLive/${item.AttachmentName}`);
              }
            }
          } catch (_) {}
          resolve(null);
        });
      });

      req.on('error', () => resolve(null));
      req.setTimeout(5000, () => {
        req.destroy();
        resolve(null);
      });
      req.end();
    });
  }

  formatPdfUrl(attachmentName, newsid) {
    if (newsid) {
      const match = newsid.match(/([a-f0-9-]{36})/i);
      if (match) {
        return `https://www.bseindia.com/corporates/anndet_new.aspx?newsid=${match[1]}`;
      }
    }
    if (attachmentName) {
      if (attachmentName.startsWith('http://') || attachmentName.startsWith('https://')) {
        return attachmentName;
      }
      const match = attachmentName.match(/([a-f0-9-]{36})/i);
      if (match) {
        return `https://www.bseindia.com/corporates/anndet_new.aspx?newsid=${match[1]}`;
      }
      return `https://www.bseindia.com/xml-data/corpfiling/AttachLive/${attachmentName}`;
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

  /**
   * Extract Company Stock Name from announcement headline
   */
  extractCompanyName(title, fallback = '') {
    if (title) {
      const cleaned = title.replace(/^[\d\s-:]+/, '');
      const parts = cleaned.split(/\s*-\s*|\s*:\s*|\s*Outcome\s*|\s*Announcement\s*/i);
      if (parts[0] && parts[0].trim().length > 2) {
        const candidate = parts[0].trim().toUpperCase();
        if (!/^\d+$/.test(candidate)) {
          return candidate;
        }
      }
    }
    return fallback;
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
        res.on('end', async () => {
          try {
            const list = JSON.parse(data);
            if (Array.isArray(list)) {
              const rawFiltered = list.filter((item) => {
                const newsIdStr = item.Newsid || item.NEWSID || item.NEWS_ID || '';
                const scripMatch = newsIdStr.match(/scrip_CD=(\d+)/i);
                const scripCode = scripMatch ? scripMatch[1] : (item.SCRIP_CD || item.SLONGNAME || '');
                return this.isEquityScrip(scripCode, item.Subject || item.NEWSSUB || item.HEADLINE || '');
              });

              const announcements = await Promise.all(
                rawFiltered.map(async (item) => {
                  const newsIdStr = item.Newsid || item.NEWSID || item.NEWS_ID || '';
                  const scripMatch = newsIdStr.match(/scrip_CD=(\d+)/i);
                  const scripCode = scripMatch ? scripMatch[1] : (item.SCRIP_CD || item.SLONGNAME || 'BSE_STOCK');

                  const rawTitle = item.Subject || item.NEWSSUB || item.HEADLINE || 'Corporate Announcement';
                  const companyName = this.extractCompanyName(rawTitle, item.SLONGNAME || item.SHORT_NAME || '');

                  const finalSymbol = (companyName && !/^\d+$/.test(companyName)) ? companyName : scripCode;
                  const cleanNewsId = newsIdStr.split('&')[0] || `${Date.now()}_${Math.random()}`;

                  const attachName = item.ATTACHMENTNAME || item.AttachmentName;
                  const pdfUrl = await this.resolvePdfUrl(attachName, newsIdStr);

                  return {
                    source: 'BSE',
                    symbol: finalSymbol,
                    scripCode: scripCode,
                    title: rawTitle,
                    subject: item.Subject || item.HEADLINE || '',
                    pdfUrl: pdfUrl,
                    announcementId: `BSE_${cleanNewsId}`,
                    date: item.NEWS_DT || item.News_dt || new Date().toISOString(),
                  };
                })
              );

              return resolve(announcements);
            }
          } catch (_) {}
          resolve([]);
        });
      });

      req.on('error', () => resolve([]));
      req.setTimeout(8000, () => {
        req.destroy();
        resolve([]);
      });
      req.end();
    });
  }
}

module.exports = new BseAdapter();
