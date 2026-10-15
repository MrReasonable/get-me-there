import { PLAN_PRESETS } from '@gmt/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HttpKitRequest } from '../../src/http/types.js';
import { classifySearchApiError, searchApiHttpLimits } from '../../src/searchapi/errors.js';
import { authHeaders, SEARCHAPI_ENDPOINT_PATH } from '../../src/searchapi/params.js';
import { asProviderError } from '../support/guards.js';
import { server } from '../support/msw.js';
import { drive, driveError, useFakeTime } from '../support/time.js';
import { assertEverySentAllowed, KEY, saKit } from './support/kit.js';
import { ok, type Reply, syntheticHandler } from './support/synthetic.js';

// why: a calendar-shaped URL with allowlisted names; the classifier and http-kit see only status, body and headers.
const URL_ =
  'https://www.searchapi.io/api/v1/search?engine=google_flights_calendar&departure_id=LHR&arrival_id=JFK&flight_type=round_trip&outbound_date=2026-11-02&outbound_date_start=2026-11-02&outbound_date_end=2026-11-03&return_date=2026-11-12&return_date_start=2026-11-12&return_date_end=2026-11-14&travel_class=economy&adults=1&currency=GBP&gl=gb&hl=en';
const facts = (status: number, body: unknown) => ({
  status,
  body,
  headers: new Headers(),
  providerId: 'searchapi' as const,
  endpointPath: SEARCHAPI_ENDPOINT_PATH,
});
const request = (): HttpKitRequest => ({
  providerId: 'searchapi',
  executionId: 'exec-test',
  tileIndex: 0,
  endpointPath: SEARCHAPI_ENDPOINT_PATH,
  method: 'GET',
  url: new URL(URL_),
  headers: authHeaders(KEY),
  cache: 'never',
  signal: new AbortController().signal,
  recordFixtures: false,
});
/** The spike's recorded 401 body (spec §2 fact 5), reproduced as a synthetic labelled body. */
const INVALID_KEY_BODY = { error: 'Invalid API key.' };

beforeEach(() => useFakeTime());
afterEach(() => {
  vi.useRealTimers();
  assertEverySentAllowed();
});

/** Serves `replies` in order (the last repeats) and returns the kit with its ledger. */
function serve(...replies: Reply[]) {
  let n = 0;
  server.use(syntheticHandler(() => replies[Math.min(n++, replies.length - 1)] ?? ok({})));
  return saKit();
}

describe('classifySearchApiError (spec §5.2, §2 fact 5)', () => {
  it('recognises the recorded 401 body → auth, non-retryable, vendor text in the message, no reason (synthetic)', () => {
    const e = classifySearchApiError(facts(401, INVALID_KEY_BODY));
    expect(e).toMatchObject({ kind: 'auth', retryable: false, httpStatus: 401, providerId: 'searchapi' });
    expect(e?.reason).toBeUndefined();
    expect(e?.message).toContain('Invalid API key.');
  });

  it.each([
    ['a 401 with another body', 401, { error: 'something else' }],
    ['a 401 with a text body', 401, 'Unauthorized'],
    ['a 429 with no body', 429, null],
    ['a 429 with a quota-like body (no quota body is recorded)', 429, { error: 'Monthly quota exceeded' }],
    ['a 400', 400, { error: 'Unsupported value' }],
    ['a 500', 500, { error: 'boom' }],
  ] as const)('falls through to the default table for %s (synthetic)', (_label, status, body) => {
    expect(classifySearchApiError(facts(status, body))).toBeUndefined();
  });
});

describe('searchApiHttpLimits (spec §5.3, §5.2)', () => {
  it('maps plan limits, the one host, http-200, the configured cost and the classifier; no 429 fallback wait', () => {
    const l = searchApiHttpLimits(
      { ...PLAN_PRESETS['40usd'], costPerCallMicroGbp: 1234 },
      { maxWaitSeconds: 3900, requestTimeoutSeconds: 60 },
    );
    expect(l).toMatchObject({
      hosts: ['www.searchapi.io'],
      ratePerMinute: 10,
      ratePerHour: 2000,
      concurrency: 2,
      billable: 'http-200',
      costPerCallMicroGbp: 1234,
      maxWaitSeconds: 3900,
      requestTimeoutSeconds: 60,
    });
    expect(l.classifyError).toBe(classifySearchApiError);
    expect('rateLimitFallbackWaitSeconds' in l).toBe(false);
    expect(
      searchApiHttpLimits(PLAN_PRESETS.trial, { maxWaitSeconds: 1, requestTimeoutSeconds: 1 }),
    ).toMatchObject({ ratePerMinute: 2, ratePerHour: 20, concurrency: 1 });
  });
});

// why: plan decision 20: the vendor's 429 shape and headers are undocumented and unrecorded, so these bodies are
// synthetic and labelled, and the Retry-After rows record http-kit's behaviour, not the vendor's.
describe('error table through the real http-kit with SearchApi limits (spec §5.2, §9 item 2), synthetic', () => {
  it.each([
    ['the recorded 401 body', { status: 401, body: INVALID_KEY_BODY }, 'auth', /Invalid API key\./],
    ['a 401 with another body', { status: 401, body: { error: 'x' } }, 'auth', /HTTP 401/],
    ['a 403', { status: 403, body: { error: 'Forbidden' } }, 'auth', /HTTP 403/],
    ['a 402', { status: 402, body: { error: 'Payment required' } }, 'quota', /HTTP 402/],
    [
      'a 400 with a vendor message',
      { status: 400, body: { error: 'Unsupported value of travel_class' } },
      'parse',
      /Unsupported value of travel_class/,
    ],
    ['a 404', { status: 404, body: { error: 'Not found' } }, 'upstream', /HTTP 404/],
    ['an HTML 200', { status: 200, body: '<html>maintenance</html>' }, 'parse', /malformed-json/],
  ] as const)(
    '%s → %s, non-retryable, one attempt, no reason (synthetic)',
    async (_label, reply, kind, message) => {
      const k = serve(reply);
      const err = asProviderError(await driveError(k.kit.request(request())));
      expect(err).toMatchObject({ kind, retryable: false, providerId: 'searchapi' });
      expect(err.reason).toBeUndefined();
      expect(err.message).toMatch(message);
      expect(k.budget.count('reserve')).toBe(1);
    },
  );

  it('a header-less 429 → non-retryable rate-limit with the hourly retry time, one attempt (synthetic)', async () => {
    const k = serve({ status: 429, body: { error: 'Too many requests' } });
    const err = asProviderError(await driveError(k.kit.request(request())));
    expect(err).toMatchObject({ kind: 'rate-limit', retryable: false, httpStatus: 429 });
    expect(err.retryAfterSeconds).toBeGreaterThan(0);
    expect(err.retryAfterSeconds).toBeLessThanOrEqual(3600);
    expect(err.message).toMatch(/no-retry-after/);
    expect(k.budget.count('reserve')).toBe(1);
  });

  it('a 429 with ratelimit headers but no Retry-After is treated as header-less (vendor headers unverified) (synthetic)', async () => {
    const k = serve({
      status: 429,
      body: null,
      headers: { 'x-ratelimit-remaining': '0', 'ratelimit-reset': '120' },
    });
    const err = asProviderError(await driveError(k.kit.request(request())));
    expect(err).toMatchObject({ kind: 'rate-limit', retryable: false });
    expect(k.budget.count('reserve')).toBe(1);
  });

  it('a 429 with a quota-like body stays rate-limit: no quota body is recorded (synthetic)', async () => {
    const k = serve({ status: 429, body: { error: 'Monthly quota exceeded' } });
    expect(asProviderError(await driveError(k.kit.request(request()))).kind).toBe('rate-limit');
  });

  it('a 429 with Retry-After: 30 waits and retries; the retry succeeds (synthetic)', async () => {
    const k = serve({ status: 429, body: null, headers: { 'retry-after': '30' } }, ok({ calendar: [] }));
    const res = await drive(k.kit.request(request()));
    expect(res.status).toBe(200);
    expect(k.budget.events.filter((e) => e.type === 'reserve').map((e) => e.httpAttempt)).toEqual([1, 2]);
  });

  it('a 429 asking to wait beyond MAX_WAIT_SECONDS → limiter-timeout, no retry (synthetic)', async () => {
    const k = serve({ status: 429, body: null, headers: { 'retry-after': '99999' } });
    const err = asProviderError(await driveError(k.kit.request(request())));
    expect(err).toMatchObject({ kind: 'limiter-timeout', retryable: false, retryAfterSeconds: 99999 });
    expect(k.budget.count('reserve')).toBe(1);
  });

  it.each([500, 503])(
    'a %i → upstream, retried by http-kit to three attempts, then thrown (synthetic)',
    async (status) => {
      const k = serve({ status, body: { error: 'boom' } });
      const err = asProviderError(await driveError(k.kit.request(request())));
      expect(err).toMatchObject({ kind: 'upstream', httpStatus: status });
      expect(k.budget.count('reserve')).toBe(3);
    },
  );
});
