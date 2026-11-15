import { asIsoDate } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { sameDayOtherMonth, targetOf } from '../../../../src/views/Dates/keys.js';

// Ruling 18: the calendar is one tab stop; Left/Right a day, Up/Down a week, PageUp/PageDown a month (clamped as
// sameDayOtherMonth does), Home/End the week's first and last day. Pure; Stryker runs it. The Calendar grid's keyboard
// targets (gridLogic.test.ts) are ported here with the move.

const d = asIsoDate;

describe('targetOf and sameDayOtherMonth (moved from the Calendar view; gridLogic.test.ts ported)', () => {
  it('keys map to targets; other keys to null', () => {
    expect(targetOf(d('2027-03-14'), 'ArrowRight')).toBe('2027-03-15');
    expect(targetOf(d('2027-03-14'), 'ArrowLeft')).toBe('2027-03-13');
    expect(targetOf(d('2027-03-14'), 'ArrowUp')).toBe('2027-03-07');
    expect(targetOf(d('2027-03-14'), 'ArrowDown')).toBe('2027-03-21');
    expect(targetOf(d('2027-03-17'), 'Home')).toBe('2027-03-15');
    expect(targetOf(d('2027-03-17'), 'End')).toBe('2027-03-21');
    expect(targetOf(d('2027-03-31'), 'PageDown')).toBe('2027-04-30');
    expect(targetOf(d('2027-01-31'), 'PageDown')).toBe('2027-02-28');
    expect(targetOf(d('2027-03-31'), 'PageUp')).toBe('2027-02-28');
    expect(targetOf(d('2027-03-14'), 'x')).toBeNull();
  });
  it('the same day of the month before or after, clamped to that month’s length, across a year end and a leap day', () => {
    expect(sameDayOtherMonth(d('2027-12-15'), 1)).toBe('2028-01-15');
    expect(sameDayOtherMonth(d('2028-01-31'), 1)).toBe('2028-02-29');
    expect(sameDayOtherMonth(d('2028-01-01'), -1)).toBe('2027-12-01');
    expect(sameDayOtherMonth(d('2027-05-31'), -1)).toBe('2027-04-30');
  });
});
