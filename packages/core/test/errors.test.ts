import { describe, expect, it } from 'vitest';
import { AbortedError, BudgetExceeded, NormalisationError, ProviderError, stripUrlsInText } from '../src/errors.js';

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
  it('stripUrlsInText replaces an unparseable URL-like token', () => {
    expect(stripUrlsInText('see http://[bad')).toBe('see <url>');
  });
});

describe('BudgetExceeded', () => {
  it('names scope and numbers', () => {
    const e = new BudgetExceeded({ scope: 'global-month', cap: 35_000_000, current: 34_000_000, requested: 3_200_000 });
    expect(e.scope).toBe('global-month');
    expect(e.message).toContain('global-month');
    expect(e.message).toContain('35000000');
    expect(e.providerId).toBeUndefined();
    expect(new BudgetExceeded({ scope: 'provider-month', cap: 1, current: 1, requested: 1, providerId: 'searchapi' }).message).toContain(
      'searchapi',
    );
  });
});

describe('NormalisationError / AbortedError', () => {
  it('construct', () => {
    const n = new NormalisationError('fx-unavailable', 'CNY 2026-10-14 https://x/?k=1');
    expect(n.reason).toBe('fx-unavailable');
    expect(n.message).toBe('fx-unavailable: CNY 2026-10-14 https://x/');
    expect(new NormalisationError('unknown-airport-tz').message).toBe('unknown-airport-tz');
    expect(new AbortedError().name).toBe('AbortedError');
    expect(new AbortedError('cancelled').message).toBe('cancelled');
  });
});
