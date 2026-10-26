// WP15 Task 15.2: the date grid's dated grammar (observed 2026-10-18 in the --grid recordings): cell names, day labels,
// the selected-pair line and the year rule. Synthetic strings in the recorded forms.
import { asIsoDate } from '@gmt/core';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  dayLabels,
  monthOf,
  parseCellName,
  parseSelectedPrice,
  parseSelectedRange,
  parseUnpricedCellName,
  resolveDay,
  weekdayMatches,
  weekdayOf,
} from '../src/gridNames.js';

beforeEach(() => {
  expect.hasAssertions();
});

describe('parseCellName', () => {
  it.each([
    ['£457, 11 Mar to 21 Mar', { pounds: 457, mark: 'none', selected: false, dep: [11, 3], ret: [21, 3] }],
    [
      '£397, cheapest price, 15 Mar to 23 Mar',
      { pounds: 397, mark: 'cheapest', selected: false, dep: [15, 3], ret: [23, 3] },
    ],
    [
      '£485, low price, 24 Dec to 3 Jan',
      { pounds: 485, mark: 'low', selected: false, dep: [24, 12], ret: [3, 1] },
    ],
    [
      '£462, 14 Mar to 24 Mar, selected',
      { pounds: 462, mark: 'none', selected: true, dep: [14, 3], ret: [24, 3] },
    ],
    [
      '£1,308, 18 Oct to 20 Oct',
      { pounds: 1308, mark: 'none', selected: false, dep: [18, 10], ret: [20, 10] },
    ],
    ['£843, 20 Oct to 20 Oct', { pounds: 843, mark: 'none', selected: false, dep: [20, 10], ret: [20, 10] }],
    [
      '£12,345, 2 Apr to 12 Apr',
      { pounds: 12_345, mark: 'none', selected: false, dep: [2, 4], ret: [12, 4] },
    ],
  ])('%s parses', (name, want) => {
    const c = parseCellName(name);
    expect(
      c && {
        pounds: c.pounds,
        mark: c.mark,
        selected: c.selected,
        dep: [c.dep.day, c.dep.month],
        ret: [c.ret.day, c.ret.month],
      },
    ).toEqual(want);
  });
  it.each([
    '£397, 15 Mar to 23 Mar, cheapest price',
    '£462, selected, 14 Mar to 24 Mar',
    '397, 15 Mar to 23 Mar',
    '£0, 15 Mar to 23 Mar',
    '£1308, 18 Oct to 20 Oct',
    '£1,30, 18 Oct to 20 Oct',
    '£457, 11 Mar - 21 Mar',
    '£457, 11 Mzr to 21 Mar',
    '£457, 32 Mar to 21 Mar',
    '£457, 0 Mar to 21 Mar',
    '£457, 31 Apr to 2 May',
    '£457, 11 Apr to 31 Apr',
    'No price, 11 Mar to 21 Mar',
    '—, 11 Mar to 21 Mar',
    '',
  ])('%j is unparsed, never guessed', (name) => {
    expect(parseCellName(name)).toBeNull();
  });
});

// why: spec §2 "Cells by name": the unpriced forms grid/2026-10-26/7 and 8 recorded, each a button naming its pair
describe('parseUnpricedCellName', () => {
  it.each([
    ['no flights, 14 Nov to 20 Nov', { status: 'no-flights', dep: [14, 11], ret: [20, 11] }],
    ['no flights, 13 Feb to 5 Mar', { status: 'no-flights', dep: [13, 2], ret: [5, 3] }],
    ['price unknown, 10 Nov to 24 Nov', { status: 'price-unknown', dep: [10, 11], ret: [24, 11] }],
    ['no flights, 30 Dec to 2 Jan', { status: 'no-flights', dep: [30, 12], ret: [2, 1] }],
    ['price unknown, 20 Oct to 20 Oct', { status: 'price-unknown', dep: [20, 10], ret: [20, 10] }],
  ])('%s parses', (name, want) => {
    const c = parseUnpricedCellName(name);
    expect(c && { status: c.status, dep: [c.dep.day, c.dep.month], ret: [c.ret.day, c.ret.month] }).toEqual(
      want,
    );
  });
  it.each([
    // why: no recording showed an unpriced cell selected or marked; such a name is unparsed until one does
    'no flights, 14 Nov to 20 Nov, selected',
    'price unknown, low price, 10 Nov to 24 Nov',
    'No flights, 14 Nov to 20 Nov',
    'Price unknown, 10 Nov to 24 Nov',
    'no flights 14 Nov to 20 Nov',
    'no flights, 14 Nov - 20 Nov',
    'no flights, 14 Nov to 20 Nov ',
    ' no flights, 14 Nov to 20 Nov',
    'no flights, 31 Nov to 20 Dec',
    'no flights, 14 Nov to 0 Dec',
    'no flights, 14 Nvo to 20 Nov',
    'no prices, 14 Nov to 20 Nov',
    'no flights',
    '£457, 11 Mar to 21 Mar',
    '',
  ])('%j is unparsed, never guessed', (name) => {
    expect(parseUnpricedCellName(name)).toBeNull();
  });
  it('a priced name is never read as unpriced, nor an unpriced one as priced', () => {
    expect(parseCellName('no flights, 14 Nov to 20 Nov')).toBeNull();
    expect(parseCellName('price unknown, 10 Nov to 24 Nov')).toBeNull();
    expect(parseUnpricedCellName('£607, low price, 13 Nov to 23 Nov, selected')).toBeNull();
  });
});

describe('dayLabels', () => {
  it('reads the labels from a line printed without spaces between them, ignoring the glyph runs', () => {
    expect(
      dayLabels('0000Thu 11 MarFri 12 MarSat 13 MarSun 14 MarMon 15 MarTue 16 MarWed 17 Mar0000'),
    ).toEqual([
      { weekday: 4, day: 11, month: 3 },
      { weekday: 5, day: 12, month: 3 },
      { weekday: 6, day: 13, month: 3 },
      { weekday: 0, day: 14, month: 3 },
      { weekday: 1, day: 15, month: 3 },
      { weekday: 2, day: 16, month: 3 },
      { weekday: 3, day: 17, month: 3 },
    ]);
    expect(dayLabels('Fri 2 Apr00000000Sat 27 MarSun 28 Mar').map((l) => [l.day, l.month])).toEqual([
      [2, 4],
      [27, 3],
      [28, 3],
    ]);
    expect(dayLabels('Thu 11 Mar Fri 12 Mar')).toHaveLength(2);
    expect(dayLabels('Cheapest Compared with other prices shown Departure')).toEqual([]);
    expect(dayLabels('Mon 32 MarTue 1 Apr')).toEqual([{ weekday: 2, day: 1, month: 4 }]);
  });
  it('names only the tokens in its tables', () => {
    expect([monthOf('Mar'), monthOf('Sept'), monthOf('Mzr')]).toEqual([3, 9, null]);
    expect([weekdayOf('Sun'), weekdayOf('Sat'), weekdayOf('Thur')]).toEqual([0, 6, null]);
  });
});

describe('resolveDay and weekdayMatches (the year nearest the query)', () => {
  const dep = asIsoDate('2026-12-27');
  it('rolls over the year boundary', () => {
    expect(resolveDay({ day: 3, month: 1 }, dep)).toBe('2027-01-03');
    expect(resolveDay({ day: 24, month: 12 }, dep)).toBe('2026-12-24');
    expect(resolveDay({ day: 28, month: 12 }, asIsoDate('2027-01-03'))).toBe('2026-12-28');
    expect(resolveDay({ day: 14, month: 3 }, asIsoDate('2027-03-14'))).toBe('2027-03-14');
    expect(resolveDay({ day: 29, month: 2 }, asIsoDate('2027-03-14'))).toBeNull();
    expect(resolveDay({ day: 29, month: 2 }, asIsoDate('2028-03-14'))).toBe('2028-02-29');
  });
  it('checks the weekday', () => {
    expect(weekdayMatches(4, asIsoDate('2027-03-11'))).toBe(true);
    expect(weekdayMatches(5, asIsoDate('2027-03-11'))).toBe(false);
  });
});

describe('the selected-pair line', () => {
  it.each([
    ['14 – 24 Mar 2027', { dep: { day: 14, month: 3, year: 2027 }, ret: { day: 24, month: 3, year: 2027 } }],
    [
      '28 Mar – 7 Apr 2027',
      { dep: { day: 28, month: 3, year: 2027 }, ret: { day: 7, month: 4, year: 2027 } },
    ],
    [
      '27 Dec 2026 – 6 Jan 2027',
      { dep: { day: 27, month: 12, year: 2026 }, ret: { day: 6, month: 1, year: 2027 } },
    ],
    ['20 – 23 Oct', { dep: { day: 20, month: 10, year: null }, ret: { day: 23, month: 10, year: null } }],
  ])('%s parses its range', (text, want) => {
    expect(parseSelectedRange(text)).toEqual(want);
  });
  it('refuses another form, and reads the price line', () => {
    expect(parseSelectedRange('14 - 24 Mar 2027')).toBeNull();
    expect(parseSelectedRange('14 – 24 Mzr 2027')).toBeNull();
    expect(parseSelectedRange('32 – 24 Mar 2027')).toBeNull();
    expect(parseSelectedRange('14 – 32 Mar 2027')).toBeNull();
    expect(parseSelectedPrice('£462 · Round trip')).toBe(462);
    expect(parseSelectedPrice('£1,308 · Round trip')).toBe(1308);
    expect(parseSelectedPrice('£462 · One way')).toBeNull();
    expect(parseSelectedPrice(' £462 · Round trip ')).toBe(462);
    expect(parseSelectedRange(' 20 – 23 Oct ')).not.toBeNull();
  });
});
