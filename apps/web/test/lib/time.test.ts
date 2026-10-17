import { asIsoDate } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { dateMs, dateOfMs, instantMs } from '../../src/lib/time.js';

describe('src/lib/time.ts: instants and the date axis (review focus 3)', () => {
  it('instantMs accepts an instant and refuses a date-only string', () => {
    expect(instantMs('2027-03-14T15:00:00.000Z')).toBe(Date.UTC(2027, 2, 14, 15));
    expect(() => instantMs('2027-03-14')).toThrow(RangeError);
  });
  it('dateMs is epoch-day arithmetic, equal to UTC midnight, and dateOfMs inverts it', () => {
    expect(dateMs(asIsoDate('2027-03-14'))).toBe(Date.UTC(2027, 2, 14));
    expect(dateOfMs(dateMs(asIsoDate('1969-12-31')))).toBe('1969-12-31');
    expect(dateOfMs(Date.UTC(2027, 2, 14, 23, 59))).toBe('2027-03-14');
  });
});
