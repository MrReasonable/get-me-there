import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { datePairFigureSchema, datePairsResponseSchema } from '../../src/api-contract/datePairs.js';
import { decodeDatePairs } from '../../src/datePairs/decode.js';
import {
  type DatePair,
  type DatePairFigure,
  type DecodedDatePairs,
  encodeDatePairs,
  provenanceKey,
} from '../../src/datePairs/encode.js';
import type { DatePairSpace } from '../../src/datePairs/space.js';
import { addDays } from '../../src/dates/epochDay.js';
import { sortedAirportPairs } from '../../src/space/generate.js';
import { asIata, asIsoDate, asIsoDateTime } from '../../src/types/ids.js';
import type { Provenance } from '../../src/types/provenance.js';
import {
  calendarFigure,
  calendarProvenance,
  decoded,
  summaryOf,
  verifiedFigure,
  verifiedProvenance,
  workedExample,
} from '../helpers/datePairs.js';

/** Provenances that differ from the first in exactly one field each (spec §3: every field is provenance). */
const VARIANTS: Array<[string, Provenance]> = [
  ['base', calendarProvenance()],
  [
    'FX converted',
    calendarProvenance({
      fx: { converted: true, rateNano: 790_000_000, rateDate: asIsoDate('2027-02-28'), source: 'ECB' },
    }),
  ],
  [
    'another FX rate',
    calendarProvenance({
      fx: { converted: true, rateNano: 790_000_001, rateDate: asIsoDate('2027-02-28'), source: 'ECB' },
    }),
  ],
  [
    'providerObservedAt',
    calendarProvenance({ providerObservedAt: asIsoDateTime('2027-03-01T08:00:00.000Z') }),
  ],
  ['pointOfSale', calendarProvenance({ pointOfSale: 'GB' })],
  ['maxAgeAssumed', calendarProvenance({ maxAgeAssumed: true })],
  ['returnDateSource', calendarProvenance({ returnDateSource: 'vendor' })],
  ['vendorPriceMark', calendarProvenance({ vendorPriceMark: 'cheapest' })],
  ['fetchedAt', calendarProvenance({ fetchedAt: asIsoDateTime('2027-03-01T10:00:00.001Z') })],
  [
    'providerId',
    verifiedProvenance({ maxAgeHours: 48, pointOfSale: 'unknown', sourceKind: 'authorised-cached' }),
  ],
  ['sourceKind', calendarProvenance({ sourceKind: 'synthetic' })],
  ['maxAgeHours', calendarProvenance({ maxAgeHours: 'unknown' })],
  ['cabin', calendarProvenance({ cabin: 'business' })],
];

/** A generated DecodedDatePairs: a small space near the year end, a scope, and consistent date pairs. */
const arbDecoded: fc.Arbitrary<DecodedDatePairs> = fc
  .record({
    startOffset: fc.integer({ min: 0, max: 70 }),
    days: fc.integer({ min: 0, max: 5 }),
    minNights: fc.integer({ min: 0, max: 3 }),
    stays: fc.integer({ min: 1, max: 3 }),
    origins: fc.subarray(['LGW', 'LHR']),
    destinations: fc.subarray(['EWR', 'JFK']),
    limit: fc.option(fc.integer({ min: 60, max: 6000 }), { nil: null }),
  })
  .chain((s) => {
    const space: DatePairSpace = {
      departureFrom: addDays(asIsoDate('2027-12-01'), s.startOffset),
      departureTo: addDays(asIsoDate('2027-12-01'), s.startOffset + s.days - 1),
      minNights: s.minNights,
      maxNights: s.minNights + s.stays - 1,
    };
    const base = decoded({
      space,
      origins: s.origins,
      destinations: s.destinations,
      maxJourneyMinutes: s.limit,
    });
    const a = base.scope.airportPairs;
    const pairs = sortedAirportPairs(base.scope.origins, base.scope.destinations);
    const arbFigure: fc.Arbitrary<DatePairFigure | null> =
      a === 0
        ? fc.constant(null)
        : fc.option(
            fc
              .record({
                airportPair: fc.integer({ min: 0, max: a - 1 }),
                cheaperPair: fc.integer({ min: 0, max: a - 1 }),
                verified: fc.boolean(),
                pence: fc.integer({ min: 1, max: 200_000 }),
                provenance: fc.integer({ min: 0, max: VARIANTS.length - 1 }),
                cheaperProvenance: fc.integer({ min: 0, max: VARIANTS.length - 1 }),
                stale: fc.boolean(),
                age: fc.option(fc.nat(500), { nil: 'unknown' as const }),
                truncated: fc.boolean(),
                superseded: fc.boolean(),
                notSeen: fc.option(fc.option(fc.nat(500), { nil: 'unknown' as const }), { nil: null }),
                minutes: fc.option(fc.nat(6000), { nil: null }),
                cheaper: fc.option(fc.integer({ min: 0, max: 199_999 }), { nil: null }),
                cheaperFlags: fc.tuple(fc.boolean(), fc.boolean()),
                earlier: fc.boolean(),
              })
              .map((f): DatePairFigure => {
                const pair = pairs[f.airportPair] ?? { origin: asIata('LHR'), destination: asIata('JFK') };
                const cheaperAt = pairs[f.cheaperPair] ?? pair;
                const price = {
                  pricePence: f.pence,
                  provenance: VARIANTS[f.provenance]?.[1] ?? calendarProvenance(),
                  stale: f.stale,
                  ageHours: f.age,
                  truncated: f.verified ? false : f.truncated,
                };
                const common = {
                  price,
                  ...pair,
                  airportPair: f.airportPair,
                  fromEarlierSearch: f.earlier,
                  journeyMinutes: f.minutes,
                };
                if (!f.verified) return calendarFigure({ ...common, superseded: f.superseded });
                return verifiedFigure({
                  ...common,
                  notSeenInLatest: f.notSeen === null ? null : { ageHours: f.notSeen },
                  cheaperCached:
                    f.cheaper === null || f.cheaper >= f.pence
                      ? null
                      : {
                          pricePence: f.cheaper,
                          provenance: VARIANTS[f.cheaperProvenance]?.[1] ?? calendarProvenance(),
                          stale: f.cheaperFlags[0],
                          truncated: f.cheaperFlags[1],
                          origin: cheaperAt.origin,
                          destination: cheaperAt.destination,
                        },
                });
              }),
            { nil: null },
          );
    const arbPair = (p: DatePair): fc.Arbitrary<DatePair> =>
      fc
        .record({
          bucketOf: fc.array(fc.integer({ min: 0, max: 5 }), { minLength: a, maxLength: a }),
          reused: fc.nat(a),
          selected: fc.nat(a),
          notReached: fc.nat(a),
          rest: fc.array(fc.nat(a), { minLength: 4, maxLength: 4 }),
          journeyLeftOut: fc.nat(a),
          figure: arbFigure,
        })
        .map((r) => {
          const counts = [0, 0, 0, 0, 0, 0];
          for (const b of r.bucketOf) counts[b] = (counts[b] ?? 0) + 1;
          const [priced = 0, empty = 0, noData = 0, error = 0, skipped = 0, notRun = 0] = counts;
          const [itinerarySearched = 0, onDemand = 0, unconfirmed = 0, partiallyVerified = 0] = r.rest;
          return {
            ...p,
            buckets: {
              priced,
              empty,
              no_data: noData,
              error,
              skipped,
              not_run: notRun,
              reused: Math.min(r.reused, priced),
            },
            selected: r.selected,
            notReached: Math.min(r.notReached, r.selected),
            itinerarySearched,
            onDemand,
            unconfirmed,
            partiallyVerified,
            journeyLeftOut: s.limit === null ? 0 : r.journeyLeftOut,
            figure: r.figure,
          };
        });
    return fc.tuple(...base.pairs.map(arbPair)).map((ps) => ({ ...base, pairs: ps, summary: summaryOf(ps) }));
  });

describe('encodeDatePairs and decodeDatePairs (spec §10: the provenance table is an encoding only)', () => {
  it('decode(encode(x)) deep-equals x, and the encoding parses against the contract (property)', () => {
    fc.assert(
      fc.property(arbDecoded, (x) => {
        const wire = encodeDatePairs(x);
        const parsed = datePairsResponseSchema.safeParse(JSON.parse(JSON.stringify(wire)));
        expect(parsed.error?.issues ?? []).toEqual([]);
        expect(decodeDatePairs(wire)).toEqual(x);
        if (parsed.success) expect(decodeDatePairs(parsed.data)).toEqual(x);
      }),
      { numRuns: 300 },
    );
  });

  it('returns every date pair in index order with its dates across the month end, the leap day and the year boundary', () => {
    const at = (from: string, to: string, minNights: number, maxNights: number) =>
      decodeDatePairs(
        encodeDatePairs(
          decoded({
            space: { departureFrom: asIsoDate(from), departureTo: asIsoDate(to), minNights, maxNights },
          }),
        ),
      ).pairs.map((p) => `${p.index} ${p.departureDate}→${p.returnDate} ${p.nights}`);
    expect(at('2027-01-31', '2027-02-01', 0, 1)).toEqual([
      '0 2027-01-31→2027-01-31 0',
      '1 2027-01-31→2027-02-01 1',
      '2 2027-02-01→2027-02-01 0',
      '3 2027-02-01→2027-02-02 1',
    ]);
    expect(at('2028-02-28', '2028-02-29', 1, 1)).toEqual([
      '0 2028-02-28→2028-02-29 1',
      '1 2028-02-29→2028-03-01 1',
    ]);
    expect(at('2027-12-31', '2028-01-01', 2, 2)).toEqual([
      '0 2027-12-31→2028-01-02 2',
      '1 2028-01-01→2028-01-03 2',
    ]);
  });

  it('every figure and every cheaper-cached price carries its full provenance by deep equality', () => {
    const x = workedExample();
    const back = decodeDatePairs(encodeDatePairs(x));
    const figures = (d: DecodedDatePairs) => d.pairs.map((p) => p.figure);
    expect(figures(back)).toEqual(figures(x));
    const withCheaper = back.pairs.find((p) => p.figure?.cheaperCached != null);
    expect(withCheaper?.figure?.cheaperCached?.provenance).toEqual(
      calendarProvenance({ fetchedAt: asIsoDateTime('2027-02-28T09:00:00.000Z') }),
    );
  });

  it('keys provenances canonically: one field apart is two entries, identical is one, key order does not matter', () => {
    // the canonical form: every key at every depth, sorted
    expect(provenanceKey(calendarProvenance())).toBe(
      '{"cabin":"economy","fetchedAt":"2027-03-01T10:00:00.000Z","fx":{"converted":false,},"maxAgeHours":48,' +
        '"pointOfSale":"unknown","providerId":"travelpayouts","sourceKind":"authorised-cached",}',
    );
    const keys = VARIANTS.map(([, p]) => provenanceKey(p));
    expect(new Set(keys).size).toBe(VARIANTS.length);
    const p = calendarProvenance();
    const reordered: Provenance = {
      cabin: p.cabin,
      pointOfSale: p.pointOfSale,
      fx: p.fx,
      maxAgeHours: p.maxAgeHours,
      fetchedAt: p.fetchedAt,
      sourceKind: p.sourceKind,
      providerId: p.providerId,
    };
    expect(Object.keys(reordered)).not.toEqual(Object.keys(p));
    expect(provenanceKey(reordered)).toBe(provenanceKey(calendarProvenance()));
    const fx = {
      source: 'ECB',
      rateDate: asIsoDate('2027-02-28'),
      rateNano: 790_000_000,
      converted: true,
    } as const;
    expect(provenanceKey(calendarProvenance({ fx }))).toBe(
      provenanceKey(VARIANTS[1]?.[1] ?? calendarProvenance()),
    );

    const one = (p: Provenance, q: Provenance) =>
      encodeDatePairs(
        decoded({
          pair: (i) =>
            i < 2
              ? {
                  buckets: { priced: 1, empty: 0, no_data: 0, error: 0, skipped: 0, not_run: 3, reused: 0 },
                  figure: calendarFigure({
                    price: { ...calendarFigure().price, provenance: i === 0 ? p : q },
                  }),
                }
              : {},
        }),
      ).provenances;
    for (const [name, p] of VARIANTS.slice(1)) {
      expect(one(calendarProvenance(), p), name).toEqual([calendarProvenance(), p]);
    }
    expect(one(calendarProvenance(), calendarProvenance())).toEqual([calendarProvenance()]);
  });

  it('a verified figure and its cheaper-cached price share one table entry when their provenances are equal', () => {
    const shared = calendarProvenance();
    const wire = encodeDatePairs(
      decoded({
        pair: (i) =>
          i === 0
            ? {
                buckets: { priced: 2, empty: 0, no_data: 0, error: 0, skipped: 0, not_run: 2, reused: 0 },
                figure: verifiedFigure({
                  price: { ...verifiedFigure().price, provenance: shared },
                  cheaperCached: {
                    pricePence: 1,
                    provenance: calendarProvenance(),
                    stale: false,
                    truncated: false,
                    origin: asIata('LGW'),
                    destination: asIata('EWR'),
                  },
                }),
              }
            : {},
      }),
    );
    expect(wire.provenances).toEqual([shared]);
    expect([wire.figures.provenance, wire.figures.cheaperCachedProvenance]).toEqual([[0], [0]]);
  });

  it('buckets.reused is the reused column', () => {
    const x = workedExample();
    const wire = encodeDatePairs(x);
    expect(wire.pairs.reused).toEqual(x.pairs.map((p) => p.buckets.reused));
    expect(decodeDatePairs(wire).pairs.map((p) => p.buckets.reused)).toEqual(wire.pairs.reused);
  });

  it('the worked example parses, and each decoded figure less its airport pair is a datePairFigureSchema value', () => {
    const wire = workedExample();
    expect(datePairsResponseSchema.safeParse(encodeDatePairs(wire)).error?.issues ?? []).toEqual([]);
    for (const p of decodeDatePairs(encodeDatePairs(wire)).pairs) {
      if (p.figure === null) continue;
      const { airportPair: _drop, ...detail } = p.figure;
      expect(datePairFigureSchema.parse(detail)).toEqual(detail);
    }
  });

  it('refuses a figure whose airports are not in the scope', () => {
    const x = decoded({
      origins: ['LHR'],
      pair: (i) => (i === 0 ? { figure: calendarFigure({ origin: asIata('LGW') }) } : {}),
    });
    expect(() => encodeDatePairs(x)).toThrow(new RangeError('encodeDatePairs: LGW is not in the scope'));
    const y = decoded({
      destinations: ['JFK'],
      pair: (i) => (i === 0 ? { figure: calendarFigure({ destination: asIata('EWR') }) } : {}),
    });
    expect(() => encodeDatePairs(y)).toThrow(RangeError);
    const z = decoded({
      destinations: ['JFK'],
      pair: (i) =>
        i === 0
          ? {
              figure: verifiedFigure({
                cheaperCached: {
                  pricePence: 1,
                  provenance: calendarProvenance(),
                  stale: false,
                  truncated: false,
                  origin: asIata('LHR'),
                  destination: asIata('EWR'),
                },
              }),
            }
          : {},
    });
    expect(() => encodeDatePairs(z)).toThrow(RangeError);
  });

  it('decode refuses a body the contract refuses rather than inventing a value', () => {
    const past = encodeDatePairs(workedExample());
    past.figures.pair[0] = past.pairs.priced.length;
    expect(() => decodeDatePairs(past)).toThrow(new RangeError('no entry 12 in a column of 12'));
    for (const [c, what] of [
      ['cheaperCachedProvenance', 'its provenance'],
      ['cheaperCachedOrigin', 'its origin'],
      ['cheaperCachedDestination', 'its destination'],
      ['cheaperCachedTruncated', 'its truncation'],
      ['cheaperCachedStale', 'its staleness'],
    ] as const) {
      const r = encodeDatePairs(workedExample());
      const j = r.figures.cheaperCachedPence.findIndex((p) => p !== null);
      r.figures[c][j] = null;
      expect(() => decodeDatePairs(r), c).toThrow(
        new RangeError(`decodeDatePairs: ${what} is null beside a cheaper cached price`),
      );
    }
  });
});
