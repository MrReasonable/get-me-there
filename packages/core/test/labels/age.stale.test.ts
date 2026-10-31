import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { calendarStaleThreshold, staleMarkText, stalenessOf } from '../../src/labels/age.js';
import { asIsoDateTime, type IsoDateTime, isoDateTimeOfEpochMs } from '../../src/types/ids.js';
import type { Provenance } from '../../src/types/provenance.js';

const NOW = asIsoDateTime('2027-03-14T12:00:00.000Z');
const hoursBefore = (h: number): IsoDateTime => isoDateTimeOfEpochMs(Date.parse(NOW) - h * 3_600_000);

function prov(over: Partial<Provenance> = {}): Provenance {
  return {
    providerId: 'travelpayouts',
    sourceKind: 'authorised-cached',
    fetchedAt: hoursBefore(1),
    maxAgeHours: 24,
    fx: { converted: false },
    pointOfSale: 'unknown',
    cabin: 'economy',
    ...over,
  };
}
const T = { refreshHours: 168, overrideHours: null, staleAfterHours: 192 };

describe('calendarStaleThreshold (spec rev 55 §8.1 "Staleness per price")', () => {
  it("adds the price's own stored age to the refresh, 0 when unknown, and an override wins outright", () => {
    expect(calendarStaleThreshold({ maxAgeHours: 24 }, 168, null)).toBe(192);
    expect(calendarStaleThreshold({ maxAgeHours: 'unknown' }, 168, null)).toBe(168);
    expect(calendarStaleThreshold({ maxAgeHours: 24 }, 168, 2)).toBe(2);
    expect(calendarStaleThreshold({ maxAgeHours: 'unknown' }, 168, 0)).toBe(0);
  });
});

describe('stalenessOf on the calendar basis', () => {
  it('never marks a bounded-age price stale within the refresh, and does one hour past it', () => {
    const at168 = stalenessOf(
      { provenance: prov({ fetchedAt: hoursBefore(168) }), basis: 'calendar' },
      T,
      NOW,
    );
    expect(at168).toEqual({ ageHours: 192, stale: false, markText: "older than this search's refresh" });
    const at169 = stalenessOf(
      { provenance: prov({ fetchedAt: hoursBefore(169) }), basis: 'calendar' },
      T,
      NOW,
    );
    expect(at169.stale).toBe(true);
    expect(at169.ageHours).toBe(193);
  });

  it('property: a bounded or unknown age is fresh exactly while its fetch age is within the refresh', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 400 }),
        fc.oneof(fc.integer({ min: 0, max: 72 }), fc.constant<'unknown'>('unknown')),
        fc.integer({ min: 0, max: 500 }),
        (refreshHours, maxAgeHours, fetchAge) => {
          const r = stalenessOf(
            { provenance: prov({ maxAgeHours, fetchedAt: hoursBefore(fetchAge) }), basis: 'calendar' },
            { ...T, refreshHours },
            NOW,
          );
          expect(r.stale).toBe(fetchAge > refreshHours);
        },
      ),
    );
  });

  it('keeps an unknown vendor age to its fetch age', () => {
    const p = prov({ maxAgeHours: 'unknown', fetchedAt: hoursBefore(168) });
    expect(stalenessOf({ provenance: p, basis: 'calendar' }, T, NOW)).toMatchObject({
      ageHours: 168,
      stale: false,
    });
    const q = prov({ maxAgeHours: 'unknown', fetchedAt: hoursBefore(169) });
    expect(stalenessOf({ provenance: q, basis: 'calendar' }, T, NOW).stale).toBe(true);
  });

  it('keeps a vendor-dated price at its own age, so an old price fetched an hour ago is stale', () => {
    const p = prov({ providerObservedAt: hoursBefore(20 * 24), fetchedAt: hoursBefore(1) });
    expect(stalenessOf({ provenance: p, basis: 'calendar' }, T, NOW)).toMatchObject({
      ageHours: 480,
      stale: true,
    });
  });

  it('lets the stale setting replace the threshold, and says so in the mark', () => {
    const p = prov({ fetchedAt: hoursBefore(3) });
    expect(stalenessOf({ provenance: p, basis: 'calendar' }, { ...T, overrideHours: 2 }, NOW)).toEqual({
      ageHours: 27,
      stale: true,
      markText: 'older than your stale setting',
    });
  });
});

describe('stalenessOf on the verified basis', () => {
  it('uses staleAfterHours alone, whatever the refresh or the override', () => {
    const fresh = prov({ maxAgeHours: 0, fetchedAt: hoursBefore(192) });
    const t = { refreshHours: 1, overrideHours: 1, staleAfterHours: 192 };
    expect(stalenessOf({ provenance: fresh, basis: 'verified' }, t, NOW)).toEqual({
      ageHours: 192,
      stale: false,
      markText: 'older than your stale setting',
    });
    const old = prov({ maxAgeHours: 0, fetchedAt: hoursBefore(193) });
    expect(stalenessOf({ provenance: old, basis: 'verified' }, t, NOW).stale).toBe(true);
  });
});

describe("staleMarkText (spec rev 55 §3: the stale mark's words, shown only when true)", () => {
  it('gives the three texts', () => {
    expect(staleMarkText({ basis: 'calendar', override: false })).toBe("older than this search's refresh");
    expect(staleMarkText({ basis: 'calendar', override: true })).toBe('older than your stale setting');
    expect(staleMarkText({ basis: 'verified', override: false })).toBe('older than your stale setting');
    expect(staleMarkText({ basis: 'verified', override: true })).toBe('older than your stale setting');
  });
});
