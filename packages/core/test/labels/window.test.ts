// Revision 74: a search's dates in words, one set for the Trips card, the search page and the Status data check.
import { describe, expect, it } from 'vitest';
import {
  dateWords,
  dateWordsShort,
  leaveWords,
  rollingDaysWords,
  rollingMonthsWords,
  windowSpanWords,
  windowWords,
} from '../../src/labels/window.js';
import { asIsoDate } from '../../src/types/ids.js';

describe('dateWords', () => {
  it('words a date with and without its year, by slicing', () => {
    expect(dateWords('2027-03-04')).toBe('4 Mar 2027');
    expect(dateWords('2026-12-15')).toBe('15 Dec 2026');
    expect(dateWordsShort('2027-03-04')).toBe('4 Mar');
    expect(dateWordsShort('2027-01-31')).toBe('31 Jan');
  });
  it('returns anything malformed as given', () => {
    for (const d of ['', '2027', '2027-13-01', '2027-00-01', '2027-03']) {
      expect(dateWords(d)).toBe(d);
      expect(dateWordsShort(d)).toBe(d);
    }
  });
});

describe('windowSpanWords', () => {
  it('leaves the years out inside one year and names them across two', () => {
    expect(windowSpanWords('2027-01-10', '2027-03-31')).toBe('10 Jan – 31 Mar');
    expect(windowSpanWords('2026-12-15', '2027-06-15')).toBe('15 Dec 2026 – 15 Jun 2027');
  });
});

describe('windowWords', () => {
  it('words each kind of window as the Trips card does', () => {
    expect(
      windowWords({ kind: 'absolute', from: asIsoDate('2026-12-15'), to: asIsoDate('2027-06-15') }),
    ).toBe('leave 15 Dec 2026 – 15 Jun 2027');
    expect(
      windowWords({ kind: 'absolute', from: asIsoDate('2027-01-10'), to: asIsoDate('2027-03-31') }),
    ).toBe('leave 10 Jan – 31 Mar');
    expect(windowWords({ kind: 'relative', startOffsetDays: 7, lengthDays: 182 })).toBe(
      'rolling: 182 days from 7 days ahead',
    );
    expect(windowWords({ kind: 'months', startOffsetDays: 14, lengthMonths: 3 })).toBe(
      'rolling: 3 months from 14 days ahead',
    );
  });
  it('says one day and one month in the singular', () => {
    expect(rollingDaysWords(1, 1)).toBe('rolling: 1 day from 1 day ahead');
    expect(rollingMonthsWords(1, 1)).toBe('rolling: 1 month from 1 day ahead');
    expect(leaveWords('10 Jan – 31 Mar')).toBe('leave 10 Jan – 31 Mar');
  });
});
