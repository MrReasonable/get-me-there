import { AbortedError } from '@gmt/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLimiter } from '../../src/http/limiter.js';
import { sleep } from '../../src/http/sleep.js';
import { byPair, parseMaybeJson } from '../../src/util.js';
import { testLimits } from '../fakes.js';
import { drive, driveError, idle, useFakeTime } from '../support/time.js';

// why: per-file paths the aggregate coverage floor hid (test-strategy minor 3): the abortable Retry-After sleep, the
// limiter's abort paths, and the small JSON and ordering helpers.

describe('sleep (Retry-After wait, spec §5.3)', () => {
  beforeEach(useFakeTime);
  afterEach(() => vi.useRealTimers());

  it('resolves after the wait', async () => {
    const t0 = Date.now();
    await drive(sleep(3000, new AbortController().signal));
    expect(Date.now() - t0).toBeGreaterThanOrEqual(3000);
  });
  it('rejects with AbortedError at once when the signal is already aborted', async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(sleep(3000, ac.signal)).rejects.toBeInstanceOf(AbortedError);
  });
  it('rejects with AbortedError as soon as the signal aborts mid-wait', async () => {
    const ac = new AbortController();
    const p = sleep(60_000, ac.signal);
    setTimeout(() => ac.abort(), 1000);
    const t0 = Date.now();
    expect(await driveError(p)).toBeInstanceOf(AbortedError);
    expect(Date.now() - t0).toBeLessThan(5000);
  });
});

describe('limiter abort paths', { timeout: 60_000 }, () => {
  beforeEach(useFakeTime);
  afterEach(() => vi.useRealTimers());
  const limits = testLimits({ searchapi: { ratePerMinute: 1, ratePerHour: 10, concurrency: 1 } }).searchapi;
  const opts = (signal: AbortSignal) => ({
    signal,
    maxWaitMs: 3_900_000,
    providerId: 'searchapi' as const,
    endpointPath: '/api/v1/search',
  });

  it('an already-aborted signal rejects at once and never runs the job', async () => {
    const limiter = createLimiter(limits, { usedThisHour: 0 });
    const ac = new AbortController();
    ac.abort();
    let ran = false;
    expect(
      await driveError(
        limiter.run(async () => {
          ran = true;
        }, opts(ac.signal)),
      ),
    ).toBeInstanceOf(AbortedError);
    await idle(10_000);
    expect(ran).toBe(false);
    expect(await drive(limiter.reservoirs())).toEqual({ minute: 1, hour: 10 });
  });
  it('a job aborted while waiting for the per-minute stage refunds both tokens when it is released', async () => {
    const limiter = createLimiter(limits, { usedThisHour: 0 });
    await drive(limiter.run(async () => 'first', opts(new AbortController().signal)));
    const ac = new AbortController();
    let ran = false;
    const queued = limiter.run(async () => {
      ran = true;
    }, opts(ac.signal));
    setTimeout(() => ac.abort(), 5000);
    expect(await driveError(queued)).toBeInstanceOf(AbortedError);
    await idle(61_000);
    expect(ran).toBe(false);
    expect(await drive(limiter.reservoirs())).toEqual({ minute: 1, hour: 9 });
  });
});

describe('util helpers', () => {
  it('parseMaybeJson: undefined → null, JSON text → value, other text → the text', () => {
    expect(parseMaybeJson(undefined)).toBeNull();
    expect(parseMaybeJson('{"a":1}')).toEqual({ a: 1 });
    expect(parseMaybeJson('a=1&b=2')).toBe('a=1&b=2');
  });
  it('byPair orders by name, then value, and ties at 0', () => {
    expect(
      [
        ['b', '1'],
        ['a', '2'],
        ['a', '1'],
      ]
        .map((p): [string, string] => [p[0] ?? '', p[1] ?? ''])
        .sort(byPair),
    ).toEqual([
      ['a', '1'],
      ['a', '2'],
      ['b', '1'],
    ]);
    expect(byPair(['a', '1'], ['a', '1'])).toBe(0);
  });
});
