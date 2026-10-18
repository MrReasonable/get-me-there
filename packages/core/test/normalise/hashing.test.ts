import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { NormalisationError } from '../../src/errors.js';
import { canonicalCarrier, canonicalFlightNumber } from '../../src/normalise/carrier.js';
import { type HashSegment, itineraryHash } from '../../src/normalise/hashing.js';
import { asIata } from '../../src/types/ids.js';

const LHR = asIata('LHR');
const JFK = asIata('JFK');

/** One segment each way on the worked example, with the flight number as a vendor string. */
function trip(
  carrier: string,
  flight: string,
  outOver: Partial<HashSegment> = {},
): [HashSegment[], HashSegment[]] {
  const c = canonicalCarrier(carrier);
  return [
    [
      {
        marketingCarrier: c,
        flightNumber: canonicalFlightNumber(flight, c),
        from: LHR,
        to: JFK,
        departLocal: '2027-03-14T10:05',
        ...outOver,
      },
    ],
    [
      {
        marketingCarrier: c,
        flightNumber: canonicalFlightNumber('939', c),
        from: JFK,
        to: LHR,
        departLocal: '2027-03-28T18:30',
      },
    ],
  ];
}

const s = (flightNumber: number, from: string, to: string, departLocal: string): HashSegment => ({
  marketingCarrier: 'VS',
  flightNumber,
  from: asIata(from),
  to: asIata(to),
  departLocal,
});

function reasonOf(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    if (e instanceof NormalisationError) return e.reason;
    throw e;
  }
  return 'no error';
}

describe('itinerary identity (spec §6.4)', () => {
  it('VS 938 ≡ VS938', () => {
    expect(itineraryHash(...trip('VS', 'VS 938'))).toBe(itineraryHash(...trip('VS', 'VS938')));
  });

  it('VS 938 ≡ VS938 ≡ 0938 ≡ 938, and a lower-case carrier is canonicalised', () => {
    const h = itineraryHash(...trip('VS', '938'));
    for (const f of ['VS 938', 'VS938', '0938', 'vs 0938', ' VS  938 '])
      expect(itineraryHash(...trip('vs', f))).toBe(h);
  });

  it('4U 8888: an alphanumeric designator is kept and its digit is not read as a flight number', () => {
    expect(canonicalCarrier('4U')).toBe('4U');
    expect(canonicalFlightNumber('4U 8888', '4U')).toBe(8888);
    expect(canonicalFlightNumber('4U8888')).toBe(8888);
    expect(itineraryHash(...trip('4U', '4U 8888'))).toBe(itineraryHash(...trip('4U', '8888')));
  });

  it('codeshares hash on the marketing carrier: an operating carrier never enters the hash', () => {
    const [out, back] = trip('VS', '938');
    const withOperating = out.map((x) => ({
      ...x,
      operatingCarrier: 'BA',
      durationMinutes: 420,
      aircraft: '77W',
    }));
    expect(itineraryHash(withOperating, back)).toBe(itineraryHash(out, back));
  });

  it('is pinned to golden values so the input format cannot drift silently', () => {
    // Golden input: OUT|VS:938:LHR:JFK:2027-03-14T10:05|IN|VS:939:JFK:LHR:2027-03-28T18:30
    expect(itineraryHash(...trip('VS', '938'))).toBe(
      '3e3edd61cf5e74553b055c04f2e900d3dcc398977171e8ae25e19b8d754fe75c',
    );
    // Two segments each way pins the ';' separator inside a direction. Golden input:
    // OUT|VS:938:LGW:AAA:2027-03-14T10:05;VS:1:AAA:JFK:2027-03-14T15:00|IN|VS:2:JFK:BBB:2027-03-28T18:30;VS:3:BBB:LHR:2027-03-29T01:00
    expect(
      itineraryHash(
        [s(938, 'LGW', 'AAA', '2027-03-14T10:05'), s(1, 'AAA', 'JFK', '2027-03-14T15:00')],
        [s(2, 'JFK', 'BBB', '2027-03-28T18:30'), s(3, 'BBB', 'LHR', '2027-03-29T01:00')],
      ),
    ).toBe('c3cbf8809e84d4b8762f1bfd437a5f345b0effd5b2633ac3058ba48264ddecc3');
  });

  it.each(['VIR', 'C', 'C-', 'Virgin Atlantic', ''])(
    'unmappable carrier %j is a NormalisationError, never a guess',
    (c) => {
      expect(reasonOf(() => canonicalCarrier(c))).toBe('unmappable-carrier');
    },
  );

  it.each(['VS 938A', '0', '0000', '12345', 'VS', '', 'VS-938'])('flight number %j is rejected', (f) => {
    expect(reasonOf(() => canonicalFlightNumber(f))).toBe('unmappable-carrier');
  });

  it('a numeric flight number gets the same canonical form and range check', () => {
    expect(canonicalFlightNumber(938, 'VS')).toBe(938);
    for (const n of [0, -938, 93.8, 10_000])
      expect(reasonOf(() => canonicalFlightNumber(n))).toBe('unmappable-carrier');
  });

  it('canonicalCarrier trims and upper-cases; every rejection names the offending input', () => {
    expect(canonicalCarrier('  vs ')).toBe('VS');
    expect(() => canonicalCarrier('Virgin Atlantic')).toThrow('carrier "Virgin Atlantic"');
    expect(() => canonicalFlightNumber('VS938A')).toThrow('flight number "VS938A"');
    expect(() => canonicalFlightNumber('0')).toThrow('flight number "0"');
    expect(() => canonicalFlightNumber(0)).toThrow('flight number 0');
    expect(() => canonicalFlightNumber('4U8888', 'VS')).toThrow(
      'flight number "4U8888" does not belong to VS',
    );
    expect(reasonOf(() => canonicalFlightNumber('4U8888', 'VS'))).toBe('unmappable-carrier');
    expect(() => canonicalFlightNumber(-1)).toThrow('flight number -1');
    expect(() => canonicalFlightNumber(1.5)).toThrow('flight number 1.5');
    expect(canonicalFlightNumber(1)).toBe(1);
  });

  it('a designator prefix naming another airline is rejected, not re-labelled', () => {
    expect(() => canonicalFlightNumber('BA 938', 'VS')).toThrow(/does not belong to VS/);
  });

  it('a non-canonical departLocal (UTC instant, space, prefix) cannot be hashed', () => {
    const back = trip('VS', '938')[1];
    expect(() =>
      itineraryHash(trip('VS', '938', { departLocal: '2027-03-14T10:05:00.000Z' })[0], back),
    ).toThrow(RangeError);
    expect(() => itineraryHash(trip('VS', '938', { departLocal: '2027-03-14 10:05' })[0], back)).toThrow(
      RangeError,
    );
    expect(() => itineraryHash(trip('VS', '938', { departLocal: 'x2027-03-14T10:05' })[0], back)).toThrow(
      'departLocal not canonical: x2027-03-14T10:05',
    );
  });

  it('property: equal inputs give equal hashes; changing any hashed field of any segment changes it', () => {
    const CARRIERS = ['VS', '4U', 'BA', 'AA'] as const;
    const FROMS = ['LHR', 'LGW'] as const;
    const TOS = ['JFK', 'EWR'] as const;
    const TIMES = ['2027-03-14T10:05', '2027-03-14T22:40', '2027-10-31T01:30'] as const;
    // the next value in a list, wrapping, so the replacement always differs from the original
    const next = (list: readonly string[], v: string): string => {
      const i = list.indexOf(v);
      return list[(i + 1) % list.length] ?? v;
    };
    const segArb = fc.record({
      marketingCarrier: fc.constantFrom(...CARRIERS),
      flightNumber: fc.integer({ min: 1, max: 9999 }),
      from: fc.constantFrom(...FROMS).map(asIata),
      to: fc.constantFrom(...TOS).map(asIata),
      departLocal: fc.constantFrom(...TIMES),
    });
    const fieldArb = fc.constantFrom('marketingCarrier', 'flightNumber', 'from', 'to', 'departLocal');
    const alter = (x: HashSegment, field: string): HashSegment => {
      switch (field) {
        case 'marketingCarrier':
          return { ...x, marketingCarrier: next(CARRIERS, x.marketingCarrier) };
        case 'flightNumber':
          return { ...x, flightNumber: (x.flightNumber % 9999) + 1 };
        case 'from':
          return { ...x, from: asIata(next(FROMS, x.from)) };
        case 'to':
          return { ...x, to: asIata(next(TOS, x.to)) };
        default:
          return { ...x, departLocal: next(TIMES, x.departLocal) };
      }
    };
    fc.assert(
      fc.property(
        fc.array(segArb, { minLength: 1, maxLength: 3 }),
        fc.array(segArb, { minLength: 1, maxLength: 3 }),
        fc.boolean(),
        fc.nat(),
        fieldArb,
        (out, back, inOutbound, index, field) => {
          expect(itineraryHash(out, back)).toBe(itineraryHash(structuredClone(out), structuredClone(back)));
          // why: any one field of any one segment, in either direction, is part of the identity.
          const target = inOutbound ? out : back;
          const at = index % target.length;
          const altered = target.map((x, i) => (i === at ? alter(x, field) : x));
          const [o2, b2] = inOutbound ? [altered, back] : [out, altered];
          expect(itineraryHash(o2, b2)).not.toBe(itineraryHash(out, back));
          // why: swapping directions must change identity (OUT/IN are tagged).
          expect(itineraryHash(back, out) === itineraryHash(out, back)).toBe(
            JSON.stringify(out) === JSON.stringify(back),
          );
        },
      ),
    );
  });
});
