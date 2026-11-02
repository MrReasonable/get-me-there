import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { chooseReturnsToShow, compareReturns, type FlightLimits } from '../../src/flights/choose.js';
import { RETURNS_SHOWN } from '../../src/flights/limits.js';
import type { ListedReturn } from '../../src/flights/types.js';

// Spec revision 56 §6.2 and §11: the return chooser, the outbound chooser's mirror (compareReturns: fromMinor, duration,
// stops, departure; RETURNS_SHOWN; no window on a return). Synthetic returns only.

/** A return of `durationMinutes` from `pounds` (the return's "From" price, whole pounds as pence), direct. */
function ret(durationMinutes: number, pounds: number, over: Partial<ListedReturn> = {}): ListedReturn {
  return {
    departsLocal: '14:20',
    arrivesLocal: '06:25',
    arrivesDayOffset: 1,
    durationMinutes,
    stops: 0,
    carriers: ['QQ Atlantic'],
    operatedBy: null,
    fromMinor: pounds * 100,
    ...over,
  };
}

const LIMIT_25H: FlightLimits = {
  maxJourneyMinutes: 1500,
  maxStops: null,
  arrivalWindowLocal: null,
  departureWindowLocal: null,
};
const NONE: FlightLimits = { maxJourneyMinutes: null, arrivalWindowLocal: null, departureWindowLocal: null };

/** Five returns of 600/700/1,560/900/800 minutes from £1,292/£1,286/£1,280/£1,286/£1,295. */
const FIVE = [ret(600, 1292), ret(700, 1286), ret(1560, 1280), ret(900, 1286), ret(800, 1295)];
const view = (r: ListedReturn) => `£${r.fromMinor / 100} at ${r.durationMinutes}`;

describe('chooseReturnsToShow (spec rev 56 §6.2: the outbound chooser mirrored for returns)', () => {
  it('shows the three cheapest within the limits by "from" price, then duration', () => {
    const r = chooseReturnsToShow(FIVE, LIMIT_25H);
    expect(r.shown.map(view)).toEqual(['£1286 at 700', '£1286 at 900', '£1292 at 600']);
    expect(r).toMatchObject({ overLimit: false, moreRead: 2, moreOutside: 1 });
    expect(RETURNS_SHOWN).toBe(3);
  });

  it('the shortest return within the limits is always among those shown', () => {
    const r = chooseReturnsToShow([...FIVE, ret(400, 1500)], LIMIT_25H);
    expect(r.shown.map(view)).toEqual(['£1286 at 700', '£1286 at 900', '£1500 at 400']);
  });

  it('a return with 2 stops under maxStops 1 is counted in moreOutside', () => {
    const r = chooseReturnsToShow([...FIVE, ret(500, 1200, { stops: 2 })], { ...LIMIT_25H, maxStops: 1 });
    expect(r.shown.map(view)).toEqual(['£1286 at 700', '£1286 at 900', '£1292 at 600']);
    expect(r).toMatchObject({ overLimit: false, moreRead: 3, moreOutside: 2 });
  });

  it('a return arriving 03:10 under an arrival window 06:00–23:00 is NOT outside (windows apply to the outbound)', () => {
    const l: FlightLimits = {
      ...LIMIT_25H,
      arrivalWindowLocal: { from: '06:00', to: '23:00' },
      departureWindowLocal: { from: '08:00', to: '20:00' },
    };
    const late = ret(500, 1100, { arrivesLocal: '03:10', departsLocal: '06:10' });
    const r = chooseReturnsToShow([...FIVE, late], l);
    expect(r.shown[0]).toBe(late);
    expect(r).toMatchObject({ overLimit: false, moreOutside: 1 });
  });

  it('every return outside the limits: the cheapest three, marked over the limit', () => {
    const outside = [ret(1600, 1292), ret(1700, 1286), ret(1560, 1280), ret(1900, 1286), ret(1800, 1295)];
    const r = chooseReturnsToShow(outside, LIMIT_25H);
    expect(r.shown.map(view)).toEqual(['£1280 at 1560', '£1286 at 1700', '£1286 at 1900']);
    expect(r).toMatchObject({ overLimit: true, moreRead: 2, moreOutside: 2 });
  });

  it('none shows none', () => {
    expect(chooseReturnsToShow([], NONE)).toEqual({
      shown: [],
      overLimit: false,
      moreRead: 0,
      moreOutside: 0,
    });
  });

  it('compareReturns orders by "from" price, then duration, stops and departure', () => {
    const base = ret(600, 1000);
    expect(compareReturns(ret(600, 999), base)).toBeLessThan(0);
    expect(compareReturns(ret(599, 1000), base)).toBeLessThan(0);
    expect(compareReturns(ret(600, 1000, { stops: 1 }), base)).toBeGreaterThan(0);
    expect(compareReturns(base, ret(600, 1000, { stops: 1 }))).toBeLessThan(0);
    expect(compareReturns(ret(600, 1000, { departsLocal: '14:19' }), base)).toBeLessThan(0);
    expect(compareReturns(ret(600, 1000, { carriers: ['QQ Air'] }), base)).toBe(0);
  });

  it('property: shown + moreRead is every return; at most three shown', () => {
    const arb = fc.array(
      fc.record({
        durationMinutes: fc.integer({ min: 1, max: 3000 }),
        pounds: fc.integer({ min: 1, max: 2000 }),
        stops: fc.integer({ min: 0, max: 3 }),
        departsLocal: fc.constantFrom('06:10', '08:00', '12:30', '21:45'),
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
        const returns = raw.map((r) => ret(r.durationMinutes, r.pounds, r));
        const out = chooseReturnsToShow(returns, l);
        expect(out.shown.length + out.moreRead).toBe(returns.length);
        expect(out.shown.length).toBeLessThanOrEqual(RETURNS_SHOWN);
      }),
    );
  });
});
