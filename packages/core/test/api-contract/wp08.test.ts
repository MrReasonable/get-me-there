import { describe, expect, it } from 'vitest';
import {
  alertRulesQuerySchema,
  bookingSchema,
  coverageResponseSchema,
  definitionCreateOptionalSchema,
  definitionCreateRequestSchema,
  definitionShapeSchema,
  resultRowSchema,
  storedBookingSchema,
  vendorLinkSchema,
  verifyCellRequestSchema,
} from '../../src/api-contract/index.js';
import { budgetScopeLabel } from '../../src/ports/budget.js';

// WP8's contract additions (plan decision 53: drafts; spec §10 `POST /definitions` with no body).
describe('WP8 contract additions', () => {
  it('a stored definition may be a draft without airports; a create body may not', () => {
    const origins = definitionShapeSchema.shape.origins;
    expect(origins.safeParse([]).success).toBe(true);
    expect(definitionShapeSchema.shape.destinations.safeParse([]).success).toBe(true);
    const create = definitionCreateRequestSchema.safeParse({ origins: [] });
    expect(create.error?.issues.some((i) => i.path[0] === 'origins' && i.code === 'too_small')).toBe(true);
  });
});

// WP8 round-2 additions (plan decisions 53, 54).
describe('WP8 contract additions, round 2', () => {
  it.each([
    ['https://www.aviasales.com/search/LHR0211JFK1', true],
    ['https://google.com/travel/flights', true],
    ['http://www.aviasales.com/x', false],
    ['javascript:alert(1)', false],
    ['https://evil.example/aviasales.com', false],
    ['https://user@aviasales.com/', false],
    ['https://aviasales.com.evil.example/', false],
    ['https://aviasales.com:8443/', false],
  ])('vendorLinkSchema: %s → %s', (url, ok) => {
    expect(vendorLinkSchema.safeParse(url).success).toBe(ok);
    expect(bookingSchema.safeParse({ kind: 'get', url, host: 'h' }).success).toBe(ok);
    expect(bookingSchema.safeParse({ kind: 'post', url, postData: '', host: 'h' }).success).toBe(ok);
  });

  it('storedBookingSchema reads any stored URL, so the api can drop it rather than fail the page', () => {
    expect(
      storedBookingSchema.safeParse({ kind: 'get', url: 'javascript:alert(1)', host: 'x' }).success,
    ).toBe(true);
    expect(
      storedBookingSchema.safeParse({ kind: 'post', url: 'https://a.b/', postData: '', host: 'x' }).success,
    ).toBe(true);
    expect(storedBookingSchema.safeParse({ kind: 'none' }).success).toBe(true);
    expect(storedBookingSchema.safeParse({ kind: 'get', url: 'not a url', host: 'x' }).success).toBe(false);
  });

  it('budgetScopeLabel names provider scopes with their provider and the global scopes alone', () => {
    expect(budgetScopeLabel({ kind: 'provider-month', providerId: 'searchapi' })).toBe(
      'provider-month:searchapi',
    );
    expect(budgetScopeLabel({ kind: 'global-month' })).toBe('global-month');
  });

  it('a result row carries the superseded mark beside the not-seen mark (decision 54)', () => {
    const mark = resultRowSchema.shape.notSeenInLatest;
    expect(mark.safeParse(null).success).toBe(true);
    expect(mark.safeParse({ ageHours: 'unknown' }).success).toBe(true);
    expect(resultRowSchema.shape.superseded.safeParse(true).success).toBe(true);
    expect(resultRowSchema.shape.superseded.safeParse(null).success).toBe(false);
  });

  it('alert rules take an optional definitionId; a create body is optional', () => {
    expect(alertRulesQuerySchema.parse({ definitionId: 'd1' })).toEqual({ definitionId: 'd1' });
    expect(definitionCreateOptionalSchema.safeParse(undefined).success).toBe(true);
    expect(definitionCreateOptionalSchema.safeParse({ origins: [] }).success).toBe(false);
  });

  it('a coverage error row may carry a null reason (review prov M3)', () => {
    const errors = coverageResponseSchema.shape.errors;
    const base = {
      cell: {
        origin: 'LHR',
        destination: 'JFK',
        departureDate: '2026-11-02',
        returnDate: '2026-11-12',
        nights: 10,
      },
      stage: 'discovery',
      providerId: 'searchapi',
      lastError: null,
      attempts: 1,
      retryable: true,
    };
    expect(errors.safeParse([{ ...base, reason: null }]).success).toBe(true);
    expect(errors.safeParse([{ ...base, reason: 'upstream' }]).success).toBe(true);
  });

  it('a verify request may carry a confirmation', () => {
    const base = {
      definitionId: 'd1',
      cell: { origin: 'LHR', destination: 'JFK', departureDate: '2026-11-02', returnDate: '2026-11-12' },
    };
    expect(verifyCellRequestSchema.parse({ ...base, confirmCostPence: 7, confirmCalls: 6 })).toMatchObject({
      confirmCostPence: 7,
      confirmCalls: 6,
    });
    expect(verifyCellRequestSchema.safeParse({ ...base, confirmCalls: -1 }).success).toBe(false);
  });
});
