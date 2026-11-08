// Spec revision 55 §8.1 "The flight-list step", Candidates: the first FLIGHT_LIST_COUNT date pairs of the board's
// ranking, departed pairs out, one airport pair each; a pair whose newest list for the same cell is `read` and younger
// than 0.9 × the camoufox refresh is reused (counted in the 10, no page); a failed newest list of any age is read
// again. Pure: no repository, no clock.
import {
  asIata,
  asIsoDate,
  asIsoDateTime,
  BOOKING_STATUS,
  type BookingStatus,
  cellKeyString,
  type FlightLimits,
  type IsoDateTime,
  RETURN_STATUS,
  type ReturnStatus,
} from '@gmt/core';
import { describe, expect, it } from 'vitest';
import {
  cellKeyOf,
  confirmQueue,
  listReusable,
  type NewestList,
  OUTBOUND_ONLY,
  type ReusePlan,
  selectFlightPairs,
} from '../../src/stages/flightLists/select.js';
import type { RankedDatePair } from '../../src/types.js';

const LHR = asIata('LHR');
const LGW = asIata('LGW');
const JFK = asIata('JFK');
const NOW = asIsoDateTime('2027-03-01T12:00:00.000Z');
const TODAY = asIsoDate('2027-03-01');
const HOUR = 3_600_000;
const ago = (hours: number): IsoDateTime =>
  asIsoDateTime(new Date(Date.parse(NOW) - hours * HOUR).toISOString());

/** The i-th ranked pair: departing i days after 2 Mar 2027, ten nights, London Heathrow to New York JFK. */
function pair(i: number, over: Partial<RankedDatePair> = {}): RankedDatePair {
  const dep = new Date(Date.parse('2027-03-02T00:00:00.000Z') + i * 86_400_000);
  const ret = new Date(dep.getTime() + 10 * 86_400_000);
  return {
    departureDate: asIsoDate(dep.toISOString().slice(0, 10)),
    returnDate: asIsoDate(ret.toISOString().slice(0, 10)),
    origin: LHR,
    destination: JFK,
    pricePence: 40_000 + i,
    providerId: 'camoufox',
    sourceKind: 'scraped-self',
    basis: 'calendar',
    current: true,
    stale: false,
    ...over,
  };
}
const ranked = (n: number): RankedDatePair[] => Array.from({ length: n }, (_, i) => pair(i));
const read = (fetchedAt: IsoDateTime, over: Partial<NewestList> = {}): NewestList => ({
  fetchedAt,
  status: 'read',
  listed: 'flights',
  returnStatus: null,
  bookingStatus: null,
  limits: null,
  transientStreak: 0,
  ...over,
});
const failedList = (fetchedAt: IsoDateTime): NewestList => ({
  ...read(fetchedAt),
  status: 'failed',
  listed: null,
});

describe('selectFlightPairs', () => {
  it('reads the first 10 of 15 ranked pairs, in the ranking order', () => {
    const r = ranked(15);
    const out = selectFlightPairs(r, new Map(), NOW, 168, TODAY);
    expect(out.read).toEqual(r.slice(0, 10));
    expect(out.reused).toEqual([]);
  });

  it('reuses a read list of the same cell younger than 0.9 × refresh (150 h of 151.2 h) and reads one at 152 h', () => {
    const r = ranked(3);
    const [first, second] = r;
    if (first === undefined || second === undefined) throw new Error('fixture');
    const newest = new Map([
      [cellKeyOf(first), read(ago(150))],
      [cellKeyOf(second), read(ago(152))],
    ]);
    const out = selectFlightPairs(r, newest, NOW, 168, TODAY);
    expect(out.reused).toEqual([first]);
    expect(out.read).toEqual(r.slice(1));
  });

  it('a list exactly 0.9 × refresh old (151.2 h) is no longer reused: reuse is strictly younger', () => {
    const [first] = ranked(1);
    if (first === undefined) throw new Error('fixture');
    const out = selectFlightPairs([first], new Map([[cellKeyOf(first), read(ago(151.2))]]), NOW, 168, TODAY);
    expect(out.reused).toEqual([]);
    expect(out.read).toEqual([first]);
  });

  it('never reuses a list of another airport pair on the same dates', () => {
    const [first] = ranked(1);
    if (first === undefined) throw new Error('fixture');
    const other = { ...first, origin: LGW };
    const out = selectFlightPairs([first], new Map([[cellKeyOf(other), read(ago(1))]]), NOW, 168, TODAY);
    expect(out.read).toEqual([first]);
    expect(out.reused).toEqual([]);
  });

  it('reads again a pair whose newest list failed, whatever its age', () => {
    const [first] = ranked(1);
    if (first === undefined) throw new Error('fixture');
    const failed = failedList(ago(0));
    const out = selectFlightPairs([first], new Map([[cellKeyOf(first), failed]]), NOW, 168, TODAY);
    expect(out.read).toEqual([first]);
  });

  it('drops a pair departing on or before today in London', () => {
    const today = pair(0, { departureDate: TODAY });
    const past = pair(0, { departureDate: asIsoDate('2027-02-27') });
    const later = ranked(2);
    const out = selectFlightPairs([today, past, ...later], new Map(), NOW, 168, TODAY);
    expect(out.read).toEqual(later);
  });

  it('honours a smaller count', () => {
    expect(selectFlightPairs(ranked(5), new Map(), NOW, 168, TODAY, OUTBOUND_ONLY, 2).read).toHaveLength(2);
  });

  it('cellKeyOf is cellKeyString over origin, destination, departure and return', () => {
    const [first] = ranked(1);
    if (first === undefined) throw new Error('fixture');
    expect(cellKeyOf(first)).toBe(cellKeyString(first));
  });

  // why: a hand-rolled property (the engine has no fast-check): seeded pseudo-random rankings, departed pairs and
  // newest lists; the output is always a subsequence of the first 10 not-departed pairs, read + reused ≤ 10, in order
  it('property: the output is the first 10 not-departed pairs in ranking order, split into read and reused', () => {
    let seed = 20_271_101;
    const rand = (n: number): number => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed % n;
    };
    for (let run = 0; run < 200; run++) {
      const n = rand(25);
      const r = Array.from({ length: n }, (_, i) =>
        rand(4) === 0
          ? pair(i, { departureDate: asIsoDate(`2027-02-${String(10 + rand(19)).padStart(2, '0')}`) })
          : pair(i),
      );
      const newest = new Map<string, NewestList>();
      for (const p of r)
        if (rand(3) === 0)
          newest.set(cellKeyOf(p), rand(2) === 0 ? read(ago(rand(200))) : failedList(ago(rand(200))));
      const out = selectFlightPairs(r, newest, NOW, 168, TODAY);
      const expected = r.filter((p) => p.departureDate > TODAY).slice(0, 10);
      expect(out.read.length + out.reused.length).toBeLessThanOrEqual(10);
      const chosen = new Set([...out.read, ...out.reused]);
      expect(expected.filter((p) => chosen.has(p))).toEqual(expected);
      expect(out.read).toEqual(expected.filter((p) => out.read.includes(p)));
      expect(out.reused).toEqual(expected.filter((p) => out.reused.includes(p)));
      for (const p of out.reused) expect(newest.get(cellKeyOf(p))?.status).toBe('read');
    }
  });
});

// Spec rev 56 §8.1 "Reuse" (Review Focus 3; R-retry; R-unverified): with a return phase planned, a young read list is
// reused only when its return phase finished under the current limits (and, with the booking read planned, its booking
// did too, or no outbound was listed), or when its two newest lists both ended transient; else it is read once more.
describe('selectFlightPairs with a return phase planned (spec rev 56 §8.1 "Reuse")', () => {
  const CURRENT: FlightLimits = {
    maxJourneyMinutes: 1500,
    maxStops: 0,
    departureWindowLocal: null,
    arrivalWindowLocal: { from: '06:00', to: '23:00' },
  };
  const RETURNS: ReusePlan = { returns: true, booking: false, current: CURRENT };
  const BOOKING: ReusePlan = { returns: true, booking: true, current: CURRENT };
  const [first] = ranked(1);
  if (first === undefined) throw new Error('fixture');
  const outcome = (n: NewestList, plan: ReusePlan): 'reused' | 'read' =>
    selectFlightPairs([first], new Map([[cellKeyOf(first), n]]), NOW, 168, TODAY, plan).reused.length === 1
      ? 'reused'
      : 'read';
  const young = (over: Partial<NewestList>): NewestList =>
    read(ago(150), { limits: CURRENT, returnStatus: 'read', bookingStatus: 'read', ...over });

  it.each(RETURN_STATUS.map((s) => [s]))(
    'return status %s, 150 h old, the same limits',
    (s: ReturnStatus) => {
      const finished = s === 'read' || s === 'no-outbound';
      expect(outcome(young({ returnStatus: s, bookingStatus: null }), RETURNS)).toBe(
        finished ? 'reused' : 'read',
      );
    },
  );

  it('a list with no return read (stored before 0012, or read outbound-only) is read again', () => {
    expect(outcome(young({ returnStatus: null, limits: null, bookingStatus: null }), RETURNS)).toBe('read');
  });

  it('a finished list read under other limits (maxStops 1 against 0), or with none stored, is read again', () => {
    expect(outcome(young({ limits: { ...CURRENT, maxStops: 1 } }), RETURNS)).toBe('read');
    expect(outcome(young({ limits: null }), RETURNS)).toBe('read');
    expect(outcome(young({ limits: { ...CURRENT } }), RETURNS)).toBe('reused');
  });

  it.each(BOOKING_STATUS.map((s) => [s]))(
    'booking planned: a read return with booking %s',
    (s: BookingStatus) => {
      const finished = s === 'read' || s === 'no-pairing';
      expect(outcome(young({ bookingStatus: s }), BOOKING)).toBe(finished ? 'reused' : 'read');
    },
  );

  it('booking planned: a no-outbound list needs no booking read; a read one with no booking is read again', () => {
    expect(outcome(young({ returnStatus: 'no-outbound', bookingStatus: null }), BOOKING)).toBe('reused');
    expect(outcome(young({ bookingStatus: null }), BOOKING)).toBe('read');
  });

  it('booking not planned: the booking status is not consulted', () => {
    for (const s of [...BOOKING_STATUS, null])
      expect(outcome(young({ bookingStatus: s }), RETURNS)).toBe('reused');
  });

  it('R-retry: transientStreak 2 is reused whatever its statuses, until 0.9 × refresh; streak 1 is read once more', () => {
    const transient = { returnStatus: 'not-settled' as const, bookingStatus: null, limits: CURRENT };
    expect(outcome(read(ago(2), { ...transient, transientStreak: 1 }), BOOKING)).toBe('read');
    expect(outcome(read(ago(2), { ...transient, transientStreak: 2 }), BOOKING)).toBe('reused');
    expect(outcome(read(ago(150), { ...transient, transientStreak: 2, limits: null }), BOOKING)).toBe(
      'reused',
    );
    expect(outcome(read(ago(152), { ...transient, transientStreak: 2 }), BOOKING)).toBe('read');
  });

  it('ruling 21.6 I1: a read return whose booking ended skipped is read once more (streak 1), then reused (streak 2)', () => {
    // why: the streak comes from the repository (BOOKING_REREAD counts a skipped booking, pinned in db's test); a
    // structural skip (not-cheapest-view) would otherwise be read again every run
    const skipped = young({ bookingStatus: 'skipped' });
    expect(outcome({ ...skipped, transientStreak: 1 }, BOOKING)).toBe('read');
    expect(outcome({ ...skipped, transientStreak: 2 }, BOOKING)).toBe('reused');
  });

  it('no return phase planned: every young read list is reused whatever its statuses, not-verified included', () => {
    for (const s of [...RETURN_STATUS, null])
      expect(outcome(young({ returnStatus: s, limits: null }), OUTBOUND_ONLY)).toBe('reused');
  });

  it('a failed newest list is read always, whatever the plan or the streak', () => {
    for (const plan of [OUTBOUND_ONLY, RETURNS, BOOKING])
      expect(outcome({ ...failedList(ago(1)), transientStreak: 2 }, plan)).toBe('read');
  });

  it('listReusable is the rule selectFlightPairs applies (the on-demand read shares it)', () => {
    const n = young({});
    expect(listReusable(n, NOW, 168, BOOKING)).toBe(true);
    expect(listReusable({ ...n, bookingStatus: 'expand-failed' }, NOW, 168, BOOKING)).toBe(false);
    expect(listReusable({ ...n, fetchedAt: ago(151.2) }, NOW, 168, OUTBOUND_ONLY)).toBe(false);
  });
});

// Design 2026-11-08 §4.2, §4.3: the step's queue is every current calendar price and every stale verified figure, in
// calendar price order (the ranking's order within equal prices); a fresh, current verified figure is a confirmed trip already (it enters the standings by reuse), and a
// figure that is not current (a superseded calendar price, a verified one the latest search did not see) is neither.
describe('confirmQueue (design 2026-11-08 §4.2)', () => {
  it('keeps current calendar prices and stale verified figures in ranking order; drops fresh verified and non-current ones', () => {
    const calendar = pair(0);
    const freshVerified = pair(1, { basis: 'verified', pricePence: 30_000, providerId: 'searchapi' });
    const staleVerified = pair(2, { basis: 'verified', stale: true, providerId: 'searchapi' });
    const notSeen = pair(3, { basis: 'verified', current: false, providerId: 'searchapi' });
    const superseded = pair(4, { current: false, pricePence: 20_000 });
    const staleCalendar = pair(5, { stale: true });
    const later = pair(6);
    expect(
      confirmQueue([freshVerified, calendar, staleVerified, notSeen, superseded, staleCalendar, later]),
    ).toEqual([calendar, staleVerified, staleCalendar, later]);
  });

  // why: design 2026-11-08 §4.2 (controller ruling on the final whole-branch review): the queue is in calendar price
  // order, cheapest first, not the shared ranking's tier order (which puts a stale verified figure in its own tier)
  it('orders the queue by price, cheapest first: a stale verified pair at £900 queues after a £300 calendar pair', () => {
    const staleVerified = pair(0, {
      basis: 'verified',
      stale: true,
      pricePence: 90_000,
      providerId: 'searchapi',
    });
    const calendar = pair(1, { pricePence: 30_000 });
    expect(confirmQueue([staleVerified, calendar])).toEqual([calendar, staleVerified]);
  });

  it("keeps the ranking's order within equal prices", () => {
    const a = pair(0, { pricePence: 30_000 });
    const b = pair(1, { pricePence: 30_000, stale: true });
    const c = pair(2, { pricePence: 29_000 });
    expect(confirmQueue([b, a, c])).toEqual([c, b, a]);
  });

  it('the read split of the queue has no count: all 300 pairs are read or reused', () => {
    const r = ranked(300);
    const [first] = r;
    if (first === undefined) throw new Error('fixture');
    const out = selectFlightPairs(
      confirmQueue(r),
      new Map([[cellKeyOf(first), read(ago(1))]]),
      NOW,
      168,
      TODAY,
      OUTBOUND_ONLY,
      Number.POSITIVE_INFINITY,
    );
    expect(out.reused).toEqual([first]);
    expect(out.read).toEqual(r.slice(1));
  });
});
