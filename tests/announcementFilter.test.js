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

    const intimationItem = {
      title: 'Housing & Urban Development Corporation Ltd - Board Meeting Intimation for Consideration Of Financial Results And Dividend',
      subject: 'Financial Results',
    };

    const outcomeItem = {
      title: 'Housing & Urban Development Corporation Ltd - Intimation of Outcome of Board Meeting - Financial Results',
      subject: 'Financial Results',
    };

    expect(announcementFilter.isEarningsAnnouncement(noiseItem1)).toBe(false);
    expect(announcementFilter.isEarningsAnnouncement(noiseItem2)).toBe(false);
    expect(announcementFilter.isEarningsAnnouncement(noiseItem3)).toBe(false);
    expect(announcementFilter.isEarningsAnnouncement(noiseItem4)).toBe(false);
    expect(announcementFilter.isEarningsAnnouncement(intimationItem)).toBe(false);
    expect(announcementFilter.isEarningsAnnouncement(outcomeItem)).toBe(true);
  });

  test('Strictly excludes newspaper publications, cuttings, advertisements, and press releases (LUMAXIND issue)', () => {
    // Exact LUMAXIND newspaper publication filing from NSE
    const lumaxItem = {
      title: 'Copy of Newspaper Publication',
      subject: 'Submission of the Newspaper cuttings of publication of Un- Audited Financial results for 2nd Quarter and Half Year ended September 30, 2026.',
    };

    const reg47Item = {
      title: 'Regulation 47 - Newspaper Publication of Financial Results',
      subject: 'Newspaper clipping of Q2 financial results published in Financial Express',
    };

    const pressReleaseItem = {
      title: 'Press Release on Q2 Financial Results',
      subject: 'Company reports robust revenue growth in Q2 financial results',
    };

    const corrigendumItem = {
      title: 'Corrigendum to Financial Results',
      subject: 'Errata in notes to standalone financial results',
    };

    expect(announcementFilter.isEarningsAnnouncement(lumaxItem)).toBe(false);
    expect(announcementFilter.isEarningsAnnouncement(reg47Item)).toBe(false);
    expect(announcementFilter.isEarningsAnnouncement(pressReleaseItem)).toBe(false);
    expect(announcementFilter.isEarningsAnnouncement(corrigendumItem)).toBe(false);
  });
});
