// Spec revision 55 §8.1 "The flight-list step", Candidates: the first FLIGHT_LIST_COUNT date pairs of the board's
// ranking, departed pairs out, one airport pair each; a pair whose newest list for the same cell is `read` and younger
// than 0.9 × the camoufox refresh is reused (counted in the 10, no page); a failed newest list of any age is read
// again. Pure: no repository, no clock.
import { asIata, asIsoDate, asIsoDateTime, cellKeyString, type IsoDateTime } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { cellKeyOf, type NewestList, selectFlightPairs } from '../../src/stages/flightLists/select.js';
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
    ...over,
  };
}
const ranked = (n: number): RankedDatePair[] => Array.from({ length: n }, (_, i) => pair(i));
const read = (fetchedAt: IsoDateTime): NewestList => ({ fetchedAt, status: 'read', listed: 'flights' });

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
    const failed: NewestList = { fetchedAt: ago(0), status: 'failed', listed: null };
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
    expect(selectFlightPairs(ranked(5), new Map(), NOW, 168, TODAY, 2).read).toHaveLength(2);
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
          newest.set(
            cellKeyOf(p),
            rand(2) === 0
              ? read(ago(rand(200)))
              : { fetchedAt: ago(rand(200)), status: 'failed', listed: null },
          );
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
