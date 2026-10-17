import { asIsoDate, asIsoMonth } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import {
  formatDayOfMonth,
  formatDayShort,
  formatInstantDateLondon,
  formatInstantLondon,
  formatIsoDateLong,
  formatIsoMonth,
  monthDays,
  WEEK_HEADERS,
  weekdayIndex,
} from '../../src/format.js';

const d = asIsoDate;

describe('WP10’s date forms in WP9’s format.ts (spec §6.1, review focus 3, decisions 38, 46)', () => {
  it('weekday from the epoch day, Monday = 0, negative epoch days included', () => {
    expect(weekdayIndex(d('1970-01-01'))).toBe(3); // Thursday
    expect(weekdayIndex(d('2027-03-01'))).toBe(0); // Monday
    expect(weekdayIndex(d('2027-03-14'))).toBe(6); // Sunday, the US DST change
    expect(weekdayIndex(d('2027-03-28'))).toBe(6); // Sunday, the UK DST change
    expect(weekdayIndex(d('1969-12-31'))).toBe(2); // Wednesday
  });
  it('the grid forms read WP9’s one month and weekday table (decision 46)', () => {
    expect(WEEK_HEADERS).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
    expect(formatDayShort(d('2027-03-14'))).toBe('Sun 14 Mar');
    expect(formatIsoDateLong(d('2027-03-14'))).toBe('Sun 14 Mar 2027');
    expect(formatIsoDateLong(d('2028-02-29'))).toBe('Tue 29 Feb 2028');
    expect(formatDayOfMonth(d('2027-03-04'))).toBe('4');
    expect(formatIsoMonth(asIsoMonth('2027-03'))).toBe('Mar 2027');
  });
  it('lists the days of a month, leap February included', () => {
    expect(monthDays(asIsoMonth('2027-02'))).toHaveLength(28);
    const leap = monthDays(asIsoMonth('2028-02'));
    expect(leap).toHaveLength(29);
    expect(leap[28]).toBe('2028-02-29');
  });
  it('formats instants in Europe/London whatever the process zone, with the year', () => {
    expect(formatInstantLondon(Date.UTC(2027, 2, 14, 15))).toBe('14 Mar 2027 15:00'); // GMT
    expect(formatInstantLondon(Date.UTC(2027, 6, 1, 15))).toBe('1 Jul 2027 16:00'); // BST
    expect(formatInstantDateLondon(Date.UTC(2027, 2, 28, 23, 30))).toBe('29 Mar 2027'); // BST: already the 29th
  });
});
