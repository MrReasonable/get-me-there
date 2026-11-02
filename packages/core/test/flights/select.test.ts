import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  compareFlights,
  type FlightLimits,
  fitsLimits,
  flightLimitsOf,
  flightLimitsSchema,
  sameFlightLimits,
  selectOutbound,
  withinLimits,
} from '../../src/flights/choose.js';
import type { ListedFlight } from '../../src/flights/types.js';

// Spec revision 56 §6.2 "The limits a flight read is judged against": the limits (`flightLimitsOf`, the strict
// `flightLimitsSchema`) and the one outbound selection rule (`selectOutbound`) the worker's pick, its second pick and the
// page's "selected" mark share. Synthetic flights only.

/** A flight of `durationMinutes` at `pounds` (whole pounds, as pence), direct, departing 09:00 unless told otherwise. */
function flight(durationMinutes: number, pounds: number, over: Partial<ListedFlight> = {}): ListedFlight {
  return {
    departsLocal: '09:00',
    arrivesLocal: '17:00',
    arrivesDayOffset: 0,
    durationMinutes,
    stops: 0,
    carriers: ['QQ Air'],
    operatedBy: null,
    amountMinor: pounds * 100,
    ...over,
  };
}

const LIMITS: FlightLimits = {
  maxJourneyMinutes: 1500,
  maxStops: 1,
  departureWindowLocal: null,
  arrivalWindowLocal: null,
};

/** The brief's five, in input order: £92 at 600 min with 2 stops, £86 at 700, £80 at 1,560, £86 at 900, £95 at 800. */
const FIVE = [
  flight(600, 92, { stops: 2 }),
  flight(700, 86),
  flight(1560, 80),
  flight(900, 86),
  flight(800, 95),
];

const fitsAll = (f: ListedFlight, l: FlightLimits) => Object.values(withinLimits(f, l)).every(Boolean);

describe('selectOutbound (spec rev 56 §6.2: the first fitting flight in compareFlights order, ties by index)', () => {
  it('the £80 is over the journey limit, the £92 over the stops limit; of the two £86 the shorter', () => {
    expect(selectOutbound(FIVE, LIMITS)).toMatchObject({ index: 1, fits: true });
  });

  it('a departure window 08:00–20:00 that excludes index 1 (departs 06:10) picks index 3', () => {
    const flights = FIVE.map((f, i) => (i === 1 ? { ...f, departsLocal: '06:10' } : f));
    expect(
      selectOutbound(flights, { ...LIMITS, departureWindowLocal: { from: '08:00', to: '20:00' } }),
    ).toMatchObject({ index: 3, fits: true });
  });

  it('every flight over the limits: the cheapest of all, fits false', () => {
    const tight: FlightLimits = {
      maxJourneyMinutes: 500,
      maxStops: 0,
      departureWindowLocal: null,
      arrivalWindowLocal: null,
    };
    expect(selectOutbound(FIVE, tight)).toMatchObject({ index: 2, fits: false });
  });

  it('skip holding index 1 picks index 3 (the second pick)', () => {
    expect(selectOutbound(FIVE, LIMITS, new Set([1]))).toMatchObject({ index: 3, fits: true });
  });

  it('two fitting flights equal on price, duration, stops and departure, different carriers: the lower index', () => {
    const a = flight(600, 90, { carriers: ['QQ Atlantic'] });
    const b = flight(600, 90, { carriers: ['QQ Air'] });
    expect(selectOutbound([b, a], LIMITS)).toMatchObject({ index: 0, flight: b });
    expect(selectOutbound([a, b], LIMITS)).toMatchObject({ index: 0, flight: a });
  });

  it('equal on price and duration: fewer stops first, in either order', () => {
    const one = flight(600, 90, { stops: 1 });
    const direct = flight(600, 90);
    expect(selectOutbound([one, direct], { ...LIMITS, maxStops: null })).toMatchObject({ index: 1 });
    expect(selectOutbound([direct, one], { ...LIMITS, maxStops: null })).toMatchObject({ index: 0 });
  });

  it('returns the very flight object at the index it names', () => {
    const r = selectOutbound(FIVE, LIMITS);
    expect(r.flight).toBe(FIVE[1]);
  });

  it('an empty array throws RangeError (the caller answers no-outbound first); so does skipping every flight', () => {
    expect(() => selectOutbound([], LIMITS)).toThrow(RangeError);
    expect(() => selectOutbound([flight(600, 90)], LIMITS, new Set([0]))).toThrow(RangeError);
  });

  it('property: fits iff a flight outside skip fits; the pick is the lowest such by compareFlights, then by index', () => {
    const arbFlight = fc.record({
      durationMinutes: fc.integer({ min: 1, max: 3000 }),
      pounds: fc.integer({ min: 1, max: 40 }),
      stops: fc.integer({ min: 0, max: 3 }),
      departsLocal: fc.constantFrom('06:10', '08:00', '12:30', '21:45'),
      arrivesLocal: fc.constantFrom('03:10', '07:00', '18:05', '23:30'),
      carriers: fc.constantFrom('QQ Air', 'QQ Atlantic').map((c) => [c]),
    });
    const arbLimits = fc.record({
      maxJourneyMinutes: fc.option(fc.integer({ min: 1, max: 3000 }), { nil: null }),
      maxStops: fc.option(fc.integer({ min: 0, max: 3 }), { nil: null }),
      departureWindowLocal: fc.constantFrom(null, { from: '08:00', to: '20:00' }),
      arrivalWindowLocal: fc.constantFrom(null, { from: '06:00', to: '23:00' }),
    });
    fc.assert(
      fc.property(
        fc.array(arbFlight, { minLength: 1, maxLength: 30 }),
        arbLimits,
        fc.array(fc.nat(29), { maxLength: 5 }),
        (raw, l, skipped) => {
          const flights = raw.map((r) => flight(r.durationMinutes, r.pounds, r));
          const skip = new Set(skipped.filter((i) => i < flights.length));
          const open = flights.map((f, i) => ({ f, i })).filter((e) => !skip.has(e.i));
          if (open.length === 0) {
            expect(() => selectOutbound(flights, l, skip)).toThrow(RangeError);
            return;
          }
          const { index, flight: picked, fits } = selectOutbound(flights, l, skip);
          expect(flights[index]).toBe(picked);
          expect(skip.has(index)).toBe(false);
          const fitting = open.filter((e) => fitsAll(e.f, l));
          expect(fits).toBe(fitting.length > 0);
          const pool = fits ? fitting : open;
          if (fits) expect(fitsAll(picked, l)).toBe(true);
          for (const { f, i } of pool) {
            expect(compareFlights(f, picked)).toBeGreaterThanOrEqual(0);
            if (compareFlights(f, picked) === 0) expect(index).toBeLessThanOrEqual(i);
          }
        },
      ),
    );
  });
});

describe('flightLimitsOf and flightLimitsSchema (spec rev 56 §6.2, §5.1)', () => {
  it('flightLimitsOf({}) is every limit null', () => {
    expect(flightLimitsOf({})).toEqual({
      maxJourneyMinutes: null,
      maxStops: null,
      departureWindowLocal: null,
      arrivalWindowLocal: null,
    });
  });

  it('takes the four constraints it reads, the rest null', () => {
    expect(
      flightLimitsOf({
        maxJourneyMinutes: 1500,
        maxStops: 0,
        arrivalWindowLocal: { from: '06:00', to: '23:00' },
      }),
    ).toEqual({
      maxJourneyMinutes: 1500,
      maxStops: 0,
      departureWindowLocal: null,
      arrivalWindowLocal: { from: '06:00', to: '23:00' },
    });
  });

  it('refuses a zero journey limit, negative stops and a window time without its leading zero', () => {
    const ok = { maxJourneyMinutes: 1500, maxStops: 1, departureWindowLocal: null, arrivalWindowLocal: null };
    expect(flightLimitsSchema.safeParse(ok).success).toBe(true);
    expect(flightLimitsSchema.safeParse({ ...ok, maxJourneyMinutes: 0 }).success).toBe(false);
    expect(flightLimitsSchema.safeParse({ ...ok, maxStops: -1 }).success).toBe(false);
    expect(
      flightLimitsSchema.safeParse({ ...ok, departureWindowLocal: { from: '6:00', to: '20:00' } }).success,
    ).toBe(false);
    expect(flightLimitsSchema.safeParse({ ...ok, extra: 1 }).success).toBe(false);
    // why: strict under the limits, so a stored or sent window carries nothing else (review finding 7)
    const window = { from: '06:00', to: '23:00' };
    expect(flightLimitsSchema.safeParse({ ...ok, arrivalWindowLocal: window }).success).toBe(true);
    expect(flightLimitsSchema.safeParse({ ...ok, arrivalWindowLocal: { ...window, tz: 'x' } }).success).toBe(
      false,
    );
  });

  it('refuses a body without maxStops (required since Task 21.7), and maxStops: undefined', () => {
    const { maxStops: _m, ...without } = LIMITS;
    expect(flightLimitsSchema.safeParse(without).success).toBe(false);
    expect(flightLimitsSchema.safeParse({ ...without, maxStops: undefined }).success).toBe(false);
    expect(flightLimitsSchema.parse({ ...without, maxStops: null })).toEqual({ ...without, maxStops: null });
  });
});

describe('sameFlightLimits (spec rev 56 §6.9, §8.1: stored limits deep-equal the current ones)', () => {
  const base: FlightLimits = {
    maxJourneyMinutes: 1500,
    maxStops: 1,
    departureWindowLocal: null,
    arrivalWindowLocal: { from: '06:00', to: '23:00' },
  };
  it('is true for equal limits, null maxStops on both', () => {
    expect(sameFlightLimits(base, { ...base, arrivalWindowLocal: { from: '06:00', to: '23:00' } })).toBe(
      true,
    );
    expect(sameFlightLimits({ ...base, maxStops: null }, { ...base, maxStops: null })).toBe(true);
  });
  it('is false when any limit differs', () => {
    expect(sameFlightLimits(base, { ...base, maxJourneyMinutes: 1440 })).toBe(false);
    expect(sameFlightLimits(base, { ...base, maxStops: 0 })).toBe(false);
    expect(sameFlightLimits(base, { ...base, maxStops: null })).toBe(false);
    expect(sameFlightLimits(base, { ...base, departureWindowLocal: { from: '06:00', to: '23:00' } })).toBe(
      false,
    );
    expect(sameFlightLimits(base, { ...base, arrivalWindowLocal: null })).toBe(false);
    expect(sameFlightLimits(base, { ...base, arrivalWindowLocal: { from: '07:00', to: '23:00' } })).toBe(
      false,
    );
    expect(sameFlightLimits(base, { ...base, arrivalWindowLocal: { from: '06:00', to: '22:00' } })).toBe(
      false,
    );
    expect(sameFlightLimits({ ...base, arrivalWindowLocal: null }, base)).toBe(false);
  });
});

describe('fitsLimits (spec rev 56 §6.2: every limit met on that leg; the one rule pairing.ts and returns.ts share)', () => {
  it('is every withinLimits flag, on either leg', () => {
    const l: FlightLimits = { ...LIMITS, departureWindowLocal: { from: '08:00', to: '20:00' } };
    const early = flight(600, 90, { departsLocal: '06:10' });
    expect(fitsLimits(early, l)).toBe(false);
    expect(fitsLimits(early, l, 'outbound')).toBe(false);
    expect(fitsLimits(early, l, 'return')).toBe(true);
    expect(fitsLimits(flight(600, 90, { stops: 2 }), l, 'return')).toBe(false);
    expect(fitsLimits(flight(1501, 90), l, 'return')).toBe(false);
    expect(fitsLimits(flight(600, 90), l)).toBe(true);
  });
});
