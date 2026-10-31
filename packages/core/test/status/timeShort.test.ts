import { describe, expect, it } from 'vitest';
import { formatInstantShort } from '../../src/status/time.js';
import { asIsoDateTime } from '../../src/types/ids.js';

const at = (s: string) => asIsoDateTime(s);

describe('formatInstantShort (spec rev 55 §8.1 "Stop causes": "14 Mar 15:00")', () => {
  it('reads day, short month and 24-hour time in the zone, with no comma', () => {
    expect(formatInstantShort(at('2027-03-14T15:00:00.000Z'), 'Europe/London')).toBe('14 Mar 15:00');
  });

  it("follows London's clock change at 01:00 UTC on Sunday 28 March 2027", () => {
    expect(formatInstantShort(at('2027-03-28T00:30:00.000Z'), 'Europe/London')).toBe('28 Mar 00:30');
    expect(formatInstantShort(at('2027-03-28T01:30:00.000Z'), 'Europe/London')).toBe('28 Mar 02:30');
  });

  it('rolls into the next local month and day', () => {
    expect(formatInstantShort(at('2027-03-31T23:00:00.000Z'), 'Europe/London')).toBe('1 Apr 00:00');
    expect(formatInstantShort(at('2027-03-14T15:00:00.000Z'), 'Asia/Tokyo')).toBe('15 Mar 00:00');
  });

  it('renders midnight as 00:00, never 24:00, and pads single-digit hours and minutes', () => {
    expect(formatInstantShort(at('2027-01-05T00:00:00.000Z'), 'UTC')).toBe('5 Jan 00:00');
    expect(formatInstantShort(at('2027-12-25T07:05:00.000Z'), 'UTC')).toBe('25 Dec 07:05');
  });

  it('names every month the same way whatever the host locale data (no "Sept")', () => {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    months.forEach((m, i) => {
      const mm = String(i + 1).padStart(2, '0');
      expect(formatInstantShort(at(`2027-${mm}-10T12:00:00.000Z`), 'UTC')).toBe(`10 ${m} 12:00`);
    });
  });
});
