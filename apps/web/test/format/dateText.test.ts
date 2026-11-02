import { addDays, asIsoDate, type IsoDate } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { formatIsoDate, parseDateText } from '../../src/format.js';

// Spec rev 55 §11 (WP20 Task 20.5): the new-search form's dates are shown and entered as "10 Jan 2027". Pure calendar
// arithmetic on the strings, run under test:tz in two other zones too, so no browser zone can move a day.

const TODAY = asIsoDate('2026-10-31');

describe('formatIsoDate (the one form a date is shown in, reused)', () => {
  it('"2027-01-10" is "10 Jan 2027"', () => {
    expect(formatIsoDate('2027-01-10')).toBe('10 Jan 2027');
  });
});

describe('parseDateText', () => {
  it.each<[string, string]>([
    ['10 Jan 2027', '2027-01-10'],
    ['10 january 2027', '2027-01-10'],
    [' 10 Jan 2027 ', '2027-01-10'],
    ['1 Jan 2027', '2027-01-01'],
    ['10 Sept 2027', '2027-09-10'],
    ['10 SEP 2027', '2027-09-10'],
    ['Jan 10 2027', '2027-01-10'],
    ['Jan 10, 2027', '2027-01-10'],
    ['2027-01-10', '2027-01-10'],
    ['29 Feb 2028', '2028-02-29'],
    ['10   Jan \t 2027', '2027-01-10'],
  ])('reads "%s" as %s', (text, iso) => {
    expect(parseDateText(text, TODAY)).toBe(iso);
  });

  it.each<[string, string]>([
    ['10 Jan', '2027-01-10'],
    ['Jan 10', '2027-01-10'],
    // today itself is its own next occurrence
    ['31 Oct', '2026-10-31'],
    ['1 Nov', '2026-11-01'],
    ['30 Oct', '2027-10-30'],
    // a day that exists only in a leap year is the next one that has it
    ['29 Feb', '2028-02-29'],
  ])('a day and month with no year, "%s", is its next occurrence on or after today: %s', (text, iso) => {
    expect(parseDateText(text, TODAY)).toBe(iso);
  });

  it('a 29 February with no year is found up to eight years ahead (2100 is no leap year)', () => {
    expect(parseDateText('29 Feb', asIsoDate('2096-03-01'))).toBe('2104-02-29');
  });

  it('the year-less date is echoed in the one shown form', () => {
    const iso = parseDateText('10 Jan', TODAY);
    expect(iso).not.toBeNull();
    expect(formatIsoDate(iso ?? '')).toBe('10 Jan 2027');
  });

  it.each([
    '10/01/2027',
    '31 Feb 2027',
    '29 Feb 2027',
    '10 Jan 27',
    'Jan',
    '',
    '   ',
    '0 Jan 2027',
    '32 Jan 2027',
    '10 Janu 2027',
    '10 Jan 2027 extra',
    '2027-1-10',
    '2027-13-01',
    '10 Jan 02027',
    // the whole text is the date, never a date inside other text
    'x10 Jan 2027',
    'Jan 10 2027x',
    'x2027-01-10',
    '2027-01-10x',
    '10 Smarch 2027',
    'Smarch 10',
  ])('refuses "%s"', (text) => {
    expect(parseDateText(text, TODAY)).toBeNull();
  });

  it('round-trips every date of 2027 and 2028 through the shown form', () => {
    let d: IsoDate = asIsoDate('2027-01-01');
    const misses: string[] = [];
    let n = 0;
    while (d <= '2028-12-31') {
      if (parseDateText(formatIsoDate(d), TODAY) !== d) misses.push(d);
      d = addDays(d, 1);
      n += 1;
    }
    expect(n).toBe(365 + 366);
    expect(misses).toEqual([]);
  });
});
