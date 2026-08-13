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
   * Evaluate whether an announcement is earnings-related
   * @param {object} item { title, subject, pdfUrl }
   * @returns {boolean}
   */
  isEarningsAnnouncement(item) {
    const textToMatch = `${item.title || ''} ${item.subject || ''} ${item.pdfUrl || ''}`.toLowerCase();

    // 1. Check for explicit inclusion keywords FIRST
    let hasInclusion = false;
    for (const keyword of this.inclusionKeywords) {
      if (textToMatch.includes(keyword)) {
        hasInclusion = true;
        break;
      }
    }

    if (!hasInclusion) {
      return false;
    }

    // 2. Check for strict non-earnings noise exclusions (shareholding, trading window, loss of certificate)
    const strictExclusions = [
      'shareholding pattern',
      'insider trading',
      'loss of share certificate',
      'closure of trading window',
      'trading window closure',
      'compliance certificate',
      'audio recording',
      'transcript',
    ];

    for (const exclusion of strictExclusions) {
      if (textToMatch.includes(exclusion)) {
        return false;
      }
    }

    return true;
  }
}

module.exports = new AnnouncementFilter();
