import { asIsoDate, asIsoMonth } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { targetOf, weeksOf } from '../../../src/views/Calendar/grid.js';

describe('grid logic (review arch M3)', () => {
  const d = asIsoDate;
  it('weeks are Monday-first with null padding', () => {
    const weeks = weeksOf(asIsoMonth('2027-03'));
    expect(weeks[0]?.slice(0, 2)).toEqual([d('2027-03-01'), d('2027-03-02')]);
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    expect(weeksOf(asIsoMonth('2027-05'))[0]?.[0]).toBeNull(); // 1 May 2027 is a Saturday
  });
  it('keys map to targets; other keys to null', () => {
    expect(targetOf(d('2027-03-14'), 'ArrowRight')).toBe('2027-03-15');
    expect(targetOf(d('2027-03-14'), 'ArrowUp')).toBe('2027-03-07');
    expect(targetOf(d('2027-03-17'), 'Home')).toBe('2027-03-15');
    expect(targetOf(d('2027-03-17'), 'End')).toBe('2027-03-21');
    expect(targetOf(d('2027-03-31'), 'PageDown')).toBe('2027-04-30');
    expect(targetOf(d('2027-01-31'), 'PageDown')).toBe('2027-02-28');
    expect(targetOf(d('2027-03-14'), 'x')).toBeNull();
  });
});
