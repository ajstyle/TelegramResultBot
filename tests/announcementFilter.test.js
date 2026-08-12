const announcementFilter = require('../src/services/ingestion/announcementFilter');

describe('Announcement Keyword Filter Unit Tests', () => {
  test('Passes valid financial results and outcome of board meeting announcements', () => {
    const item1 = {
      title: 'Outcome of Board Meeting - Unaudited Standalone Financial Results for Q3',
      subject: 'Financial Results Regulation 33',
    };

    const item2 = {
      title: 'TCS Q3 Earnings Presentation and Financial Highlights',
      subject: 'Investor Presentation',
    };

    expect(announcementFilter.isEarningsAnnouncement(item1)).toBe(true);
    expect(announcementFilter.isEarningsAnnouncement(item2)).toBe(true);
  });

  test('Filters out non-earnings compliance noise (shareholding pattern, insider trading, trading window)', () => {
    const noiseItem1 = {
      title: 'Shareholding Pattern for the quarter ended December 31',
      subject: 'Compliance Filing',
    };

    const noiseItem2 = {
      title: 'Closure of Trading Window Notice',
      subject: 'Insider Trading Regulation',
    };

    const noiseItem3 = {
      title: 'Intimation of Loss of Share Certificate',
      subject: 'Shareholder Services',
    };

    expect(announcementFilter.isEarningsAnnouncement(noiseItem1)).toBe(false);
    expect(announcementFilter.isEarningsAnnouncement(noiseItem2)).toBe(false);
    expect(announcementFilter.isEarningsAnnouncement(noiseItem3)).toBe(false);
  });
});
