import { asIsoDateTime } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { lowestOf, lowestPerRun, type RunPoint } from '../../../../src/views/Dates/folds/priceHistory.js';
import { cellAt, fetchPoint, routeHistory } from '../../../fixtures.wp10.js';

// Ruling 19, Price over time: one lowest calendar price per run of this search, newest first, at most six.

const point = (run: string, hoursAgo: number, pence: number) =>
  fetchPoint(hoursAgo, pence, cellAt('2027-03-14', 14), { executionId: run });
const history = (...points: ReturnType<typeof point>[]) =>
  routeHistory({ calendarSeries: [{ providerId: 'travelpayouts', cabin: 'economy', points }] });

describe('lowestPerRun', () => {
  it('keeps the lowest point of each run over every history and series, newest run first', () => {
    const a = history(point('r1', 48, 40_000), point('r2', 24, 39_000));
    const b = history(point('r1', 48, 38_000), point('r2', 24, 41_000));
    expect(lowestPerRun([a, b], new Set(['r1', 'r2'])).map((p) => [p.executionId, p.pricePence])).toEqual([
      ['r2', 39_000],
      ['r1', 38_000],
    ]);
  });

  it('keeps the first point met when two are equal, and skips a history still loading', () => {
    const a = history(point('r1', 48, 40_000));
    const b = history(point('r1', 24, 40_000));
    expect(lowestPerRun([undefined, a, b], new Set(['r1'])).map((p) => p.at)).toEqual([
      a.calendarSeries[0]?.points[0]?.at,
    ]);
  });

  it('leaves out runs that are not this search’s, and stops at the limit', () => {
    const h = history(
      ...[1, 2, 3, 4, 5, 6, 7, 8].map((k) => point(`r${k}`, k * 24, 40_000 + k)),
      point('other', 12, 1),
    );
    const ids = new Set(['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'r8']);
    expect(lowestPerRun([h], ids).map((p) => p.executionId)).toEqual(['r1', 'r2', 'r3', 'r4', 'r5', 'r6']);
    expect(lowestPerRun([h], ids, 2).map((p) => p.executionId)).toEqual(['r1', 'r2']);
    expect(lowestPerRun([h], new Set())).toEqual([]);
  });

  it('orders by fetch time, so equal times keep the order met', () => {
    const h = history(point('r1', 24, 40_000), point('r2', 24, 41_000));
    expect(lowestPerRun([h], new Set(['r1', 'r2'])).map((p) => p.executionId)).toEqual(['r1', 'r2']);
    // an older point arriving first is still listed after the newer one
    const g = history(point('r3', 72, 40_000), point('r4', 24, 41_000));
    expect(lowestPerRun([g], new Set(['r3', 'r4'])).map((p) => p.executionId)).toEqual(['r4', 'r3']);
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
