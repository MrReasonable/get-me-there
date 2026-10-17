import { describe, expect, it } from 'vitest';
import { alertEventPayloadSchema, alertEventSchema } from '../../src/api-contract/alerts.js';

// Decision 56: one payload schema the engine writes and the web reads.
const provenance = {
  providerId: 'searchapi',
  sourceKind: 'scraped-search',
  fetchedAt: '2026-10-14T10:00:00.000Z',
  maxAgeHours: 'unknown',
  fx: { converted: false },
  pointOfSale: 'GB',
  cabin: 'economy',
};
const payload = {
  digestId: 'd1',
  executionId: 'ex-1',
  pricePence: 41_200,
  provenance,
  previous: { pricePence: 50_000, provenance: { ...provenance, fetchedAt: '2026-10-07T10:00:00.000Z' } },
  isNew: false,
  route: 'LHR→JFK 14 Mar–28 Mar (14n)',
  verdictClass: 'partially-verified',
  unverified: ['checkedBagRequired'],
  reason: { kind: 'drop', gapHours: 168 },
  staleThresholdHours: 192,
  truncated: false,
  notSeenInLatest: { at: '2026-10-14T12:00:00.000Z' },
};

describe('alertEventPayloadSchema (decision 56)', () => {
  it('accepts the runner payload and refuses a non-integer price, an unknown class or a provenance without its source', () => {
    expect(alertEventPayloadSchema.parse(payload)).toEqual(payload);
    expect(alertEventPayloadSchema.safeParse({ ...payload, pricePence: 412.5 }).success).toBe(false);
    // the results row's vocabulary less 'failed', derived from verdictClassSchema (decision 59)
    for (const verdictClass of ['verified', 'partially-verified', 'unchecked'])
      expect(alertEventPayloadSchema.safeParse({ ...payload, verdictClass }).success).toBe(true);
    expect(alertEventPayloadSchema.safeParse({ ...payload, verdictClass: 'failed' }).success).toBe(false);
    const { sourceKind: _dropped, ...noSource } = provenance;
    expect(alertEventPayloadSchema.safeParse({ ...payload, provenance: noSource }).success).toBe(false);
    expect(
      alertEventPayloadSchema.safeParse({ ...payload, notSeenInLatest: { at: null }, previous: null })
        .success,
    ).toBe(true);
  });
  it('event statuses are queued, notified and suppressed', () => {
    const event = {
      id: 1,
      ruleId: 'r',
      identityKey: 'k',
      observationId: null,
      calendarPriceId: 1,
      dedupKey: 'd',
      firedAt: '2026-10-14T10:00:00.000Z',
      reason: null,
      payload,
    };
    for (const status of ['queued', 'notified', 'suppressed'])
      expect(alertEventSchema.safeParse({ ...event, status }).success).toBe(true);
    for (const status of ['sent', 'failed'])
      expect(alertEventSchema.safeParse({ ...event, status }).success).toBe(false);
  });
});
