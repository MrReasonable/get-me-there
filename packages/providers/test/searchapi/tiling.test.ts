import {
  addDays,
  asIata,
  asIsoDate,
  type CellKey,
  cellKeyString,
  type DiscoveryQuery,
  daysBetween,
  generateCells,
} from '@gmt/core';
import { describe, expect, it } from 'vitest';
import {
  combinations,
  MAX_COMBINATIONS,
  outboundBlockDays,
  planRectangles,
} from '../../src/searchapi/calendar.js';

// Worked example (spec §1): LHR → JFK, 10–21 nights over a 182-day window.
const FROM = asIsoDate('2026-10-21');
const TO = addDays(FROM, 181); // 2027-04-20, inclusive: 182 departure days
const q: DiscoveryQuery = {
  origin: asIata('LHR'),
  destination: asIata('JFK'),
  departureFrom: FROM,
  departureTo: TO,
  minNights: 10,
  maxNights: 21,
  cabin: 'economy',
  currency: 'GBP',
};
const space = (d: DiscoveryQuery) => ({
  origins: [d.origin],
  destinations: [d.destination],
  departureFrom: d.departureFrom,
  departureTo: d.departureTo,
  minNights: d.minNights,
  maxNights: d.maxNights,
});
const keyOf = (c: CellKey) => cellKeyString(c);
const span = (a: string, b: string) => daysBetween(asIsoDate(a), asIsoDate(b)) + 1;
const firstRect = (plans: ReturnType<typeof planRectangles>) => {
  const r = plans[0]?.request;
  if (r?.kind !== 'rectangle') throw new Error('expected a rectangle');
  return r;
};

describe('planRectangles (spec §5.2 SearchApi tiling, §2 fact 2)', () => {
  const plans = planRectangles(q);

  it('tiles partition the band: every cell exactly once, nothing else', () => {
    const expected = generateCells(space(q)).map(keyOf).sort();
    const covered = plans.flatMap((p) => p.coveredCells.map(keyOf));
    expect(new Set(covered).size).toBe(covered.length);
    expect([...covered].sort()).toEqual(expected);
    expect(expected.length).toBe(182 * 12);
  });

  it('every tile is a rectangle within the 200-combination limit, and its cells lie inside it', () => {
    for (const p of plans) {
      if (p.request.kind !== 'rectangle') throw new Error('expected a rectangle');
      const r = p.request;
      expect(combinations(r)).toBeLessThanOrEqual(MAX_COMBINATIONS);
      for (const c of p.coveredCells) {
        expect(c.departureDate >= r.departFrom && c.departureDate <= r.departTo).toBe(true);
        expect(c.returnDate >= r.returnFrom && c.returnDate <= r.returnTo).toBe(true);
      }
    }
  });

  it('worked 10–21 band: 9 outbound days × 20 return days, 21 tiles per pair (b × (b + 11) ≤ 200)', () => {
    expect(outboundBlockDays(q)).toBe(9); // 9 × 20 = 180; 10 × 21 = 210 > 200
    expect(plans).toHaveLength(Math.ceil(182 / 9)); // 21
    const first = firstRect(plans);
    expect(span(first.departFrom, first.departTo)).toBe(9);
    expect(span(first.returnFrom, first.returnTo)).toBe(20);
    expect(first).toMatchObject({
      departFrom: '2026-10-21',
      returnFrom: '2026-10-31',
      returnTo: '2026-11-19',
    });
  });

  it('a fixed-length stay grows the block to 14 days: 13 tiles instead of 23 (14 × 14 = 196)', () => {
    const fixed = { ...q, minNights: 14, maxNights: 14 };
    expect(outboundBlockDays(fixed)).toBe(14);
    const p = planRectangles(fixed);
    expect(p).toHaveLength(13);
    expect(combinations(firstRect(p))).toBe(196);
  });

  it('a wide band shrinks the block: 0–90 nights fits 2 outbound days (2 × 92 = 184; 3 × 93 = 279)', () => {
    const wide = { ...q, departureTo: addDays(FROM, 29), minNights: 0, maxNights: 90 };
    expect(outboundBlockDays(wide)).toBe(2);
    expect(span(firstRect(planRectangles(wide)).departFrom, firstRect(planRectangles(wide)).departTo)).toBe(
      2,
    );
  });

  it('a spread of 10 sits exactly on the limit: 10 outbound days × 20 return days = 200 (synthetic)', () => {
    const exact = { ...q, minNights: 10, maxNights: 20 };
    expect(outboundBlockDays(exact)).toBe(10);
    expect(combinations(firstRect(planRectangles(exact)))).toBe(200);
  });

  it('for every spread 0..90 and several windows, the block is the largest b with b × (b + spread) ≤ 200', () => {
    for (const windowDays of [1, 3, 9, 14, 30, 182])
      for (let spread = 0; spread <= 90; spread++) {
        const band = { ...q, departureTo: addDays(FROM, windowDays - 1), minNights: 0, maxNights: spread };
        const b = outboundBlockDays(band);
        expect(b * (b + spread)).toBeLessThanOrEqual(MAX_COMBINATIONS);
        // why: unless the window bounds it, one more day must overflow, so no plan uses more tiles than needed.
        if (b < windowDays) expect((b + 1) * (b + 1 + spread)).toBeGreaterThan(MAX_COMBINATIONS);
        else expect(b).toBe(windowDays);
      }
  });

  it('for every spread 0..90 over a 30-day window, every tile is within 200, tiles partition the band, and a full block is b × (b + spread)', () => {
    for (let spread = 0; spread <= 90; spread++) {
      const band = { ...q, departureTo: addDays(FROM, 29), minNights: 0, maxNights: spread };
      const b = outboundBlockDays(band);
      const plans = planRectangles(band);
      const covered = plans.flatMap((p) => p.coveredCells.map(keyOf)).sort();
      expect(covered).toEqual(generateCells(space(band)).map(keyOf).sort());
      for (const p of plans) {
        if (p.request.kind !== 'rectangle') throw new Error('expected a rectangle');
        expect(combinations(p.request)).toBeLessThanOrEqual(MAX_COMBINATIONS);
      }
      expect(combinations(firstRect(plans))).toBe(b * (b + spread));
    }
  });

  it('the block never exceeds the window: a 3-day window is one 3-day tile', () => {
    const short = { ...q, departureTo: addDays(FROM, 2) };
    expect(outboundBlockDays(short)).toBe(3);
    expect(planRectangles(short)).toHaveLength(1);
  });

  it('is deterministic and indexes tiles 0..n-1', () => {
    expect(planRectangles(q)).toEqual(plans);
    expect(plans.map((p) => p.index)).toEqual(plans.map((_, i) => i));
  });

  it('re-plans over a cells subset and still partitions exactly that subset', () => {
    const all = generateCells(space(q)).map(({ origin, destination, departureDate, returnDate }) => ({
      origin,
      destination,
      departureDate,
      returnDate,
    }));
    const subset = all.filter((_, i) => i % 7 === 0).reverse(); // unordered on purpose
    const re = planRectangles({ ...q, cells: subset });
    expect(re.flatMap((p) => p.coveredCells.map(keyOf)).sort()).toEqual(subset.map(keyOf).sort());
    expect(re.length).toBeLessThanOrEqual(plans.length);
  });

  it('a subset carrying an off-band cell still yields tiles within the limit (the shrink guard)', () => {
    const [a] = generateCells(space(q));
    if (a === undefined) throw new Error('cells');
    const offBand = {
      origin: a.origin,
      destination: a.destination,
      departureDate: a.departureDate,
      returnDate: addDays(a.departureDate, 60),
    };
    const near = {
      ...offBand,
      departureDate: addDays(a.departureDate, 5),
      returnDate: addDays(a.departureDate, 15),
    };
    for (const p of planRectangles({ ...q, cells: [offBand, near] }))
      if (p.request.kind === 'rectangle')
        expect(combinations(p.request)).toBeLessThanOrEqual(MAX_COMBINATIONS);
  });

  it('an empty subset plans no tiles', () => {
    expect(planRectangles({ ...q, cells: [] })).toEqual([]);
  });
});
