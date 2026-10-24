import { describe, expect, it } from 'vitest';
import {
  asIsoDate,
  asIsoDateTime,
  asIsoMonth,
  iataSchema,
  isoDateSchema,
  isoDateTimeOfEpochMs,
  isoDateTimeSchema,
  isoMonthSchema,
  isRealDate,
} from '../../src/types/ids.js';

describe('iataSchema', () => {
  it('accepts three upper-case letters', () => expect(iataSchema.safeParse('LHR').success).toBe(true));
  it('trims and upper-cases input (review focus 1)', () => expect(iataSchema.parse(' lhr ')).toBe('LHR'));
  it.each(['LHRX', 'LH', '12A', '', 'lh r'])('rejects %j', (v) =>
    expect(iataSchema.safeParse(v).success).toBe(false),
  );
});

describe('isoDateSchema', () => {
  it('accepts a real date', () => expect(isoDateSchema.safeParse('2028-02-29').success).toBe(true));
  it.each([
    '2027-02-29',
    '2026-13-01',
    '2026-04-31',
    '2026-00-10',
    '2026-10-00',
    '2026-1-1',
    '20261001',
    '2026-10-01T00:00:00.000Z',
  ])('rejects %j', (v) => expect(isoDateSchema.safeParse(v).success).toBe(false));
  it('asIsoDate throws on a bad value', () =>
    expect(() => asIsoDate('2027-02-29')).toThrow(/not an ISO date/));
  it('isRealDate handles leap years by the Gregorian rule', () => {
    expect(isRealDate(2000, 2, 29)).toBe(true);
    expect(isRealDate(1900, 2, 29)).toBe(false);
    expect(isRealDate(2024, 2, 29)).toBe(true);
    expect(isRealDate(2026, 4, 31)).toBe(false);
    expect(isRealDate(2026, 1, 31)).toBe(true);
    expect(isRealDate(2026, 1.5, 1)).toBe(false);
  });
});

describe('isoMonthSchema', () => {
  it('accepts YYYY-MM', () => expect(isoMonthSchema.safeParse('2026-11').success).toBe(true));
  it('asIsoMonth mints or throws', () => {
    expect(asIsoMonth('2026-11')).toBe('2026-11');
    expect(() => asIsoMonth('2026-13')).toThrow(/not an ISO month/);
  });
  it.each(['2026-13', '2026-00', '2026-1', '202611'])('rejects %j', (v) =>
    expect(isoMonthSchema.safeParse(v).success).toBe(false),
  );
});

describe('isoDateTimeSchema', () => {
  it('accepts the toISOString form only', () => {
    expect(isoDateTimeSchema.safeParse('2026-10-14T15:00:00.000Z').success).toBe(true);
    expect(isoDateTimeSchema.safeParse('2026-10-14T15:00:00Z').success).toBe(false);
    expect(isoDateTimeSchema.safeParse('2026-10-14T15:00:00.000+01:00').success).toBe(false);
    // an impossible date in the right shape is refused, never thrown (WP16a review R26)
    expect(isoDateTimeSchema.safeParse('2026-13-45T15:00:00.000Z').success).toBe(false);
    expect(isoDateTimeSchema.safeParse('2026-02-30T15:00:00.000Z').success).toBe(false);
    expect(isoDateTimeSchema.safeParse('2026-02-30T15:00:00.000Z').success).toBe(false);
  });
  it('asIsoDateTime throws on a bad value', () =>
    expect(() => asIsoDateTime('nope')).toThrow(/not an ISO timestamp/));
  it('isoDateTimeOfEpochMs mints from a millisecond instant', () => {
    expect(isoDateTimeOfEpochMs(Date.UTC(2026, 9, 14, 15, 0, 0, 0))).toBe('2026-10-14T15:00:00.000Z');
  });
});
