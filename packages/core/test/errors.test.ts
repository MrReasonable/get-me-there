import { describe, expect, it } from 'vitest';
import {
  AbortedError,
  BudgetExceeded,
  cooldownNoticeKey,
  NormalisationError,
  ProviderError,
  stripUrlsInText,
} from '../src/errors.js';
import { asIsoDateTime } from '../src/types/ids.js';

describe('ProviderError', () => {
  it('carries kind, retryable and status', () => {
    const e = new ProviderError({
      kind: 'rate-limit',
      retryable: true,
      httpStatus: 429,
      retryAfterSeconds: 30,
      message: 'slow down',
    });
    expect(e.kind).toBe('rate-limit');
    expect(e.retryable).toBe(true);
    expect(e.httpStatus).toBe(429);
    expect(e.retryAfterSeconds).toBe(30);
    expect(e.name).toBe('ProviderError');
    expect(e).toBeInstanceOf(Error);
  });
  it('never keeps a URL query or userinfo in its message (spec §5.3)', () => {
    const e = new ProviderError({
      kind: 'upstream',
      retryable: false,
      message: 'GET https://user:pw@api.example.com/v1/x?api_key=SECRET failed',
    });
    expect(e.message).toBe('GET https://api.example.com/v1/x failed');
    expect(e.message).not.toContain('SECRET');
    expect(e.message).not.toContain('pw@');
  });
  it.each([
    ['GET /api/v1/search?engine=google_flights&api_key=SECRET failed', 'GET /api/v1/search failed'],
    ['at api.example.com/v1/x?token=SECRET (503)', 'at api.example.com/v1/x (503)'],
    ['host api.example.com?api_key=SECRET', 'host api.example.com'],
    ["'/aviasales/v3/prices_for_dates#token=SECRET'", "'/aviasales/v3/prices_for_dates'"],
    ['see https://h.example/x?a=1 and /y?b=2', 'see https://h.example/x and /y'],
  ])(
    'stripUrlsInText strips the query and fragment of a relative or schemeless URL too (prov-M7): %s',
    (input, out) => {
      expect(stripUrlsInText(input)).toBe(out);
      expect(stripUrlsInText(input)).not.toContain('SECRET');
    },
  );
  it('stripUrlsInText leaves prose questions alone', () => {
    expect(stripUrlsInText('why? no fares for 2027-03-14 (cabin?)')).toBe(
      'why? no fares for 2027-03-14 (cabin?)',
    );
  });
  it('stripUrlsInText replaces an unparseable URL-like token', () => {
    expect(stripUrlsInText('see http://[bad')).toBe('see <url>');
  });
});

describe('BudgetExceeded', () => {
  it('names scope and numbers', () => {
    const e = new BudgetExceeded({
      scope: 'global-month',
      cap: 35_000_000,
      current: 34_000_000,
      requested: 3_200_000,
    });
    expect(e.scope).toBe('global-month');
    expect(e.message).toContain('global-month');
    expect(e.message).toContain('35000000');
    expect(e.providerId).toBeUndefined();
    expect(
      new BudgetExceeded({
        scope: 'provider-month',
        cap: 1,
        current: 1,
        requested: 1,
        providerId: 'searchapi',
      }).message,
    ).toContain('searchapi');
  });
});

describe('stripUrlsInText scheme case', () => {
  it('strips the query of an upper- or mixed-case scheme', () => {
    expect(stripUrlsInText('GET HTTPS://api.example.com/x?api_key=SECRET')).toBe(
      'GET https://api.example.com/x',
    );
    expect(stripUrlsInText('HTTPS://u:p@api.example.com/x?api_key=SECRET')).toBe('https://api.example.com/x');
    expect(stripUrlsInText('Http://localhost:8080/x?api_key=SECRET')).toBe('http://localhost:8080/x');
  });
});

describe('NormalisationError / AbortedError', () => {
  it('construct', () => {
    const n = new NormalisationError('fx-unavailable', 'CNY 2026-10-14 https://x/?k=1');
    expect(n.reason).toBe('fx-unavailable');
    expect(n.message).toBe('fx-unavailable: CNY 2026-10-14 https://x/');
    expect(n.detail).toBe('CNY 2026-10-14 https://x/');
    expect(new NormalisationError('unknown-airport-tz').detail).toBeUndefined();
    expect(new NormalisationError('unknown-airport-tz').message).toBe('unknown-airport-tz');
    expect(new AbortedError().name).toBe('AbortedError');
    expect(new AbortedError('cancelled').message).toBe('cancelled');
  });
});

// why: fix round 1 (arch I1): a block's cool-down end travels as data, never parsed from the message
describe('ProviderError.cooldownUntil', () => {
  it('carries the end it was given, and is undefined otherwise', () => {
    const e = new ProviderError({
      kind: 'blocked',
      retryable: false,
      message: 'm',
      cooldownUntil: asIsoDateTime('2027-02-12T09:00:00.000Z'),
    });
    expect(e.cooldownUntil).toBe('2027-02-12T09:00:00.000Z');
    expect(
      new ProviderError({ kind: 'blocked', retryable: false, message: 'm' }).cooldownUntil,
    ).toBeUndefined();
  });
  it('cooldownNoticeKey is the one spelling of the once-per-cool-down key', () => {
    expect(cooldownNoticeKey('camoufox', asIsoDateTime('2027-02-12T09:00:00.000Z'))).toBe(
      'camoufox-cooldown:2027-02-12T09:00:00.000Z',
    );
  });
});
