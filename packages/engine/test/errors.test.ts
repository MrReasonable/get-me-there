import { AbortedError, asIsoDateTime, BudgetExceeded, ProviderError } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { addSeconds, classifyFailure } from '../src/errors.js';

const now = asIsoDateTime('2026-10-14T09:00:00.000Z');
const pe = (kind: ProviderError['kind'], extra: { reason?: string; retryAfterSeconds?: number } = {}) =>
  new ProviderError({
    kind,
    retryable: false,
    message: `${kind} at https://u:p@fixture.local/calendar?origin=LHR`,
    ...extra,
  });
const budget = new BudgetExceeded({ scope: 'execution-calls', cap: 10, current: 10, requested: 1 });

describe('classifyFailure (spec §8.1 error table, both stages)', () => {
  it.each([
    ['AbortedError → abort', new AbortedError(), false, { kind: 'abort' }],
    ['anything after the signal aborted → abort', pe('network'), true, { kind: 'abort' }],
    ['BudgetExceeded → budget, never a cell error', budget, false, { kind: 'budget', error: budget }],
    [
      'limiter-timeout → resume at now + retryAfterSeconds (the exhausted reservoir refresh)',
      pe('limiter-timeout', { retryAfterSeconds: 4000 }),
      false,
      { kind: 'limiter-timeout', resumeAfter: '2026-10-14T10:06:40.000Z' },
    ],
    [
      'limiter-timeout without retryAfterSeconds → no reopen time, no guess',
      pe('limiter-timeout'),
      false,
      { kind: 'limiter-timeout', resumeAfter: null },
    ],
    [
      'auth → error, disables the provider',
      pe('auth'),
      false,
      { kind: 'cell-error', reason: 'auth', parse: false, disableProvider: true },
    ],
    [
      'quota → error, disables the provider',
      pe('quota'),
      false,
      { kind: 'cell-error', reason: 'quota', parse: false, disableProvider: true },
    ],
    [
      'parse keeps reason "parse"; the URL-free message goes to lastError',
      pe('parse', { reason: 'parse' }),
      false,
      {
        kind: 'cell-error',
        reason: 'parse',
        lastError: 'parse at https://fixture.local/calendar',
        parse: true,
        disableProvider: false,
      },
    ],
    [
      'upstream no-return-legs keeps its reason',
      pe('upstream', { reason: 'no-return-legs' }),
      false,
      { kind: 'cell-error', reason: 'no-return-legs', parse: false, disableProvider: false },
    ],
    [
      'upstream no-priced-options keeps its reason (spec §5.4, decision 37)',
      pe('upstream', { reason: 'no-priced-options' }),
      false,
      {
        kind: 'cell-error',
        reason: 'no-priced-options',
        lastError: 'upstream at https://fixture.local/calendar',
      },
    ],
    [
      'rate-limit → error',
      pe('rate-limit'),
      false,
      { kind: 'cell-error', reason: 'rate-limit', lastError: 'rate-limit at https://fixture.local/calendar' },
    ],
    ['network → error', pe('network'), false, { kind: 'cell-error', reason: 'network' }],
    ['upstream → error', pe('upstream'), false, { kind: 'cell-error', reason: 'upstream' }],
    [
      'an Error from a repository → fatal with a URL-free message',
      new Error('database or disk is full near https://x.example/a?b=c'),
      false,
      { kind: 'fatal', message: 'database or disk is full near https://x.example/a' },
    ],
    ['a thrown non-Error → fatal', 'weird', false, { kind: 'fatal', message: 'weird' }],
  ] as const)('%s', (_name, err, aborted, expected) => {
    expect(classifyFailure(err, aborted, now)).toMatchObject(expected);
  });
  it('addSeconds mints an IsoDateTime through core', () => {
    expect(addSeconds(now, 90)).toBe('2026-10-14T09:01:30.000Z');
  });
});
