import { describe, expect, it } from 'vitest';
import * as barrel from '../../src/index.js';
import { effectiveAge, formatAgeCompact } from '../../src/labels/age.js';
import { dedupByItinerary } from '../../src/results/dedup.js';
import { priceUnconfirmed, rankRows, sortRows } from '../../src/results/rank.js';
import type { SortKey } from '../../src/results/types.js';
import { calendarRow, NOW, row } from '../helpers/rows.js';

const sellers = (rows: { seller: string | null }[]) => rows.map((r) => r.seller);

describe('dedupByItinerary (spec §6.5; ruling 3)', () => {
  it('the primary is the best by class, then price: a verified offer heads its itinerary over cheaper ones', () => {
    const out = dedupByItinerary(
      [
        row({ seller: 'A', pricePence: 52_000, verdictClass: 'verified' }),
        row({ seller: 'B', pricePence: 48_000, verdictClass: 'failed', unverified: [] }),
        row({ seller: 'C', pricePence: 50_000, verdictClass: 'partially-verified', unverified: ['cabin'] }),
      ],
      NOW,
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ seller: 'A', pricePence: 52_000, verdictClass: 'verified' });
    // Other offers, cheapest first, each with its own class and unverified names (review prov-002).
    expect(out[0]?.otherOffers.map((o) => [o.seller, o.pricePence, o.verdictClass, o.unverified])).toEqual([
      ['B', 48_000, 'failed', []],
      ['C', 50_000, 'partially-verified', ['cabin']],
    ]);
  });

  it('other offers at the same price are ordered by the row order (class, then seller)', () => {
    const out = dedupByItinerary(
      [
        row({ seller: 'Head', pricePence: 30_000 }),
        row({ seller: 'Y', pricePence: 45_000, verdictClass: 'failed' }),
        row({ seller: 'X', pricePence: 45_000 }),
      ],
      NOW,
    );
    expect(out[0]?.otherOffers.map((o) => o.seller)).toEqual(['X', 'Y']);
  });

  it('a cheaper partially-verified offer does not hide a slightly dearer verified one (review pft-007)', () => {
    const out = dedupByItinerary(
      [
        row({ seller: 'P', pricePence: 50_000, verdictClass: 'partially-verified' }),
        row({ seller: 'V', pricePence: 50_200 }),
      ],
      NOW,
    );
    expect(out[0]?.seller).toBe('V');
  });

  it('within a class, a seen offer beats a cheaper one the latest search no longer returned', () => {
    const out = dedupByItinerary(
      [
        row({ seller: 'Gone', pricePence: 40_000, notSeenInLatest: { ageHours: 30 } }),
        row({ seller: 'Seen', pricePence: 45_000 }),
      ],
      NOW,
    );
    expect(out[0]?.seller).toBe('Seen');
    // the offer that is gone stays visible as gone in the expanded row (review prov-r2-002)
    expect(out[0]?.otherOffers[0]).toMatchObject({ seller: 'Gone', notSeenInLatest: { ageHours: 30 } });
  });

  it('unchecked rows never group, even with an itinerary hash; they pass through untouched (ruling arch-r2-001)', () => {
    const u1 = row({ itineraryHash: 'h1', verdictClass: 'unchecked', seller: 'U1' });
    const u2 = row({ itineraryHash: 'h1', verdictClass: 'unchecked', seller: 'U2' });
    const out = dedupByItinerary([u1, u2], NOW);
    expect(out).toEqual([u1, u2]);
  });

  it('at equal class and price, the fresher offer wins and known age beats unknown (compareAges)', () => {
    const fresh = row({ seller: 'Z-fresh', provenance: { fetchedAt: '2027-03-01T11:00:00.000Z' } });
    const old = row({ seller: 'A-old', provenance: { fetchedAt: '2027-02-20T12:00:00.000Z' } });
    expect(dedupByItinerary([old, fresh], NOW)[0]?.seller).toBe('Z-fresh');
    const unknown = row({
      seller: 'A-unknown',
      provenance: { fetchedAt: '2027-03-01T11:30:00.000Z', maxAgeHours: 'unknown' },
    });
    expect(dedupByItinerary([unknown, old], NOW)[0]?.seller).toBe('A-old');
  });

  it('a stale offer is not demoted: stale rows are labelled, not hidden (spec §8.1; pft-001 declined)', () => {
    const out = dedupByItinerary(
      [
        row({ seller: 'Fresh', pricePence: 45_000 }),
        row({ seller: 'Stale', pricePence: 41_000, stale: true, ageHours: 300 }),
      ],
      NOW,
    );
    expect(out[0]?.seller).toBe('Stale');
    expect(out[0]?.stale).toBe(true);
  });

  it('an itinerary whose every offer failed keeps its best failed offer', () => {
    const out = dedupByItinerary(
      [
        row({ seller: 'A', pricePence: 60_000, verdictClass: 'failed' }),
        row({ seller: 'B', pricePence: 55_000, verdictClass: 'failed' }),
      ],
      NOW,
    );
    expect(out[0]).toMatchObject({ seller: 'B', verdictClass: 'failed' });
  });

  it('equal everything picks by seller code-unit order; calendar rows pass through; first-appearance order is kept', () => {
    const cal = calendarRow();
    const out = dedupByItinerary(
      [
        row({ itineraryHash: 'h2', seller: 'Z' }),
        cal,
        row({ itineraryHash: 'h2', seller: 'M' }),
        row({ itineraryHash: 'h1' }),
      ],
      NOW,
    );
    expect(out.map((r) => r.itineraryHash)).toEqual(['h2', null, 'h1']);
    expect(out[0]?.seller).toBe('M');
    expect(out[1]).toBe(cal);
    // code units, not locale: 'Z' (0x5A) sorts before 'a' (0x61)
    expect(dedupByItinerary([row({ seller: 'a' }), row({ seller: 'Z' })], NOW)[0]?.seller).toBe('Z');
  });

  it('an itinerary row without a seller sorts as an empty name and lists as ""', () => {
    for (const rows of [
      [row({ seller: null, pricePence: 1 }), row({ seller: 'A', pricePence: 1 })],
      [row({ seller: 'A', pricePence: 1 }), row({ seller: null, pricePence: 1 })],
    ]) {
      const out = dedupByItinerary(rows, NOW);
      expect(out[0]?.seller).toBeNull();
      expect(sellers(out[0]?.otherOffers ?? [])).toEqual(['A']);
    }
    expect(
      dedupByItinerary([row({ seller: 'A', pricePence: 1 }), row({ seller: null, pricePence: 2 })], NOW)[0]
        ?.otherOffers[0]?.seller,
    ).toBe('');
  });
  it('within a class a confirmed offer heads its itinerary over a cheaper unconfirmed one; class still comes first (decision 45, review prov I2)', () => {
    const unconfirmed = { priceConfirmed: 'unverified' as const, cabin: 'pass' as const };
    const same = dedupByItinerary(
      [
        row({ seller: 'U', pricePence: 38_000, verdictClass: 'partially-verified', verdicts: unconfirmed }),
        row({
          seller: 'C',
          pricePence: 40_000,
          verdictClass: 'partially-verified',
          unverified: ['checkedBagRequired'],
        }),
      ],
      NOW,
    );
    expect(same[0]).toMatchObject({ seller: 'C', pricePence: 40_000 });
    expect(same[0]?.otherOffers.map((o) => o.seller)).toEqual(['U']);
    const failedConfirmed = dedupByItinerary(
      [
        row({ seller: 'U', pricePence: 38_000, verdictClass: 'partially-verified', verdicts: unconfirmed }),
        row({ seller: 'F', pricePence: 40_000, verdictClass: 'failed' }),
      ],
      NOW,
    );
    // why: class first: a confirmed failed offer never outranks an unconfirmed partially-verified one.
    expect(failedConfirmed[0]).toMatchObject({ seller: 'U' });
    const allUnconfirmed = dedupByItinerary(
      [
        row({ seller: 'U2', pricePence: 39_000, verdictClass: 'partially-verified', verdicts: unconfirmed }),
        row({ seller: 'U1', pricePence: 38_000, verdictClass: 'partially-verified', verdicts: unconfirmed }),
      ],
      NOW,
    );
    expect(allUnconfirmed[0]).toMatchObject({ seller: 'U1' });
  });
});

describe('rankRows (spec §6.5, §8.1; ruling 3)', () => {
  it('within a class, an offer whose price was not confirmed ranks after every confirmed one (decision 45)', () => {
    const ranked = rankRows(
      [
        row({
          itineraryHash: 'u',
          seller: 'U',
          pricePence: 38_000,
          verdictClass: 'partially-verified',
          verdicts: { priceConfirmed: 'unverified' },
        }),
        row({ itineraryHash: 'c', seller: 'C', pricePence: 40_000, verdictClass: 'partially-verified' }),
        row({ itineraryHash: 'f', seller: 'F', pricePence: 30_000, verdictClass: 'failed' }),
      ],
      NOW,
    );
    expect(sellers(ranked)).toEqual(['C', 'U', 'F']);
    expect(ranked.map(priceUnconfirmed)).toEqual([false, true, false]);
  });

  it('orders verified, partially-verified, failed, then by price', () => {
    const ranked = rankRows(
      [
        row({ itineraryHash: 'f', verdictClass: 'failed', pricePence: 30_000 }),
        row({ itineraryHash: 'p', verdictClass: 'partially-verified', pricePence: 35_000 }),
        row({ itineraryHash: 'v2', pricePence: 45_000 }),
        row({ itineraryHash: 'v1', pricePence: 40_000 }),
      ],
      NOW,
    );
    expect(ranked.map((r) => r.itineraryHash)).toEqual(['v1', 'v2', 'p', 'f']);
  });

  it('within a class, rows not seen in the latest search rank after seen rows', () => {
    const ranked = rankRows(
      [
        row({ itineraryHash: 'gone', pricePence: 30_000, notSeenInLatest: { ageHours: 5 } }),
        row({ itineraryHash: 'seen', pricePence: 45_000 }),
      ],
      NOW,
    );
    expect(ranked.map((r) => r.itineraryHash)).toEqual(['seen', 'gone']);
  });

  it('stale rows keep their price position (spec §8.1: labelled, never hidden or demoted)', () => {
    const ranked = rankRows(
      [
        row({ itineraryHash: 'fresh', pricePence: 41_200 }),
        row({ itineraryHash: 'stale', pricePence: 30_000, stale: true }),
      ],
      NOW,
    );
    expect(ranked.map((r) => r.itineraryHash)).toEqual(['stale', 'fresh']);
  });

  it('calendar rows (unchecked) rank by price after any checked class', () => {
    const ranked = rankRows(
      [calendarRow({ pricePence: 10_000 }), row({ verdictClass: 'failed', pricePence: 90_000 })],
      NOW,
    );
    expect(ranked.map((r) => r.verdictClass)).toEqual(['failed', 'unchecked']);
  });

  it('equal class and price: fresher first; unknown age loses; then seller; then identity', () => {
    const old = row({ itineraryHash: 'old', provenance: { fetchedAt: '2027-02-20T12:00:00.000Z' } });
    const fresh = row({ itineraryHash: 'fresh', provenance: { fetchedAt: '2027-03-01T11:00:00.000Z' } });
    const unknown = row({
      itineraryHash: 'unknown',
      provenance: { fetchedAt: '2027-03-01T11:30:00.000Z', maxAgeHours: 'unknown' },
    });
    expect(rankRows([unknown, old, fresh], NOW).map((r) => r.itineraryHash)).toEqual([
      'fresh',
      'old',
      'unknown',
    ]);
    expect(
      rankRows([row({ itineraryHash: 'a', seller: 'Z' }), row({ itineraryHash: 'b', seller: 'M' })], NOW).map(
        (r) => r.itineraryHash,
      ),
    ).toEqual(['b', 'a']);
    expect(
      rankRows([row({ itineraryHash: 'b' }), row({ itineraryHash: 'a' })], NOW).map((r) => r.itineraryHash),
    ).toEqual(['a', 'b']);
    const calA = calendarRow({ cell: { departureDate: '2027-03-15' } });
    const calB = calendarRow({ cell: { departureDate: '2027-03-14' } });
    expect(rankRows([calA, calB], NOW)).toEqual([calB, calA]);
  });

  it('review focus 2: a future fetchedAt or providerObservedAt sorts as "just now" and never throws', () => {
    const future = row({
      itineraryHash: 'future',
      provenance: { fetchedAt: '2027-03-01T15:00:00.000Z', providerObservedAt: '2027-03-01T16:00:00.000Z' },
    });
    const recent = row({ itineraryHash: 'recent', provenance: { fetchedAt: '2027-03-01T09:00:00.000Z' } });
    let ranked: ReturnType<typeof rankRows> = [];
    expect(() => {
      ranked = rankRows([recent, future], NOW);
    }).not.toThrow();
    expect(ranked.map((r) => r.itineraryHash)).toEqual(['future', 'recent']);
    const age = effectiveAge(future.provenance, NOW);
    expect(age).toEqual({ kind: 'observed', fetchedHours: 0, observedHours: 0 });
    expect(formatAgeCompact(age)).toBe('just now · obs just now');
  });
});

describe('sortRows (spec §6.5 sort keys)', () => {
  const a = row({
    itineraryHash: 'a',
    pricePence: 40_000,
    totalMinutes: 900,
    stopsOut: 1,
    stopsIn: 1,
    adjustedPence: 45_000,
    cell: { departureDate: '2027-03-15', returnDate: '2027-03-25', nights: 10 },
  });
  const b = row({
    itineraryHash: 'b',
    pricePence: 38_000,
    totalMinutes: 840,
    stopsOut: 0,
    stopsIn: 0,
    adjustedPence: 47_000,
    cell: { departureDate: '2027-03-14', returnDate: '2027-03-28', nights: 14 },
  });
  const cal = calendarRow({
    pricePence: 39_000,
    cell: { departureDate: '2027-03-18', returnDate: '2027-03-27', nights: 9 }, // return and nights order differ
  });

  it.each<[SortKey, string[], string[]]>([
    ['price', ['b', 'cal', 'a'], ['a', 'cal', 'b']],
    ['totalTime', ['b', 'a', 'cal'], ['a', 'b', 'cal']],
    ['departure', ['b', 'a', 'cal'], ['cal', 'a', 'b']],
    ['return', ['a', 'cal', 'b'], ['b', 'cal', 'a']],
    ['nights', ['cal', 'a', 'b'], ['b', 'a', 'cal']],
    ['stops', ['b', 'a', 'cal'], ['a', 'b', 'cal']],
    ['adjusted', ['a', 'b', 'cal'], ['b', 'a', 'cal']],
  ])('%s asc %j, desc %j; missing keys last both ways', (key, asc, desc) => {
    const name = (r: { itineraryHash: string | null }) => r.itineraryHash ?? 'cal';
    expect(sortRows([a, b, cal], key, 'asc').map(name)).toEqual(asc);
    expect(sortRows([a, b, cal], key, 'desc').map(name)).toEqual(desc);
  });

  it('is stable: equal keys keep the ranked order; missing keys sort last on either side', () => {
    const x = row({ itineraryHash: 'x' });
    const y = row({ itineraryHash: 'y' });
    expect(sortRows([y, x], 'price', 'asc').map((r) => r.itineraryHash)).toEqual(['y', 'x']);
    const c1 = calendarRow({ pricePence: 1 });
    const c2 = calendarRow({ pricePence: 2 });
    expect(sortRows([c2, c1], 'totalTime', 'desc')).toEqual([c2, c1]);
    expect(sortRows([c1, x], 'totalTime', 'asc')).toEqual([x, c1]);
    expect(sortRows([x, c1], 'totalTime', 'desc')).toEqual([x, c1]);
  });
});

describe('priceUnconfirmed: the one definition web and core share (ca-003)', () => {
  it('reads the verdict when there is one, else the unverified list (a calendar-panel offer carries no verdicts)', () => {
    expect(priceUnconfirmed({ verdicts: { priceConfirmed: 'unverified' }, unverified: [] })).toBe(true);
    expect(priceUnconfirmed({ verdicts: { priceConfirmed: 'pass' }, unverified: [] })).toBe(false);
    expect(priceUnconfirmed({ unverified: ['priceConfirmed'] })).toBe(true);
    expect(priceUnconfirmed({ unverified: ['checkedBagRequired'] })).toBe(false);
    expect(priceUnconfirmed({ verdicts: {} })).toBe(false);
  });
  it('is on the barrel', () => {
    expect(barrel.priceUnconfirmed).toBe(priceUnconfirmed);
  });
});
