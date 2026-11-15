import { asIsoDateTime } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import {
  lowestOf,
  lowestPerRun,
  type RunPoint,
  type SearchRun,
} from '../../../../src/views/Dates/folds/priceHistory.js';
import { cellAt, fetchPoint, routeHistory } from '../../../fixtures.wp10.js';

// Ruling 19, Price over time: one lowest calendar price per run of this search, newest first, at most six.

const point = (run: string, hoursAgo: number, pence: number) =>
  fetchPoint(hoursAgo, pence, cellAt('2027-03-14', 14), { executionId: run });
const history = (...points: ReturnType<typeof point>[]) =>
  routeHistory({ calendarSeries: [{ providerId: 'travelpayouts', cabin: 'economy', points }] });

const run = (id: string, startedAt: string | null = '2026-10-14T12:00:00.000Z'): SearchRun => ({
  id,
  startedAt: startedAt === null ? null : asIsoDateTime(startedAt),
});

describe('lowestPerRun', () => {
  it('keeps the lowest point of each run over every history and series, in the runs’ own order', () => {
    const a = history(point('r1', 48, 40_000), point('r2', 24, 39_000));
    const b = history(point('r1', 48, 38_000), point('r2', 24, 41_000));
    expect(lowestPerRun([a, b], [run('r2'), run('r1')]).map((p) => [p.executionId, p.pricePence])).toEqual([
      ['r2', 39_000],
      ['r1', 38_000],
    ]);
  });

  it('orders by the run, not by when its lowest price was fetched, and dates the row by the run’s start', () => {
    // r2 is the newer run, but its lowest price was fetched before r1's
    const h = history(point('r1', 1, 40_000), point('r2', 30, 39_000));
    const out = lowestPerRun(
      [h],
      [run('r2', '2026-10-14T13:00:00.000Z'), run('r1', '2026-10-14T09:00:00.000Z')],
    );
    expect(out.map((p) => [p.executionId, p.at])).toEqual([
      ['r2', '2026-10-14T13:00:00.000Z'],
      ['r1', '2026-10-14T09:00:00.000Z'],
    ]);
  });

  it('dates a run that names no start by when its price was fetched', () => {
    const h = history(point('r1', 24, 40_000));
    expect(lowestPerRun([h], [run('r1', null)]).map((p) => p.at)).toEqual([
      h.calendarSeries[0]?.points[0]?.at,
    ]);
  });

  it('keeps the first point met when two are equal, and skips a history still loading', () => {
    const a = history(point('r1', 48, 40_000));
    const b = history(point('r1', 24, 41_000));
    expect(lowestPerRun([undefined, a, b], [run('r1')]).map((p) => p.pricePence)).toEqual([40_000]);
    const c = history(point('r1', 24, 40_000));
    expect(lowestPerRun([a, c], [run('r1')]).map((p) => p.provenance.fetchedAt)).toEqual([
      a.calendarSeries[0]?.points[0]?.provenance.fetchedAt,
    ]);
  });

  it('leaves out runs that are not this search’s or have no point, and stops at the limit', () => {
    const h = history(
      ...[1, 2, 3, 4, 5, 6, 7, 8].map((k) => point(`r${k}`, k * 24, 40_000 + k)),
      point('other', 12, 1),
    );
    const runs = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((k) => run(`r${k}`));
    expect(lowestPerRun([h], runs).map((p) => p.executionId)).toEqual(['r1', 'r2', 'r3', 'r4', 'r5', 'r6']);
    expect(lowestPerRun([h], runs, 2).map((p) => p.executionId)).toEqual(['r1', 'r2']);
    expect(lowestPerRun([h], [])).toEqual([]);
  });
});

describe('lowestOf', () => {
  const p = (pence: number, run: string): RunPoint => ({
    executionId: run,
    at: asIsoDateTime('2026-10-14T12:00:00.000Z'),
    pricePence: pence,
    provenance: fetchPoint(1, pence).provenance,
    stale: false,
    truncated: false,
  });
  it('is the cheapest, the newest of equals, and null with none', () => {
    expect(lowestOf([p(500, 'new'), p(400, 'mid'), p(400, 'old')])?.executionId).toBe('mid');
    expect(lowestOf([])).toBeNull();
  });
});
