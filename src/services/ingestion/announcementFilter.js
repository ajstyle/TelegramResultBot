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
    // Normalize hyphens and underscores to spaces for robust keyword matching (e.g. audio-recording -> audio recording)
    const textToMatch = rawText.replace(/[-_]/g, ' ');

    // 1. Check for strict non-earnings noise exclusions FIRST to reject concalls, presentations, audio links & intimations
    const strictExclusions = [
      'shareholding pattern',
      'insider trading',
      'loss of share certificate',
      'closure of trading window',
      'trading window closure',
      'trading window',
      'compliance certificate',
      'audio recording',
      'video recording',
      'recording intimation',
      'audio link',
      'recording link',
      'transcript',
      'concall',
      'conference call',
      'investor call',
      'earnings call',
      'analyst call',
      'investor presentation',
      'earnings presentation',
      'analyst presentation',
      'investor meet',
      'analyst meet',
      'newspaper publication',
      'newspaper advertisement',
      'newspaper',
      'advertisement',
      'clipping',
      'press release',
      'media release',
      'fact sheet',
      'credit rating',
      'allotment',
      'appointment',
      'resignation',
      'incorporation',
      'change in director',
      'change in management',
      'registered office',
      'acquisition',
      'strike off',
      'update',
      'schedule of analyst',
      'schedule of investor',
      'record date',
      'postal ballot',
      'scrutinizer',
      'voting result',
      'scheme of arrangement',
      'amalgamation',
      'memorandum of association',
      'articles of association',
      'issue of shares',
      'right issue',
      'bonus issue',
      'buyback',
    ];

    for (const exclusion of strictExclusions) {
      if (textToMatch.includes(exclusion)) {
        return false; // Explicit non-earnings noise announcement
      }
    }

    // 2. Check for explicit financial result inclusion keywords
    const primaryInclusions = [
      'financial results',
      'quarterly results',
      'standalone financial results',
      'consolidated financial results',
      'unaudited results',
      'audited results',
      'outcome of board meeting',
      'regulation 33',
      'reg 33',
      'reg. 33',
      'regulation33',
    ];

    for (const keyword of primaryInclusions) {
      if (textToMatch.includes(keyword)) {
        return true; // Valid financial earnings result
      }
    }

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
