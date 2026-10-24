import { beforeEach, describe, expect, it } from 'vitest';
import { billingMonthWindow } from '../../src/budget/window.js';
import * as core from '../../src/index.js';
import { asIsoDateTime } from '../../src/types/ids.js';

beforeEach(() => {
  expect.hasAssertions();
});

const at = asIsoDateTime;

describe('billingMonthWindow (spec §7 "Budget windows": 00:00 UTC on the billing day, one month)', () => {
  it.each([
    // billing day 1 across a British Summer Time month end: the boundary stays at 00:00 UTC
    [1, '2027-03-31T23:59:59.999Z', '2027-03-01T00:00:00.000Z', '2027-04-01T00:00:00.000Z'],
    [1, '2027-04-01T00:00:00.000Z', '2027-04-01T00:00:00.000Z', '2027-05-01T00:00:00.000Z'],
    // billing day 15
    [15, '2027-10-14T23:59:59.999Z', '2027-09-15T00:00:00.000Z', '2027-10-15T00:00:00.000Z'],
    [15, '2027-10-15T00:00:00.000Z', '2027-10-15T00:00:00.000Z', '2027-11-15T00:00:00.000Z'],
    // a January day before the billing day reaches back into December; day 28 in February
    [10, '2027-01-03T12:00:00.000Z', '2026-12-10T00:00:00.000Z', '2027-01-10T00:00:00.000Z'],
    [28, '2028-02-29T12:00:00.000Z', '2028-02-28T00:00:00.000Z', '2028-03-28T00:00:00.000Z'],
    [28, '2027-12-31T23:59:59.999Z', '2027-12-28T00:00:00.000Z', '2028-01-28T00:00:00.000Z'],
  ] as const)('billing day %d at %s: %s to %s', (day, now, start, end) => {
    expect(billingMonthWindow(at(now), day)).toEqual({ windowStart: start, windowEnd: end });
  });

  it.each([0, 29, 1.5, Number.NaN])('refuses billing day %s', (day) => {
    expect(() => billingMonthWindow(at('2027-03-01T00:00:00.000Z'), day)).toThrow(RangeError);
    expect(() => billingMonthWindow(at('2027-03-01T00:00:00.000Z'), day)).toThrow(
      `billingDay must be an integer 1–28, got ${day}`,
    );
  });

  it('is exported from the barrel', () => {
    expect(core.billingMonthWindow).toBe(billingMonthWindow);
  });
});
