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
      'q1',
      'q2',
      'q3',
      'q4',
      'q1 results',
      'q2 results',
      'q3 results',
      'q4 results',
      'half-yearly results',
      'annual results',
      'profit and loss',
      'balance sheet',
      'investor presentation',
      'earnings presentation',
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
    ];
  }

  /**
   * Evaluate whether an announcement is earnings-related
   * @param {object} item { title, subject, pdfUrl }
   * @returns {boolean}
   */
  isEarningsAnnouncement(item) {
    const textToMatch = `${item.title || ''} ${item.subject || ''} ${item.pdfUrl || ''}`.toLowerCase();

    // 1. Check for explicit exclusions
    for (const keyword of this.exclusionKeywords) {
      if (textToMatch.includes(keyword)) {
        return false;
      }
    }

    // 2. Check for primary inclusion keywords
    for (const keyword of this.inclusionKeywords) {
      if (textToMatch.includes(keyword)) {
        return true;
      }
    }

    return false;
  }
}

module.exports = new AnnouncementFilter();
