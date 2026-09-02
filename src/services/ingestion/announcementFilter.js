/**
 * Intelligent Earnings Announcement Filter
 * Filters corporate announcements using primary inclusion keywords while strictly ignoring non-earnings noise.
 */
class AnnouncementFilter {
  constructor() {
    this.inclusionKeywords = [
      'financial results',
      'quarterly results',
      'standalone financial results',
      'consolidated financial results',
      'unaudited results',
      'audited results',
      'outcome of board meeting',
      'earnings',
      'q1 results',
      'q2 results',
      'q3 results',
      'q4 results',
      'half-yearly results',
      'annual results',
      'profit and loss',
      'balance sheet',
      'regulation 33',
      'reg 33',
      'reg. 33',
      'regulation33',
    ];

    this.exclusionKeywords = [
      'shareholding pattern',
      'insider trading',
      'agm',
      'egm',
      'loss of share certificate',
      'closure of trading window',
      'trading window closure',
      'credit rating',
      'voting results',
      'compliance certificate',
      'newspaper publication',
      'newspaper advertisement',
      'investor presentation',
      'earnings presentation',
      'analyst presentation',
      'press release',
      'media release',
      'audio recording',
      'transcript',
    ];
  }

  /**
   * Evaluate whether an announcement is a genuine financial earnings result
   * @param {object} item { title, subject, pdfUrl }
   * @returns {boolean}
   */
  isEarningsAnnouncement(item) {
    const rawText = `${item.title || ''} ${item.subject || ''} ${item.pdfUrl || ''}`.toLowerCase();
    // Normalize hyphens and underscores to spaces for robust keyword matching
    const textToMatch = rawText.replace(/[-_]/g, ' ');

    // 1. ABSOLUTE EXCLUSIONS (Never process these, even if they contain 'results')
    const absoluteExclusions = [
      'transcript',
      'audio recording',
      'video recording',
      'audio link',
      'recording intimation',
      'concall',
      'conference call',
      'investor call',
      'earnings call',
      'investor presentation',
      'earnings presentation',
      'analyst presentation',
      'loss of share certificate',
      'closure of trading window',
      'trading window closure'
    ];

    for (const exclusion of absoluteExclusions) {
      if (textToMatch.includes(exclusion)) {
        return false;
      }
    }

    // 2. EXPLICIT INCLUSIONS (Process these if they passed absolute exclusions)
    const primaryInclusions = [
      'financial results',
      'quarterly results',
      'standalone financial results',
      'consolidated financial results',
      'unaudited results',
      'audited results',
      'outcome of board meeting',
      'outcome of board',
      'regulation 33',
      'reg 33',
      'reg. 33',
      'regulation33'
    ];

    for (const keyword of primaryInclusions) {
      if (textToMatch.includes(keyword)) {
        return true;
      }
    }

    // 3. Default to false for anything else (noise)
    return false;
  }

  /**
   * Enforce hard filter: capCategory IN ['LARGE_CAP', 'MID_CAP', 'SMALL_CAP']
   * Rejects Micro Cap (< ₹500 Cr), Nano Cap, Unlisted, ETFs, Mutual Funds, Bonds, Indices.
   */
  isAllowedUniverse(marketCapCr, instrumentType = 'EQUITY') {
    const marketCapClassifier = require('../universe/marketCapClassifier');
    const classification = marketCapClassifier.classifyMarketCap(marketCapCr, instrumentType);
    return classification.isAllowed;
  }
}

module.exports = new AnnouncementFilter();
