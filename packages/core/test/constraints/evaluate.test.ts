import { describe, expect, it } from 'vitest';
import { evaluateConstraints } from '../../src/constraints/evaluate.js';
import { CONSTRAINT_LABELS, CONSTRAINT_NAMES } from '../../src/constraints/labels.js';
import { unverifiedNames, verdictClass } from '../../src/constraints/verdictClass.js';
import { normaliseOffer } from '../../src/normalise/itinerary.js';
import type { Constraints } from '../../src/types/definition.js';
import { asIata } from '../../src/types/ids.js';
import type {
  ConstraintName,
  NormalisedItinerary,
  ObservationFields,
  SuppliedField,
  Verdict,
} from '../../src/types/itinerary.js';
import type { Cabin } from '../../src/types/provenance.js';
import { cellOf, deps, offer, seg } from '../helpers/offers.js';

/**
 * One-stop out via AAA (overnight, 430 min), one-stop back changing AAA→BBB (120 min), VS and 4U.
 * Journey minutes: out 960, back 550. Departures: out 20:00 (LHR), back 10:00 (JFK). Arrivals: out 08:00 (JFK), back 00:10 (LHR).
 * Out: LHR 20:00 → AAA 23:10, AAA 06:20 → JFK 08:00 (+1). Back: JFK 10:00 → AAA 19:00, BBB 21:00 → LHR 00:10 (+1).
 */
function itinerary(): NormalisedItinerary {
  const raw = offer({
    outbound: [
      seg({
        marketingCarrier: '4U',
        flightNumber: '8888',
        from: asIata('LHR'),
        to: asIata('AAA'),
        depart: '2027-03-14T20:00',
        arrive: '2027-03-14T23:10',
      }),
      seg({
        flightNumber: '1',
        from: asIata('AAA'),
        to: asIata('JFK'),
        depart: '2027-03-15T06:20',
        arrive: '2027-03-15T08:00',
      }),
    ],
    inbound: [
      seg({
        flightNumber: '2',
        from: asIata('JFK'),
        to: asIata('AAA'),
        depart: '2027-03-28T10:00',
        arrive: '2027-03-28T19:00',
      }),
      seg({
        flightNumber: '3',
        from: asIata('BBB'),
        to: asIata('LHR'),
        depart: '2027-03-28T21:00',
        arrive: '2027-03-29T00:10',
      }),
    ],
  });
  const r = normaliseOffer(raw, cellOf(raw), deps());
  if (!r.ok) throw r.error;
  return r.itinerary;
}

const IT = itinerary();
const ALL: SuppliedField[] = [
  'segments',
  'segmentTimes',
  'segmentCabins',
  'selfTransfer',
  'baggage',
  'fareConditions',
  'seller',
  'price',
];
const without = (...f: SuppliedField[]): SuppliedField[] => ALL.filter((x) => !f.includes(x));
const OFFER: ObservationFields = {
  pricePence: 41_200,
  priceNativeMinor: 41_200,
  currencyNative: 'GBP',
  fx: { converted: false },
  taxesIncluded: true,
  selfTransfer: false,
  segmentCabins: ['economy', 'economy', 'economy', 'economy'],
  baggage: { cabinBag: 'included', checkedBags: 1 },
  fareConditions: null,
  booking: { kind: 'none' },
  bookingExpiresAt: null,
};

/** Third column: observation overrides, plus `cabin` for the requested cabin (default economy). */
type Row = [
  ConstraintName,
  Constraints,
  Partial<ObservationFields> & { cabin?: Cabin },
  SuppliedField[],
  Verdict,
];

// Every row of the spec §6.2 table, each with pass, fail and absent-input → unverified.
const ROWS: Row[] = [
  ['maxStops', { maxStops: 1 }, {}, ALL, 'pass'],
  ['maxStops', { maxStops: 0 }, {}, ALL, 'fail'],
  ['maxStops', { maxStops: 1 }, {}, without('segments'), 'unverified'],
  ['maxJourneyMinutes', { maxJourneyMinutes: 1500 }, {}, ALL, 'pass'],
  ['maxJourneyMinutes', { maxJourneyMinutes: 600 }, {}, ALL, 'fail'],
  ['maxJourneyMinutes', { maxJourneyMinutes: 960 }, {}, ALL, 'pass'], // exactly the outbound journey
  ['maxJourneyMinutes', { maxJourneyMinutes: 959 }, {}, ALL, 'fail'], // only the outbound violates
  ['maxJourneyMinutes', { maxJourneyMinutes: 1500 }, {}, without('segmentTimes'), 'unverified'],
  ['minLayoverMinutes', { minLayoverMinutes: 120 }, {}, ALL, 'pass'],
  ['minLayoverMinutes', { minLayoverMinutes: 121 }, {}, ALL, 'fail'],
  ['minLayoverMinutes', { minLayoverMinutes: 60 }, {}, without('segmentTimes'), 'unverified'],
  ['maxLayoverMinutes', { maxLayoverMinutes: 430 }, {}, ALL, 'pass'],
  ['maxLayoverMinutes', { maxLayoverMinutes: 429 }, {}, ALL, 'fail'],
  ['maxLayoverMinutes', { maxLayoverMinutes: 600 }, {}, without('segments'), 'unverified'],
  ['noOvernightLayover', { noOvernightLayover: true }, {}, ALL, 'fail'],
  ['noOvernightLayover', { noOvernightLayover: true }, {}, without('segmentTimes'), 'unverified'],
  ['departureWindowLocal', { departureWindowLocal: { from: '09:00', to: '21:00' } }, {}, ALL, 'pass'],
  ['departureWindowLocal', { departureWindowLocal: { from: '10:00', to: '20:00' } }, {}, ALL, 'pass'], // both edges inclusive
  ['departureWindowLocal', { departureWindowLocal: { from: '10:01', to: '20:00' } }, {}, ALL, 'fail'], // only the inbound violates
  ['departureWindowLocal', { departureWindowLocal: { from: '10:00', to: '19:59' } }, {}, ALL, 'fail'], // only the outbound violates
  ['departureWindowLocal', { departureWindowLocal: { from: '21:00', to: '09:00' } }, {}, ALL, 'fail'], // wraps midnight: 20:00 and 10:00 both outside
  [
    'departureWindowLocal',
    { departureWindowLocal: { from: '09:00', to: '21:00' } },
    {},
    without('segmentTimes'),
    'unverified',
  ],
  ['arrivalWindowLocal', { arrivalWindowLocal: { from: '06:00', to: '23:00' } }, {}, ALL, 'fail'], // inbound lands 00:10
  ['arrivalWindowLocal', { arrivalWindowLocal: { from: '00:10', to: '08:00' } }, {}, ALL, 'pass'], // both edges inclusive
  ['arrivalWindowLocal', { arrivalWindowLocal: { from: '00:11', to: '08:00' } }, {}, ALL, 'fail'], // only the inbound violates
  ['arrivalWindowLocal', { arrivalWindowLocal: { from: '00:10', to: '07:59' } }, {}, ALL, 'fail'], // only the outbound violates
  ['arrivalWindowLocal', { arrivalWindowLocal: { from: '22:00', to: '08:30' } }, {}, ALL, 'pass'], // wraps: 08:00 and 00:10 inside
  [
    'arrivalWindowLocal',
    { arrivalWindowLocal: { from: '06:00', to: '23:00' } },
    {},
    without('segments'),
    'unverified',
  ],
  ['noSelfTransfer', { noSelfTransfer: true }, { selfTransfer: false }, ALL, 'pass'],
  ['noSelfTransfer', { noSelfTransfer: true }, { selfTransfer: true }, ALL, 'fail'],
  ['noSelfTransfer', { noSelfTransfer: true }, { selfTransfer: null }, ALL, 'unverified'],
  [
    'noSelfTransfer',
    { noSelfTransfer: true },
    { selfTransfer: false },
    without('selfTransfer'),
    'unverified',
  ],
  ['noAirportChange', { noAirportChange: true }, {}, ALL, 'fail'],
  ['noAirportChange', { noAirportChange: true }, {}, without('segments'), 'unverified'],
  ['includeAirlines', { includeAirlines: ['4U'] }, {}, ALL, 'pass'],
  ['includeAirlines', { includeAirlines: ['BA'] }, {}, ALL, 'fail'],
  ['includeAirlines', { includeAirlines: ['4U'] }, {}, without('segments'), 'unverified'],
  ['excludeAirlines', { excludeAirlines: ['BA'] }, {}, ALL, 'pass'],
  ['excludeAirlines', { excludeAirlines: ['4U'] }, {}, ALL, 'fail'],
  ['excludeAirlines', { excludeAirlines: ['4U'] }, {}, without('segments'), 'unverified'],
  ['cabinBagRequired', { cabinBagRequired: true }, {}, ALL, 'pass'],
  ['cabinBagRequired', { cabinBagRequired: true }, { baggage: { cabinBag: 'not-included' } }, ALL, 'fail'],
  ['cabinBagRequired', { cabinBagRequired: true }, { baggage: { checkedBags: 1 } }, ALL, 'unverified'],
  ['cabinBagRequired', { cabinBagRequired: true }, {}, without('baggage'), 'unverified'],
  ['checkedBagRequired', { checkedBagRequired: true }, {}, ALL, 'pass'],
  ['checkedBagRequired', { checkedBagRequired: true }, { baggage: { checkedBags: 0 } }, ALL, 'fail'],
  ['checkedBagRequired', { checkedBagRequired: true }, { baggage: null }, ALL, 'unverified'],
  ['minCheckedBags', { minCheckedBags: 1 }, {}, ALL, 'pass'],
  ['minCheckedBags', { minCheckedBags: 2 }, {}, ALL, 'fail'],
  ['minCheckedBags', { minCheckedBags: 1 }, { baggage: { cabinBag: 'included' } }, ALL, 'unverified'],
  ['minCheckedBags', { minCheckedBags: 1 }, { baggage: null }, ALL, 'unverified'],
  ['minCheckedBags', { minCheckedBags: 1 }, {}, without('baggage'), 'unverified'],
  ['maxPricePence', { maxPricePence: 41_200 }, {}, ALL, 'pass'],
  ['maxPricePence', { maxPricePence: 41_199 }, {}, ALL, 'fail'],
  ['maxPricePence', { maxPricePence: 50_000 }, {}, without('price'), 'unverified'],
  ['cabin', {}, {}, ALL, 'pass'],
  ['cabin', {}, { cabin: 'premium_economy' }, ALL, 'fail'], // every segment below the requested cabin
  [
    'cabin',
    {},
    { segmentCabins: ['business', 'economy', 'first', 'premium_economy'], cabin: 'economy' },
    ALL,
    'pass',
  ], // mixed, none below
  // mixed: one leg below the requested cabin fails even though the others meet it
  [
    'cabin',
    {},
    {
      cabin: 'premium_economy',
      segmentCabins: ['premium_economy', 'economy', 'premium_economy', 'premium_economy'],
    },
    ALL,
    'fail',
  ],
  ['cabin', {}, { segmentCabins: null }, ALL, 'unverified'],
  ['cabin', {}, { segmentCabins: ['economy'] }, ALL, 'unverified'], // not every segment stated
  ['cabin', {}, {}, without('segmentCabins'), 'unverified'],
];

describe('evaluateConstraints (spec §6.2)', () => {
  it.each(ROWS)('%s %j %j → %s', (name, c, o, supplied, expected) => {
    const { cabin = 'economy', ...obs } = o;
    expect(evaluateConstraints(IT, { ...OFFER, ...obs }, c, cabin, supplied)[name]).toBe(expected);
  });

  it('judges only the constraints that are set (false and [] are not set); cabin is always judged', () => {
    const v = evaluateConstraints(
      IT,
      OFFER,
      {
        noOvernightLayover: false,
        noSelfTransfer: false,
        noAirportChange: false,
        includeAirlines: [],
        excludeAirlines: [],
        cabinBagRequired: false,
        checkedBagRequired: false,
      },
      'economy',
      ALL,
    );
    expect(v).toEqual({ cabin: 'pass' });
  });

  it('journey minutes missing from the itinerary are unverified even when times are supplied', () => {
    const { outboundMinutes: _o, ...rest } = IT;
    expect(
      evaluateConstraints(rest, OFFER, { maxJourneyMinutes: 1500 }, 'economy', ALL).maxJourneyMinutes,
    ).toBe('unverified');
  });

  it.each([
    ['9:00', '21:00'],
    ['10:001', '21:00'],
    ['x10:00', '21:00'],
    ['10:00', '24:00'],
  ])('a malformed time window %s–%s is a caller error', (from, to) => {
    expect(() =>
      evaluateConstraints(IT, OFFER, { departureWindowLocal: { from, to } }, 'economy', ALL),
    ).toThrow(RangeError);
    expect(() =>
      evaluateConstraints(IT, OFFER, { departureWindowLocal: { from, to } }, 'economy', ALL),
    ).toThrow(`window must be HH:mm: ${from}–${to}`);
  });

  it('a window whose edges are equal admits only that minute, not the whole day', () => {
    // departures are exactly 20:00 (outbound) and 10:00 (inbound): no single minute holds both
    const w = { departureWindowLocal: { from: '20:00', to: '20:00' } };
    expect(evaluateConstraints(IT, OFFER, w, 'economy', ALL).departureWindowLocal).toBe('fail');
  });

  it('a window wrapping midnight includes both of its edges', () => {
    // departures are exactly 20:00 (outbound) and 10:00 (inbound)
    const w = { departureWindowLocal: { from: '20:00', to: '10:00' } };
    expect(evaluateConstraints(IT, OFFER, w, 'economy', ALL).departureWindowLocal).toBe('pass');
    const narrow = { departureWindowLocal: { from: '20:01', to: '10:00' } };
    expect(evaluateConstraints(IT, OFFER, narrow, 'economy', ALL).departureWindowLocal).toBe('fail');
  });

  it('maxStops judges each direction on its own', () => {
    const stops = (stopsOut: number, stopsIn: number) =>
      evaluateConstraints({ ...IT, stopsOut, stopsIn }, OFFER, { maxStops: 1 }, 'economy', ALL).maxStops;
    expect(stops(2, 0)).toBe('fail');
    expect(stops(0, 2)).toBe('fail');
    expect(stops(1, 1)).toBe('pass');
    expect(evaluateConstraints({ ...IT, stopsIn: 0 }, OFFER, { maxStops: 0 }, 'economy', ALL).maxStops).toBe(
      'fail',
    );
  });

  it('maxStops and maxJourneyMinutes judge the inbound direction too', () => {
    expect(evaluateConstraints({ ...IT, stopsOut: 0 }, OFFER, { maxStops: 0 }, 'economy', ALL).maxStops).toBe(
      'fail',
    );
    const inboundLong = { ...IT, outboundMinutes: 100, inboundMinutes: 960 };
    expect(
      evaluateConstraints(inboundLong, OFFER, { maxJourneyMinutes: 959 }, 'economy', ALL).maxJourneyMinutes,
    ).toBe('fail');
    expect(
      evaluateConstraints(inboundLong, OFFER, { maxJourneyMinutes: 960 }, 'economy', ALL).maxJourneyMinutes,
    ).toBe('pass');
    const { inboundMinutes: _i, ...noInbound } = IT;
    expect(
      evaluateConstraints(noInbound, OFFER, { maxJourneyMinutes: 1500 }, 'economy', ALL).maxJourneyMinutes,
    ).toBe('unverified');
  });

  it('a direct itinerary passes layover constraints vacuously', () => {
    const direct = { ...IT, layovers: [], stopsOut: 0, stopsIn: 0 };
    expect(
      evaluateConstraints(
        direct,
        OFFER,
        { minLayoverMinutes: 60, maxLayoverMinutes: 300, noOvernightLayover: true },
        'economy',
        ALL,
      ),
    ).toMatchObject({ minLayoverMinutes: 'pass', maxLayoverMinutes: 'pass', noOvernightLayover: 'pass' });
  });
});

describe('evaluateConstraints: value guards', () => {
  it('noAirportChange passes without a change and is unverified when airportChange is unknown', () => {
    expect(
      evaluateConstraints({ ...IT, airportChange: false }, OFFER, { noAirportChange: true }, 'economy', ALL)
        .noAirportChange,
    ).toBe('pass');
    const { airportChange: _a, ...unknownChange } = IT;
    expect(
      evaluateConstraints(unknownChange, OFFER, { noAirportChange: true }, 'economy', ALL).noAirportChange,
    ).toBe('unverified');
  });

  it('noOvernightLayover passes a real daytime connection', () => {
    const daytime = { ...IT, layovers: IT.layovers.map((l) => ({ ...l, overnight: false })) };
    expect(
      evaluateConstraints(daytime, OFFER, { noOvernightLayover: true }, 'economy', ALL).noOvernightLayover,
    ).toBe('pass');
  });

  it('a direction without segments leaves the time windows unverified', () => {
    const windows = {
      departureWindowLocal: { from: '00:00', to: '23:59' },
      arrivalWindowLocal: { from: '00:00', to: '23:59' },
    };
    expect(evaluateConstraints({ ...IT, inbound: [] }, OFFER, windows, 'economy', ALL)).toMatchObject({
      departureWindowLocal: 'unverified',
      arrivalWindowLocal: 'unverified',
    });
    expect(
      evaluateConstraints({ ...IT, outbound: [] }, OFFER, windows, 'economy', ALL).departureWindowLocal,
    ).toBe('unverified');
  });
});

describe('verdictClass (spec §3, §6.2)', () => {
  it.each([
    [{ cabin: 'pass', maxStops: 'pass' }, 'verified'],
    [{ cabin: 'unverified', maxStops: 'pass' }, 'partially-verified'],
    [{ cabin: 'unverified', maxStops: 'fail' }, 'failed'],
    [{ cabin: 'pass', maxStops: 'fail' }, 'failed'],
  ] as const)('%j → %s', (v, cls) => {
    expect(verdictClass(v)).toBe(cls);
  });
});

describe('verdictClass refuses verdicts that were never evaluated (review prov-001)', () => {
  it('throws RangeError without cabin, including an empty map', () => {
    expect(() => verdictClass({})).toThrow(RangeError);
    expect(() => verdictClass({ maxStops: 'pass' })).toThrow('verdicts not evaluated: cabin missing');
  });
});

describe('CONSTRAINT_LABELS (review pft-008)', () => {
  it('labels every ConstraintName, in plain words', () => {
    expect(Object.keys(CONSTRAINT_LABELS).sort()).toEqual([...CONSTRAINT_NAMES].sort());
    for (const name of CONSTRAINT_NAMES) expect(CONSTRAINT_LABELS[name]).toMatch(/^[a-z][a-z -]+$/);
    expect(CONSTRAINT_LABELS.checkedBagRequired).toBe('checked bag');
  });
});

describe('unverifiedNames', () => {
  it('lists the unverified constraints in key order', () => {
    expect(
      unverifiedNames({
        cabin: 'unverified',
        maxStops: 'pass',
        checkedBagRequired: 'unverified',
        maxPricePence: 'fail',
      }),
    ).toEqual(['cabin', 'checkedBagRequired']);
    expect(unverifiedNames({})).toEqual([]);
  });
});
