import { describe, expect, it } from 'vitest';
import { pointOfSaleSchema, provenanceSchema } from '../../src/types/provenance.js';

const good = {
  providerId: 'searchapi',
  sourceKind: 'scraped-aggregate',
  fetchedAt: '2026-10-14T15:00:00.000Z',
  maxAgeHours: 24,
  fx: { converted: false },
  pointOfSale: 'GB',
  cabin: 'economy',
};

describe('provenanceSchema (spec §3)', () => {
  it('accepts a complete provenance', () => expect(provenanceSchema.safeParse(good).success).toBe(true));
  it("accepts maxAgeHours 'unknown' and an observed time", () => {
    expect(provenanceSchema.safeParse({ ...good, maxAgeHours: 'unknown' }).success).toBe(true);
    expect(provenanceSchema.safeParse({ ...good, providerObservedAt: '2026-10-14T12:00:00.000Z' }).success).toBe(true);
  });
  it('rejects a missing fetchedAt (nothing is defaulted)', () => {
    const { fetchedAt: _omit, ...rest } = good;
    expect(provenanceSchema.safeParse(rest).success).toBe(false);
  });
  it('rejects unknown keys', () => {
    expect(provenanceSchema.safeParse({ ...good, extra: 1 }).success).toBe(false);
  });
  it('requires rate, date and source when converted', () => {
    expect(provenanceSchema.safeParse({ ...good, fx: { converted: true, rateNano: 110_000_000, rateDate: '2026-10-14' } }).success).toBe(false);
    expect(
      provenanceSchema.safeParse({ ...good, fx: { converted: true, rateNano: 110_000_000, rateDate: '2026-10-14', source: 'frankfurter' } })
        .success,
    ).toBe(true);
  });
  it('rejects a non-integer rateNano', () => {
    expect(provenanceSchema.safeParse({ ...good, fx: { converted: true, rateNano: 1.5, rateDate: '2026-10-14', source: 'x' } }).success).toBe(
      false,
    );
  });
  it('point of sale is an ISO alpha-2 code or unknown', () => {
    expect(pointOfSaleSchema.safeParse('GB').success).toBe(true);
    expect(pointOfSaleSchema.safeParse('unknown').success).toBe(true);
    expect(pointOfSaleSchema.safeParse('gb').success).toBe(false);
    expect(pointOfSaleSchema.safeParse('GBR').success).toBe(false);
  });
});
