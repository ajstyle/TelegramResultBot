const announcementFilter = require('../src/services/ingestion/announcementFilter');

describe('Announcement Keyword Filter Unit Tests', () => {
  test('Passes valid financial results and outcome of board meeting announcements', () => {
    const item1 = {
      title: 'Outcome of Board Meeting - Unaudited Standalone Financial Results for Q3',
      subject: 'Financial Results Regulation 33',
    };

    const item2 = {
      title: 'TCS Q3 Standalone and Consolidated Financial Results',
      subject: 'Financial Results Regulation 33',
    };

    expect(announcementFilter.isEarningsAnnouncement(item1)).toBe(true);
    expect(announcementFilter.isEarningsAnnouncement(item2)).toBe(true);
  });

  test('Filters out non-earnings compliance noise (shareholding pattern, insider trading, trading window, investor presentation)', () => {
    const noiseItem1 = {
      title: 'Shareholding Pattern for the quarter ended December 31',
      subject: 'Compliance Filing',
    };

    const noiseItem2 = {
      title: 'Closure of Trading Window Notice',
      subject: 'Insider Trading Regulation',
    };

    const noiseItem3 = {
      title: 'Loss of Share Certificate Notice',
      subject: 'Reg 39(3)',
    };

    const noiseItem4 = {
      title: 'Bata India Ltd - Announcement under Regulation 30 - Investor Presentation',
      subject: 'Investor Presentation',
    };

    expect(announcementFilter.isEarningsAnnouncement(noiseItem1)).toBe(false);
    expect(announcementFilter.isEarningsAnnouncement(noiseItem2)).toBe(false);
    expect(announcementFilter.isEarningsAnnouncement(noiseItem3)).toBe(false);
    expect(announcementFilter.isEarningsAnnouncement(noiseItem4)).toBe(false);
  });
});
