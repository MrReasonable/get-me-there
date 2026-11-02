import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { chooseFlightsToShow, type FlightLimits, withinLimits } from '../../src/flights/choose.js';
import type { ListedFlight } from '../../src/flights/types.js';

// Spec revision 55 §11 "Flights" (Which flights) and ruling persona-010: the flights a search's page shows beside a
// date pair. Synthetic flights only (no carrier, airport or route of a real read).

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

const LIMIT_25H: FlightLimits = {
  maxJourneyMinutes: 1500,
  arrivalWindowLocal: null,
  departureWindowLocal: null,
};
const NONE: FlightLimits = { maxJourneyMinutes: null, arrivalWindowLocal: null, departureWindowLocal: null };

/** The brief's five flights: 600/700/1,560/900/800 minutes at £92/£86/£80/£86/£95. */
const FIVE = [flight(600, 92), flight(700, 86), flight(1560, 80), flight(900, 86), flight(800, 95)];

const view = (f: ListedFlight) => `£${f.amountMinor / 100} at ${f.durationMinutes}`;

describe('withinLimits (spec rev 56 §6.2: the longest journey and the stops on each leg, the two windows on the outbound)', () => {
  it('judges the outbound duration against the longest journey, inclusive', () => {
    expect(withinLimits(flight(1500, 1), LIMIT_25H)).toEqual({
      journey: true,
      stops: true,
      arrival: true,
      departure: true,
    });
    expect(withinLimits(flight(1501, 1), LIMIT_25H).journey).toBe(false);
  });
  it('an arrival window 06:00–23:00 excludes a flight arriving 03:10', () => {
    const l: FlightLimits = { ...NONE, arrivalWindowLocal: { from: '06:00', to: '23:00' } };
    expect(withinLimits(flight(600, 1, { arrivesLocal: '03:10' }), l)).toEqual({
      journey: true,
      stops: true,
      arrival: false,
      departure: true,
    });
    expect(withinLimits(flight(600, 1, { arrivesLocal: '23:00' }), l).arrival).toBe(true);
  });
  it('a departure window 08:00–20:00 excludes one departing 06:10', () => {
    const l: FlightLimits = { ...NONE, departureWindowLocal: { from: '08:00', to: '20:00' } };
    expect(withinLimits(flight(600, 1, { departsLocal: '06:10' }), l)).toEqual({
      journey: true,
      stops: true,
      arrival: true,
      departure: false,
    });
    expect(withinLimits(flight(600, 1, { departsLocal: '08:00' }), l).departure).toBe(true);
  });
  it("the stops limit is met at or under maxStops, and when maxStops is absent or null (today's result plus stops)", () => {
    const twoStops = flight(600, 1, { stops: 2 });
    expect(withinLimits(twoStops, { ...NONE, maxStops: 1 })).toEqual({
      journey: true,
      stops: false,
      arrival: true,
      departure: true,
    });
    expect(withinLimits(twoStops, { ...NONE, maxStops: 2 }).stops).toBe(true);
    expect(withinLimits(twoStops, { ...NONE, maxStops: null }).stops).toBe(true);
    expect(withinLimits(twoStops, NONE).stops).toBe(true);
    expect(withinLimits(flight(600, 1), { ...NONE, maxStops: 0 }).stops).toBe(true);
  });
  it("on the 'return' leg both windows are ignored; the journey and the stops still apply", () => {
    const l: FlightLimits = {
      maxJourneyMinutes: 600,
      maxStops: 0,
      arrivalWindowLocal: { from: '06:00', to: '23:00' },
      departureWindowLocal: { from: '08:00', to: '20:00' },
    };
    const back = flight(700, 1, { stops: 1, departsLocal: '06:10', arrivesLocal: '03:10' });
    expect(withinLimits(back, l, 'return')).toEqual({
      journey: false,
      stops: false,
      arrival: true,
      departure: true,
    });
    expect(withinLimits(back, l)).toEqual({ journey: false, stops: false, arrival: false, departure: false });
    expect(withinLimits(flight(600, 1), l, 'return')).toEqual({
      journey: true,
      stops: true,
      arrival: true,
      departure: true,
    });
  });
  it('a window that wraps midnight is read as one span', () => {
    const l: FlightLimits = { ...NONE, departureWindowLocal: { from: '22:00', to: '02:00' } };
    expect(withinLimits(flight(600, 1, { departsLocal: '23:30' }), l).departure).toBe(true);
    expect(withinLimits(flight(600, 1, { departsLocal: '12:00' }), l).departure).toBe(false);
  });
});

describe('chooseFlightsToShow (spec rev 55 §11 Which flights)', () => {
  it('shows the cheapest three within the limits by price, then duration, and counts the rest', () => {
    const r = chooseFlightsToShow(FIVE, LIMIT_25H);
    expect(r.shown.map(view)).toEqual(['£86 at 700', '£86 at 900', '£92 at 600']);
    expect(r).toMatchObject({ overLimit: false, moreRead: 2, moreOutside: 1 });
  });

  it('always includes the shortest flight within the limits: a 400-minute flight at £150 replaces the third pick', () => {
    const r = chooseFlightsToShow([...FIVE, flight(400, 150)], LIMIT_25H);
    expect(r.shown.map(view)).toEqual(['£86 at 700', '£86 at 900', '£150 at 400']);
    expect(r).toMatchObject({ overLimit: false, moreRead: 3, moreOutside: 1 });
  });

  it('a flight outside the arrival window or the departure window is not shown and is counted outside', () => {
    const l: FlightLimits = {
      maxJourneyMinutes: 1500,
      arrivalWindowLocal: { from: '06:00', to: '23:00' },
      departureWindowLocal: { from: '08:00', to: '20:00' },
    };
    const late = flight(500, 60, { arrivesLocal: '03:10' });
    const early = flight(500, 61, { departsLocal: '06:10' });
    const r = chooseFlightsToShow([...FIVE, late, early], l);
    expect(r.shown.map(view)).toEqual(['£86 at 700', '£86 at 900', '£92 at 600']);
    expect(r).toMatchObject({ overLimit: false, moreRead: 4, moreOutside: 3 });
  });

  it('every flight outside the limits: the cheapest three, marked over the limit', () => {
    const outside = [
      flight(1600, 92),
      flight(1700, 86),
      flight(1560, 80),
      flight(1900, 86),
      flight(1800, 95),
    ];
    const r = chooseFlightsToShow(outside, LIMIT_25H);
    expect(r.shown.map(view)).toEqual(['£80 at 1560', '£86 at 1700', '£86 at 1900']);
    expect(r).toMatchObject({ overLimit: true, moreRead: 2, moreOutside: 2 });
  });

  it('with no limit set, the cheapest three (the shortest among them)', () => {
    const r = chooseFlightsToShow([flight(600, 92), flight(500, 86), flight(700, 99), flight(900, 90)], NONE);
    expect(r.shown.map(view)).toEqual(['£86 at 500', '£90 at 900', '£92 at 600']);
    expect(r).toMatchObject({ overLimit: false, moreRead: 1, moreOutside: 0 });
  });

  it('one flight within and one outside shows only the one within', () => {
    const r = chooseFlightsToShow([flight(1600, 50), flight(700, 99)], LIMIT_25H);
    expect(r.shown.map(view)).toEqual(['£99 at 700']);
    expect(r).toMatchObject({ overLimit: false, moreRead: 1, moreOutside: 1 });
  });

  it('fewer than three flights shows them all; none shows none', () => {
    const r = chooseFlightsToShow([flight(700, 99), flight(600, 92)], LIMIT_25H);
    expect(r.shown.map(view)).toEqual(['£92 at 600', '£99 at 700']);
    expect(r).toMatchObject({ overLimit: false, moreRead: 0, moreOutside: 0 });
    expect(chooseFlightsToShow([], LIMIT_25H)).toEqual({
      shown: [],
      overLimit: false,
      moreRead: 0,
      moreOutside: 0,
    });
  });

  it('a tie in price and duration goes to fewer stops, then the earlier departure', () => {
    const a = flight(600, 90, { stops: 1, departsLocal: '07:00' });
    const b = flight(600, 90, { stops: 0, departsLocal: '11:00' });
    const c = flight(600, 90, { stops: 0, departsLocal: '08:15' });
    const r = chooseFlightsToShow([a, b, c], NONE);
    expect(r.shown).toEqual([c, b, a]);
  });

  it('the departure decides in either input order, and flights equal in every key keep their input order', () => {
    const late1 = flight(600, 90, { departsLocal: '11:00', carriers: ['QQ One'] });
    const early = flight(600, 90, { departsLocal: '07:00' });
    const late2 = flight(600, 90, { departsLocal: '11:00', carriers: ['QQ Two'] });
    expect(chooseFlightsToShow([late1, early, late2], NONE).shown).toEqual([early, late1, late2]);
    expect(chooseFlightsToShow([early, late2, late1], NONE).shown).toEqual([early, late2, late1]);
  });

  it('applies the stops limit too: a flight with 2 stops under maxStops 1 is outside (spec rev 56 §6.2)', () => {
    const r = chooseFlightsToShow([flight(600, 50, { stops: 2 }), flight(700, 99, { stops: 1 })], {
      ...LIMIT_25H,
      maxStops: 1,
    });
    expect(r.shown.map(view)).toEqual(['£99 at 700']);
    expect(r).toMatchObject({ overLimit: false, moreRead: 1, moreOutside: 1 });
  });

  it('does not reorder or change the flights it is given', () => {
    const input = [...FIVE];
    chooseFlightsToShow(input, LIMIT_25H);
    expect(input).toEqual(FIVE);
  });

  it('property: shown + moreRead is every flight; at most three shown; shown ones are flights given', () => {
    const arb = fc.array(
      fc.record({
        durationMinutes: fc.integer({ min: 1, max: 3000 }),
        pounds: fc.integer({ min: 1, max: 900 }),
        stops: fc.integer({ min: 0, max: 3 }),
        departsLocal: fc.constantFrom('06:10', '08:00', '12:30', '21:45'),
        arrivesLocal: fc.constantFrom('03:10', '07:00', '18:05', '23:30'),
      }),
      { maxLength: 30 },
    );
    const limits = fc.record({
      maxJourneyMinutes: fc.option(fc.integer({ min: 1, max: 3000 }), { nil: null }),
      maxStops: fc.option(fc.integer({ min: 0, max: 3 }), { nil: null }),
      arrivalWindowLocal: fc.constantFrom(null, { from: '06:00', to: '23:00' }),
      departureWindowLocal: fc.constantFrom(null, { from: '08:00', to: '20:00' }),
    });
    fc.assert(
      fc.property(arb, limits, (raw, l) => {
        const flights = raw.map((r) => flight(r.durationMinutes, r.pounds, r));
        const out = chooseFlightsToShow(flights, l);
        expect(out.shown.length + out.moreRead).toBe(flights.length);
        for (const s of out.shown) expect(flights).toContain(s);
        expect(out.moreOutside).toBeLessThanOrEqual(out.moreRead);
        const within = flights.filter((f) => Object.values(withinLimits(f, l)).every(Boolean));
        // why: only flights within the limits are shown while any is; every flight is a candidate when none is
        expect(out.shown.length).toBe(Math.min(3, within.length > 0 ? within.length : flights.length));
        expect(out.moreOutside).toBe(within.length > 0 ? flights.length - within.length : out.moreRead);
        expect(out.overLimit).toBe(within.length === 0 && flights.length > 0);
        if (within.length > 0) {
          const shortest = Math.min(...within.map((f) => f.durationMinutes));
          expect(out.shown.some((s) => s.durationMinutes === shortest && within.includes(s))).toBe(true);
        }
      }),
    );
  });
});
