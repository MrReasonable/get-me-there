import { describe, expect, it } from 'vitest';
import { addMonthsClamped, formatInstant } from '../../src/status/time.js';
import { asIsoDateTime } from '../../src/types/ids.js';

describe('formatInstant', () => {
  it('names the zone and reads its own clock, across the clock change', () => {
    expect(formatInstant(asIsoDateTime('2026-10-19T00:30:00.000Z'), 'Europe/London')).toBe(
      'Mon, 19 Oct 2026, 01:30 (Europe/London)',
    );
    expect(formatInstant(asIsoDateTime('2026-12-14T09:05:00.000Z'), 'Europe/London')).toBe(
      'Mon, 14 Dec 2026, 09:05 (Europe/London)',
    );
    expect(formatInstant(asIsoDateTime('2026-12-14T00:05:00.000Z'), 'UTC')).toBe(
      'Mon, 14 Dec 2026, 00:05 (UTC)',
    );
  });
});

describe('addMonthsClamped', () => {
  it.each([
    ['2026-01-31T10:20:30.400Z', 13, '2027-02-28T10:20:30.400Z'],
    ['2026-03-31T00:00:00.000Z', -1, '2026-02-28T00:00:00.000Z'],
    ['2027-12-15T12:00:00.000Z', 1, '2028-01-15T12:00:00.000Z'],
    ['2028-01-31T12:00:00.000Z', 1, '2028-02-29T12:00:00.000Z'],
    ['2026-10-14T09:00:00.000Z', 0, '2026-10-14T09:00:00.000Z'],
  ])('%s + %i months is %s', (at, months, want) => {
    expect(addMonthsClamped(asIsoDateTime(at), months)).toBe(want);
  });
});
