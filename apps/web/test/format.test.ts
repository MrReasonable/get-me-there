import { asIsoDate } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import {
  formatInstantUtc,
  formatIsoDate,
  formatIsoDateLong,
  formatIsoDateShort,
  formatLocalDateTime,
  formatMicroGbp,
  formatMinutes,
  formatSeconds,
  formatWeekday,
  parsePoundsToPence,
  penceToPoundsInput,
} from '../src/format.js';

describe('the one date-formatting module (decision 38; WP10 imports it)', () => {
  it('date and short forms from the YYYY-MM-DD string, never through Date', () => {
    expect(formatIsoDateShort('2027-03-14')).toBe('14 Mar');
    expect(formatIsoDateShort('not a date')).toBe('not a date');
    expect(formatIsoDate('2027-03-14')).toBe('14 Mar 2027');
    expect(formatIsoDate('2027-12-01')).toBe('1 Dec 2027');
    expect(formatIsoDate('not a date')).toBe('not a date');
  });

  it('long form adds the weekday from epoch-day arithmetic, across month, year and leap boundaries', () => {
    expect(formatIsoDateLong(asIsoDate('2027-03-14'))).toBe('Sun 14 Mar 2027');
    expect(formatIsoDateLong(asIsoDate('1970-01-01'))).toBe('Thu 1 Jan 1970');
    expect(formatIsoDateLong(asIsoDate('1969-12-31'))).toBe('Wed 31 Dec 1969');
    expect(formatIsoDateLong(asIsoDate('2028-02-29'))).toBe('Tue 29 Feb 2028');
    expect(formatWeekday(asIsoDate('2027-03-15'))).toBe('Mon');
  });

  it('a run instant is labelled UTC and never shifted; segment times are airport wall time', () => {
    expect(formatInstantUtc('2026-10-14T12:00:00.000Z')).toBe('14 Oct 2026 12:00 UTC');
    expect(formatLocalDateTime('2027-03-14T10:25')).toBe('14 Mar 10:25');
    expect(formatLocalDateTime('2027-03-14')).toBe('2027-03-14');
  });

  it('durations', () => {
    expect([formatMinutes(905), formatSeconds(45), formatSeconds(720), formatSeconds(7500)]).toEqual([
      '15h 05m',
      '45s',
      '12m',
      '2h 05m',
    ]);
  });
});

describe('money in pounds, held as integer pence', () => {
  it('parses pounds without floating point and refuses anything else', () => {
    expect(['12', '12.5', '12.50', ' 0.07 ', '', '12.345', '-1', '£12'].map(parsePoundsToPence)).toEqual([
      1200,
      1250,
      1250,
      7,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  it('round-trips pence to an editable pounds string', () => {
    expect([penceToPoundsInput(undefined), penceToPoundsInput(41200), penceToPoundsInput(2550)]).toEqual([
      '',
      '412',
      '25.50',
    ]);
  });

  it('micro-GBP rounds up, so a cost is never understated, and refuses non-integers', () => {
    expect(formatMicroGbp(12_345)).toBe('£0.02');
    expect(() => formatMicroGbp(1.5)).toThrow(RangeError);
  });
});
