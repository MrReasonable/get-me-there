import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { NormalisationError } from '../../src/errors.js';
import {
  departLocal,
  localMinute,
  parseVendorTime,
  requireZone,
  vendorInstant,
  wallToInstant,
} from '../../src/normalise/localTime.js';
import { toIsoDateTime } from '../../src/normalise/timestamps.js';

const LONDON = 'Europe/London';
const NEW_YORK = 'America/New_York';

function messageOf(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    if (e instanceof NormalisationError) return e.message;
    throw e;
  }
  return 'no error';
}

function reasonOf(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    if (e instanceof NormalisationError) return e.reason;
    throw e;
  }
  return 'no error';
}

describe('departLocal input forms (spec §6.4 matrix)', () => {
  it('T and space separators give the same wall time; seconds are dropped', () => {
    expect(departLocal('2027-03-14T10:05', 'local', LONDON)).toBe('2027-03-14T10:05');
    expect(departLocal('2027-03-14 10:05', 'local', LONDON)).toBe('2027-03-14T10:05');
    expect(departLocal('2027-03-14T10:05:59', 'local', LONDON)).toBe('2027-03-14T10:05');
  });

  it('UTC, local and offset inputs for the same instant agree', () => {
    // LHR in winter: GMT, so UTC and wall time coincide.
    expect(departLocal('2027-03-14T10:05:00Z', 'utc', LONDON)).toBe('2027-03-14T10:05');
    expect(departLocal('2027-03-14 10:05:00', 'utc', LONDON)).toBe('2027-03-14T10:05');
    expect(departLocal('2027-03-14T10:05:00+00:00', 'offset', LONDON)).toBe('2027-03-14T10:05');
    // JFK in summer: EDT, UTC−4.
    expect(departLocal('2027-06-01T14:00:00.000Z', 'utc', NEW_YORK)).toBe('2027-06-01T10:00');
    expect(departLocal('2027-06-01T10:00:00-04:00', 'offset', NEW_YORK)).toBe('2027-06-01T10:00');
    expect(departLocal('2027-06-01T10:00-0400', 'offset', NEW_YORK)).toBe('2027-06-01T10:00');
    expect(departLocal('2027-06-01T10:00', 'local', NEW_YORK)).toBe('2027-06-01T10:00');
    expect(toIsoDateTime('2027-06-01T10:00', 'local', NEW_YORK)).toBe('2027-06-01T14:00:00.000Z');
    expect(toIsoDateTime('2027-06-01T15:30:00+05:30', 'offset', 'UTC')).toBe('2027-06-01T10:00:00.000Z');
  });

  it('an unknown or offset-form zone is NormalisationError(unknown-airport-tz) for every time kind; UTC is never hashed', () => {
    // why: a London-winter lookup first, so a tzOffset cache keyed "" could not mask '' (review arch-001).
    expect(departLocal('2027-01-14T10:05:00Z', 'utc', LONDON)).toBe('2027-01-14T10:05');
    for (const tz of ['', 'Mars/Olympus_Mons', 'Not/AZone', 'Garbage-05', '+05:30', '-0400', 'GMT', 'EST']) {
      expect(
        reasonOf(() => departLocal('2027-03-14T10:05:00Z', 'utc', tz)),
        tz,
      ).toBe('unknown-airport-tz');
      expect(
        reasonOf(() => departLocal('2027-03-14T10:05', 'local', tz)),
        tz,
      ).toBe('unknown-airport-tz');
      expect(
        reasonOf(() => toIsoDateTime('2027-03-14T10:05', 'local', tz)),
        tz,
      ).toBe('unknown-airport-tz');
    }
    expect(departLocal('2027-03-14T10:05:00Z', 'utc', 'UTC')).toBe('2027-03-14T10:05');
  });
});

describe('DST rules (spec §5.6), UK/EU and US changes in 2027', () => {
  it('a nonexistent wall time shifts forward by the gap (London, 28 Mar 2027 01:00 → 02:00)', () => {
    expect(departLocal('2027-03-28T01:30', 'local', LONDON)).toBe('2027-03-28T02:30');
    expect(toIsoDateTime('2027-03-28T01:30', 'local', LONDON)).toBe('2027-03-28T01:30:00.000Z');
    expect(toIsoDateTime('2027-03-28T00:59', 'local', LONDON)).toBe('2027-03-28T00:59:00.000Z');
    expect(toIsoDateTime('2027-03-28T02:00', 'local', LONDON)).toBe('2027-03-28T01:00:00.000Z');
  });

  it('an ambiguous wall time takes the first occurrence (London, 31 Oct 2027 02:00 BST → 01:00 GMT)', () => {
    expect(departLocal('2027-10-31T01:30', 'local', LONDON)).toBe('2027-10-31T01:30');
    expect(toIsoDateTime('2027-10-31T01:30', 'local', LONDON)).toBe('2027-10-31T00:30:00.000Z');
    expect(toIsoDateTime('2027-10-31T00:59', 'local', LONDON)).toBe('2027-10-30T23:59:00.000Z');
    expect(toIsoDateTime('2027-10-31T02:00', 'local', LONDON)).toBe('2027-10-31T02:00:00.000Z');
    // UTC input on either side of the overlap reads back as the same wall time.
    expect(departLocal('2027-10-31T00:30:00Z', 'utc', LONDON)).toBe('2027-10-31T01:30');
    expect(departLocal('2027-10-31T01:30:00Z', 'utc', LONDON)).toBe('2027-10-31T01:30');
  });

  it('the same rules hold in New York (14 Mar and 7 Nov 2027)', () => {
    expect(departLocal('2027-03-14T02:30', 'local', NEW_YORK)).toBe('2027-03-14T03:30');
    expect(toIsoDateTime('2027-03-14T02:30', 'local', NEW_YORK)).toBe('2027-03-14T07:30:00.000Z');
    expect(toIsoDateTime('2027-11-07T01:30', 'local', NEW_YORK)).toBe('2027-11-07T05:30:00.000Z');
  });

  it('property: reading an instant as wall time and back loses nothing except the second occurrence of an overlap', () => {
    const from = Date.UTC(2026, 0, 1);
    const to = Date.UTC(2028, 11, 31);
    fc.assert(
      fc.property(
        fc.integer({ min: from / 60_000, max: to / 60_000 }),
        fc.constantFrom(LONDON, NEW_YORK),
        (minute, tz) => {
          const instant = minute * 60_000;
          const p = parseVendorTime(localMinute(instant, tz));
          const back = wallToInstant(p, tz);
          expect([0, 3_600_000]).toContain(instant - back);
        },
      ),
    );
  });
});

describe('timestamp format rejection (spec §6.3)', () => {
  it.each([
    ['14/03/2027 10:05', 'local'],
    ['2027-03-14', 'local'],
    ['1710410700', 'utc'],
    ['2027-02-29T10:00', 'local'],
    ['2027-03-14T24:00', 'local'],
    ['2027-03-14T10:60', 'local'],
    ['2027-03-14T10:05:60', 'local'],
    ['2027-03-14T10:05Z', 'local'], // local with a suffix
    ['2027-03-14T10:05+01:00', 'utc'], // utc with an offset
    ['2027-03-14T10:05', 'offset'], // offset without one
  ] as const)('%s as %s is bad-local-time', (value, kind) => {
    expect(reasonOf(() => toIsoDateTime(value, kind, LONDON))).toBe('bad-local-time');
  });

  it('keeps milliseconds and always emits the toISOString form', () => {
    expect(toIsoDateTime('2027-06-01T14:00:00.5Z', 'utc', 'UTC')).toBe('2027-06-01T14:00:00.500Z');
    expect(toIsoDateTime('2027-06-01 14:00', 'utc', 'UTC')).toBe('2027-06-01T14:00:00.000Z');
  });

  it('property: any toISOString value round-trips', () => {
    fc.assert(
      fc.property(
        fc.date({
          min: new Date('2026-01-01T00:00:00Z'),
          max: new Date('2028-12-31T23:59:59Z'),
          noInvalidDate: true,
        }),
        (d) => {
          expect(toIsoDateTime(d.toISOString(), 'utc', 'UTC')).toBe(d.toISOString());
        },
      ),
    );
  });
});

describe('vendor time strictness and diagnostics', () => {
  it('rejects text before or after the timestamp (the whole string must match)', () => {
    for (const v of [
      'x2027-03-14T10:05',
      '2027-03-14T10:05x',
      '2027-03-14T10:05Zjunk',
      '12027-03-14T10:05',
    ]) {
      expect(
        reasonOf(() => parseVendorTime(v)),
        v,
      ).toBe('bad-local-time');
    }
  });

  it('trims surrounding whitespace before parsing', () => {
    expect(parseVendorTime('  2027-03-14T10:05\n')).toMatchObject({ y: 2027, mo: 3, d: 14, h: 10, mi: 5 });
  });

  it('names the offending value in each bad-local-time message', () => {
    expect(messageOf(() => parseVendorTime('14/03/2027 10:05'))).toBe(
      'bad-local-time: unrecognised time "14/03/2027 10:05"',
    );
    expect(messageOf(() => parseVendorTime('2027-03-14T24:00'))).toBe(
      'bad-local-time: out-of-range time "2027-03-14T24:00"',
    );
    expect(messageOf(() => vendorInstant('2027-03-14T10:05Z', 'local', LONDON))).toBe(
      'bad-local-time: local time with suffix "2027-03-14T10:05Z"',
    );
    expect(messageOf(() => vendorInstant('2027-03-14T10:05+01:00', 'utc', LONDON))).toBe(
      'bad-local-time: utc time with offset "2027-03-14T10:05+01:00"',
    );
    expect(messageOf(() => vendorInstant('2027-03-14T10:05', 'offset', LONDON))).toBe(
      'bad-local-time: offset time without offset "2027-03-14T10:05"',
    );
  });

  it('reads a Z, a bare utc time and a signed offset as the right instants', () => {
    const noon = Date.UTC(2027, 5, 1, 12, 0);
    expect(vendorInstant('2027-06-01T12:00Z', 'utc', 'UTC')).toBe(noon);
    expect(vendorInstant('2027-06-01T12:00', 'utc', 'UTC')).toBe(noon);
    expect(vendorInstant('2027-06-01T12:00Z', 'offset', 'UTC')).toBe(noon);
    expect(vendorInstant('2027-06-01T12:00+02:00', 'offset', 'UTC')).toBe(noon - 2 * 3_600_000);
    expect(vendorInstant('2027-06-01T12:00-0530', 'offset', 'UTC')).toBe(noon + 5.5 * 3_600_000);
  });
});

describe('requireZone', () => {
  it('returns a valid zone unchanged, including region zones whose name contains a sign and digit', () => {
    expect(requireZone(LONDON)).toBe(LONDON);
    expect(requireZone('UTC')).toBe('UTC');
    expect(requireZone('Etc/GMT+5')).toBe('Etc/GMT+5');
  });

  it('refuses null, unknown and offset-form zones with unknown-airport-tz and a message naming them', () => {
    expect(reasonOf(() => requireZone(null))).toBe('unknown-airport-tz');
    expect(messageOf(() => requireZone(null))).toBe('unknown-airport-tz: time zone null');
    expect(messageOf(() => requireZone('+05:30'))).toBe('unknown-airport-tz: time zone "+05:30"');
    expect(messageOf(() => requireZone('Mars/Olympus_Mons'))).toBe(
      'unknown-airport-tz: time zone "Mars/Olympus_Mons"',
    );
  });
});

describe('wall times after a spring-forward gap resolve to the real instant', () => {
  it('New York 14 Mar 2027 03:30 is already EDT (07:30Z), and is its own wall time', () => {
    expect(toIsoDateTime('2027-03-14T03:30', 'local', NEW_YORK)).toBe('2027-03-14T07:30:00.000Z');
    expect(departLocal('2027-03-14T03:30', 'local', NEW_YORK)).toBe('2027-03-14T03:30');
  });
});
