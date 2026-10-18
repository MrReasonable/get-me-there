import { asIsoDate } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { checkForm, readShownDate } from '../src/form.js';

const REQ = { departureDate: asIsoDate('2026-11-05'), returnDate: asIsoDate('2026-11-15') };
const form = (
  o: Partial<{ tripType: string; passengers: string; departure: string; return: string }> = {},
) => ({
  tripType: 'Change ticket type. Round trip',
  passengers: '1 passenger, change number of passengers.',
  departure: 'Thu, 5 Nov',
  return: 'Sun, 15 Nov',
  ...o,
});

describe('checkForm (decision 69; prov-011, PIE-15; hypothesis names until Task 14.2’s recording)', () => {
  // why: fix round 1 (prov-int M5): the option names under hl=en-GB are month-first, so the field may be too
  it('ok for a month-first shown date (Thu, Nov 5; Sunday, November 15 2026)', () => {
    expect(checkForm(form({ departure: 'Thu, Nov 5', return: 'Sun, Nov 15' }), REQ)).toBe('ok');
    expect(checkForm(form({ departure: 'Nov 5, 2026', return: 'Sunday, November 15, 2026' }), REQ)).toBe(
      'ok',
    );
    expect(checkForm(form({ departure: 'Fri, Nov 5' }), REQ)).toBe('mismatch');
  });
  it('ok for the query’s round trip, one passenger and dates', () => {
    expect(checkForm(form(), REQ)).toBe('ok');
    expect(checkForm(form({ departure: '5 Nov 2026', return: 'Sunday, 15 November 2026' }), REQ)).toBe('ok');
  });
  it.each([
    ['one way', { tripType: 'Change ticket type. One way' }],
    ['two passengers', { passengers: '2 passengers, change number of passengers.' }],
    ['a departure of Fri, 6 Nov', { departure: 'Fri, 6 Nov' }],
    ['a return of Mon, 16 Nov', { return: 'Mon, 16 Nov' }],
    ['a wrong weekday', { departure: 'Fri, 5 Nov' }],
    ['a wrong year', { departure: '5 Nov 2027' }],
    ['an unreadable date', { departure: 'next Thursday' }],
    ['an unknown month', { departure: '5 Nob' }],
    ['an unknown weekday', { departure: 'Thx, 5 Nov' }],
  ])('mismatch: %s', (_n, o) => {
    expect(checkForm(form(o), REQ)).toBe('mismatch');
  });
  it('absent when the controls are missing', () => {
    expect(checkForm(null, REQ)).toBe('absent');
  });
  it('an ambiguous day and month across a year is mismatch', () => {
    const year = { departureDate: asIsoDate('2026-11-05'), returnDate: asIsoDate('2027-11-05') };
    expect(checkForm(form({ departure: '5 Nov', return: '5 Nov' }), year)).toBe('mismatch');
    expect(checkForm(form({ departure: 'Thu, 5 Nov', return: 'Fri, 5 Nov' }), year)).toBe('ok');
  });
  it('reads the shown date’s parts', () => {
    expect(readShownDate('Thu, 5 Nov')).toEqual({ weekday: 4, day: 5, month: 11, year: null });
    expect(readShownDate('5 November 2026')).toEqual({ weekday: null, day: 5, month: 11, year: 2026 });
  });
});
