import { asIsoDate, type IsoDate } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { type Layout, moveTo, sameDayOtherMonth, targetOf } from '../../../../src/views/Dates/keys.js';
import { bandsOf, type Column, columnsFor } from '../../../../src/views/Dates/overview.js';

// Spec §11 Overview "Keyboard": one tab stop; Left/Right through reading order (stays, then the next day), Up/Down a
// week, PageUp/PageDown a month (clamped as sameDayOtherMonth does), Home/End the day's first and last cell. Pure;
// Stryker runs it. The Calendar grid's keyboard targets (gridLogic.test.ts) are ported here with the move.

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

/** A window of drawn days, every day with the same columns unless a month has a band open. */
function layout(from: string, to: string, columns: (date: IsoDate) => readonly Column[]): Layout {
  return {
    columns,
    has: (date) => date >= from && date <= to,
  };
}
const three = layout('2027-03-14', '2027-04-13', () => columnsFor(bandsOf({ min: 10, max: 12 }), null));
const at = (date: string, from: number) => ({ date: d(date), from });

describe('moveTo: the overview’s keys', () => {
  it('Left and Right go through the stays of a day, then to the next or previous day', () => {
    expect(moveTo(at('2027-03-14', 10), 'ArrowRight', three)).toEqual(at('2027-03-14', 11));
    expect(moveTo(at('2027-03-14', 12), 'ArrowRight', three)).toEqual(at('2027-03-15', 10));
    expect(moveTo(at('2027-03-15', 10), 'ArrowLeft', three)).toEqual(at('2027-03-14', 12));
    expect(moveTo(at('2027-03-15', 11), 'ArrowLeft', three)).toEqual(at('2027-03-15', 10));
  });
  it('across a month end', () => {
    expect(moveTo(at('2027-03-31', 12), 'ArrowRight', three)).toEqual(at('2027-04-01', 10));
    expect(moveTo(at('2027-04-01', 10), 'ArrowLeft', three)).toEqual(at('2027-03-31', 12));
  });
  it('Up and Down keep the stay, a week earlier or later', () => {
    expect(moveTo(at('2027-03-20', 11), 'ArrowUp', three)).toBeNull(); // 13 Mar is before the window
    expect(moveTo(at('2027-03-21', 11), 'ArrowUp', three)).toEqual(at('2027-03-14', 11));
    expect(moveTo(at('2027-03-28', 11), 'ArrowDown', three)).toEqual(at('2027-04-04', 11));
  });
  it('PageUp and PageDown keep the stay, the same day a month away, clamped', () => {
    expect(moveTo(at('2027-03-31', 12), 'PageDown', three)).toBeNull(); // 30 Apr is outside the window
    expect(moveTo(at('2027-03-14', 12), 'PageDown', three)).toBeNull(); // 14 Apr is after it
    expect(
      moveTo(at('2027-03-13', 12), 'PageDown', layout('2027-03-01', '2027-04-30', three.columns)),
    ).toEqual(at('2027-04-13', 12));
    expect(moveTo(at('2027-04-13', 10), 'PageUp', three)).toBeNull();
    expect(moveTo(at('2027-04-14', 10), 'PageUp', layout('2027-03-01', '2027-04-30', three.columns))).toEqual(
      at('2027-03-14', 10),
    );
  });
  it('Home and End go to the day’s first and last cell', () => {
    expect(moveTo(at('2027-03-20', 11), 'Home', three)).toEqual(at('2027-03-20', 10));
    expect(moveTo(at('2027-03-20', 11), 'End', three)).toEqual(at('2027-03-20', 12));
  });
  it('never leaves the window, and ignores other keys and a column the day does not have', () => {
    expect(moveTo(at('2027-03-14', 10), 'ArrowLeft', three)).toBeNull();
    expect(moveTo(at('2027-04-13', 12), 'ArrowRight', three)).toBeNull();
    expect(moveTo(at('2027-04-13', 12), 'ArrowDown', three)).toBeNull();
    expect(moveTo(at('2027-03-20', 11), 'Enter', three)).toBeNull();
    expect(moveTo(at('2027-03-20', 99), 'ArrowRight', three)).toBeNull();
  });

  describe('into and out of an open band', () => {
    const bands = bandsOf({ min: 10, max: 22 }); // seven bands: 10–11, 12–13, …, 20–21, 22
    // March has the 12–13 band open; April's bands are folded
    const open = layout('2027-03-01', '2027-04-30', (date) =>
      columnsFor(bands, date < '2027-04-01' ? 12 : null),
    );
    it('Right walks the open band’s stays one by one', () => {
      expect(moveTo(at('2027-03-20', 10), 'ArrowRight', open)).toEqual(at('2027-03-20', 12));
      expect(moveTo(at('2027-03-20', 12), 'ArrowRight', open)).toEqual(at('2027-03-20', 13));
      expect(moveTo(at('2027-03-20', 13), 'ArrowRight', open)).toEqual(at('2027-03-20', 14));
    });
    it('a week or a month away, the stay lands in the column holding it', () => {
      expect(moveTo(at('2027-03-27', 13), 'ArrowDown', open)).toEqual(at('2027-04-03', 12));
      expect(moveTo(at('2027-04-03', 12), 'ArrowUp', open)).toEqual(at('2027-03-27', 12));
      expect(moveTo(at('2027-04-03', 12), 'PageUp', open)).toEqual(at('2027-03-03', 12));
      expect(moveTo(at('2027-03-03', 13), 'PageDown', open)).toEqual(at('2027-04-03', 12));
      expect(moveTo(at('2027-04-10', 20), 'PageUp', open)).toEqual(at('2027-03-10', 20));
    });
    it('End and Home reach the ends of a day with a band open', () => {
      expect(moveTo(at('2027-03-20', 13), 'End', open)).toEqual(at('2027-03-20', 22));
      expect(moveTo(at('2027-03-20', 13), 'Home', open)).toEqual(at('2027-03-20', 10));
    });
  });
});
