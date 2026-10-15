import {
  asIata,
  asIsoDate,
  type CellKey,
  cellKeyString,
  type DiscoveryQuery,
  type Iata,
  type TilePlan,
} from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { buildRequestUrl } from '../../src/travelpayouts/provider.js';
import { cellsOf, originParam, planMonthTiles, tileParams } from '../../src/travelpayouts/tiles.js';
import { airports, cellsFor, noMetro, query } from './harness.js';

const [LHR, LGW, JFK, EWR] = [asIata('LHR'), asIata('LGW'), asIata('JFK'), asIata('EWR')];
/** Spec §5.2 worked example, one pair: 182 days (2027-01-01 … 2027-07-01, 7 months), 10–21 nights. */
const worked = (origin: Iata, destination: Iata): DiscoveryQuery =>
  query({
    origin,
    destination,
    departureFrom: asIsoDate('2027-01-01'),
    departureTo: asIsoDate('2027-07-01'),
    minNights: 10,
    maxNights: 21,
  });

function expectPartition(cells: readonly CellKey[], plans: readonly TilePlan[]): void {
  const keys = plans.flatMap((p) => p.coveredCells.map(cellKeyString));
  expect(keys).toHaveLength(cells.length);
  expect(new Set(keys).size).toBe(keys.length);
  expect(new Set(keys)).toEqual(new Set(cells.map(cellKeyString)));
  for (const [i, p] of plans.entries()) {
    expect(p.index).toBe(i);
    const months = [...new Set(p.coveredCells.map((c) => c.departureDate.slice(0, 7)))];
    expect(months).toEqual([p.request.kind === 'month' ? p.request.month : 'not a month tile']);
  }
}

describe('planMonthTiles (spec §5.2: per pair, one month tile per departure month)', () => {
  it("one tile per departure month: 7 for the worked example's 182-day window", () => {
    expect(planMonthTiles(worked(LHR, JFK)).map((p) => p.request)).toEqual(
      ['2027-01', '2027-02', '2027-03', '2027-04', '2027-05', '2027-06', '2027-07'].map((m) => ({
        kind: 'month',
        month: m,
      })),
    );
  });

  it('worked example: 4 pairs × 7 months = 28 logical tiles', () => {
    const pairs = [worked(LHR, JFK), worked(LHR, EWR), worked(LGW, JFK), worked(LGW, EWR)];
    expect(pairs.reduce((n, q) => n + planMonthTiles(q).length, 0)).toBe(28);
  });

  it.each([
    ['the default query', query()],
    ['the worked example pair', worked(LHR, JFK)],
    [
      'every 7th cell of the worked pair (re-plan subset)',
      query({ ...worked(LHR, JFK), cells: cellsOf(worked(LHR, JFK)).filter((_, i) => i % 7 === 0) }),
    ],
    [
      'a December → January window (year end)',
      query({ departureFrom: asIsoDate('2027-12-20'), departureTo: asIsoDate('2028-01-10') }),
    ],
    [
      'a window across the leap day (2028-02-25 … 2028-03-02)',
      query({ departureFrom: asIsoDate('2028-02-25'), departureTo: asIsoDate('2028-03-02') }),
    ],
  ] as const)('tiles partition the cells: %s', (_label, q) => {
    expectPartition(cellsOf(q), planMonthTiles(q));
  });

  it('a leap-day window has a February tile holding the 29 February departures and a March tile', () => {
    const plans = planMonthTiles(
      query({ departureFrom: asIsoDate('2028-02-25'), departureTo: asIsoDate('2028-03-02') }),
    );
    expect(plans.map((p) => p.request)).toEqual([
      { kind: 'month', month: '2028-02' },
      { kind: 'month', month: '2028-03' },
    ]);
    expect(plans[0]?.coveredCells.filter((c) => c.departureDate === '2028-02-29')).toHaveLength(3);
  });

  it('orders tiles by month even when a re-plan subset arrives out of order', () => {
    const cells = cellsOf(
      query({ departureFrom: asIsoDate('2027-12-20'), departureTo: asIsoDate('2028-01-10') }),
    ).reverse();
    expect(planMonthTiles(query({ cells })).map((p) => p.request)).toEqual([
      { kind: 'month', month: '2027-12' },
      { kind: 'month', month: '2028-01' },
    ]);
  });

  it('is pure and deterministic', () => {
    expect(planMonthTiles(worked(LHR, JFK))).toEqual(planMonthTiles(worked(LHR, JFK)));
  });

  it('refuses cells from another pair (the query stays per pair)', () => {
    expect(() =>
      planMonthTiles(query({ cells: cellsFor(LGW, JFK, '2027-03-10', '2027-03-10', 10, 10) })),
    ).toThrow(/per \(origin, destination\) pair/);
  });
});

describe('the metro origin (spec §2 and §5.2 rev 14: the metro only when two or more of the definition’s origins share it)', () => {
  it('sends the shared metro code when the definition lists LHR and LGW', () => {
    expect(originParam(query({ definitionOrigins: [LHR, LGW] }), airports)).toBe('LON');
    expect(originParam(query({ origin: LGW, definitionOrigins: [LHR, LGW] }), airports)).toBe('LON');
  });

  it('sends the airport when the definition has one London airport (a lone airport is queried by its own code)', () => {
    expect(originParam(query({ definitionOrigins: [LHR] }), airports)).toBe('LHR');
  });

  it('sends the airport when definitionOrigins is absent (treated as the pair origin alone)', () => {
    const { definitionOrigins: _omit, ...q } = query();
    expect(originParam(q, airports)).toBe('LHR');
  });

  it("sends the airport when the definition's other origins map to other metros or none", () => {
    expect(originParam(query({ definitionOrigins: [LHR, JFK, asIata('AAA')] }), airports)).toBe('LHR');
  });

  it('sends the airport when there is no metro', () => {
    expect(originParam(query(), noMetro)).toBe('LHR');
  });

  it('ignores a metro code that is not three upper-case letters', () => {
    expect(originParam(query(), { metroOf: () => 'LONDON' })).toBe('LHR');
  });

  it('tileParams carries the vendor origin, the pair and the month', () => {
    const [first] = planMonthTiles(query());
    if (first === undefined) throw new Error('no tile');
    expect(tileParams(first, query(), airports)).toEqual({
      origin: 'LON',
      pairOrigin: 'LHR',
      destination: 'JFK',
      month: '2027-03',
    });
  });

  it('refuses a tile that is not a month tile', () => {
    const rect: TilePlan = {
      index: 0,
      coveredCells: cellsOf(query()),
      request: {
        kind: 'rectangle',
        departFrom: asIsoDate('2027-03-10'),
        departTo: asIsoDate('2027-03-20'),
        returnFrom: asIsoDate('2027-03-20'),
        returnTo: asIsoDate('2027-04-01'),
      },
    };
    expect(() => tileParams(rect, query(), airports)).toThrow(/month tiles/);
  });

  it.each([
    ['2027-12', '2027-12'],
    ['2028-02', '2028-02'],
    ['2028-01', '2028-01'],
  ] as const)('buildRequestUrl sends departure_at=%s for the %s tile', (month, expected) => {
    const plans = planMonthTiles(
      query({ departureFrom: asIsoDate('2027-12-20'), departureTo: asIsoDate('2028-02-29') }),
    );
    const plan = plans.find((p) => p.request.kind === 'month' && p.request.month === month);
    if (plan === undefined) throw new Error(`no ${month} tile`);
    expect(buildRequestUrl(tileParams(plan, query(), airports), 1).searchParams.get('departure_at')).toBe(
      expected,
    );
  });
});
