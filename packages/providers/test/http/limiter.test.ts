import { AbortedError, asIsoDateTime, BudgetExceeded } from '@gmt/core';
import { HttpResponse, http } from 'msw/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLimiter, HOLD_MAX_MS, HOUR_MS } from '../../src/http/limiter.js';
import { FakeBudget, makeKit, req, SEARCH, TP, testLimits } from '../fakes.js';
import { asProviderError } from '../support/guards.js';
import { respondAfter, server } from '../support/msw.js';
import { drive, driveError, idle, useFakeTime } from '../support/time.js';

const ok = () => server.use(http.get(SEARCH, () => HttpResponse.json({ ok: true })));
const fetchTimes = (events: ReturnType<typeof makeKit>['events'], t0: number) =>
  events.flatMap((e) => (e.type === 'fetch' ? [e.at - t0] : [])).sort((a, b) => a - b);
// why: distinct query values so in-flight dedup (Task 4.6) never merges these requests.
const nth = (i: number) => req({ url: `${SEARCH}?n=${i}` });
// why: bottleneck guarantees the rate per fixed window counted from limiter creation (plan decision 17); minTime only smooths.
const maxPerFixedMinute = (times: number[]) =>
  Math.max(
    ...[...new Set(times.map((t) => Math.floor(t / 60_000)))].map(
      (w) => times.filter((t) => Math.floor(t / 60_000) === w).length,
    ),
  );
const HOURS = { stepMs: 30_000, maxMs: 8_000_000 };

// why: the hour-scale cases advance fake time over two hours; the default 5 s test timeout is too short.
describe('limiter (spec §5.3)', { timeout: 60_000 }, () => {
  beforeEach(useFakeTime);
  afterEach(() => vi.useRealTimers());

  it('maxConcurrent 1 runs one request at a time', async () => {
    const { kit, events } = makeKit({ overrides: { searchapi: { concurrency: 1 } } });
    server.use(
      http.get(SEARCH, ({ request }) => respondAfter(request, 10_000, () => HttpResponse.json({ ok: true }))),
    );
    const t0 = Date.now();
    await drive(Promise.all([kit.request(nth(1)), kit.request(nth(2))]));
    expect(fetchTimes(events, t0)[1] ?? 0).toBeGreaterThanOrEqual(10_000);
  });

  it('a per-minute reservoir of 2 allows at most 2 fetches per fixed minute window and holds the third until the minute refreshes', async () => {
    const { kit, events } = makeKit({ overrides: { searchapi: { ratePerMinute: 2 } } });
    ok();
    const t0 = Date.now();
    await drive(Promise.all([kit.request(nth(1)), kit.request(nth(2)), kit.request(nth(3))]));
    const at = fetchTimes(events, t0);
    expect(at[2] ?? 0).toBeGreaterThanOrEqual(59_000);
    expect(maxPerFixedMinute(at)).toBeLessThanOrEqual(2);
  });

  it('the hourly reservoir holds a request even when the minute has room', async () => {
    const { kit, events } = makeKit({ overrides: { searchapi: { ratePerMinute: 10, ratePerHour: 2 } } });
    ok();
    const t0 = Date.now();
    await drive(Promise.all([kit.request(nth(1)), kit.request(nth(2)), kit.request(nth(3))]), HOURS);
    expect(fetchTimes(events, t0)[2] ?? 0).toBeGreaterThanOrEqual(3_590_000);
  });

  it('no fixed minute window, before or after an hourly refill, holds more than ratePerMinute fetches (cost-005)', async () => {
    const { kit, events } = makeKit({ overrides: { searchapi: { ratePerMinute: 2, ratePerHour: 3 } } });
    ok();
    const t0 = Date.now();
    await drive(Promise.all([1, 2, 3, 4, 5, 6].map((i) => kit.request(nth(i)))), HOURS);
    const at = fetchTimes(events, t0);
    expect(at).toHaveLength(6);
    expect(maxPerFixedMinute(at)).toBeLessThanOrEqual(2);
  });

  it('seeds the hourly reservoir from recentCalls, so a restart does not grant a fresh hour (ruling 9)', async () => {
    const budget = new FakeBudget([]);
    budget.recent.set('searchapi', 1);
    const { kit, events } = makeKit({ budget, overrides: { searchapi: { ratePerHour: 2 } } });
    ok();
    const t0 = Date.now();
    await drive(Promise.all([kit.request(nth(1)), kit.request(nth(2))]), HOURS);
    const at = fetchTimes(events, t0);
    expect(new Set(budget.recentSince)).toEqual(new Set(['2026-10-14T14:00:00.000Z']));
    expect(at[0] ?? Number.POSITIVE_INFINITY).toBeLessThan(1000);
    expect(at[1] ?? 0).toBeGreaterThanOrEqual(3_590_000);
  });

  it('a queue wait beyond maxWaitSeconds → limiter-timeout with retryAfterSeconds to the minute refresh; the abandoned job never reserves', async () => {
    const { kit, budget } = makeKit({ overrides: { searchapi: { ratePerMinute: 1, maxWaitSeconds: 30 } } });
    ok();
    const first = kit.request(nth(1));
    const second = kit.request(nth(2));
    await drive(first);
    const err = asProviderError(await driveError(second));
    expect(err).toMatchObject({
      kind: 'limiter-timeout',
      retryable: false,
      message: expect.stringContaining('[queue-wait-exceeded]'),
    });
    expect(err.retryAfterSeconds ?? 0).toBeGreaterThanOrEqual(29);
    expect(err.retryAfterSeconds ?? 0).toBeLessThanOrEqual(31);
    await idle(70_000);
    expect(budget.reserveCalls).toBe(1);
    expect(budget.count('fetch')).toBe(1);
  });

  it('when the hourly reservoir is the exhausted one, retryAfterSeconds points at the hour refresh', async () => {
    const { kit } = makeKit({
      overrides: { searchapi: { ratePerMinute: 10, ratePerHour: 1, maxWaitSeconds: 60 } },
    });
    ok();
    await drive(kit.request(nth(1)));
    const err = asProviderError(await driveError(kit.request(nth(2))));
    expect(err.kind).toBe('limiter-timeout');
    expect(err.retryAfterSeconds ?? 0).toBeGreaterThan(3400);
  });

  it('an abort while queued → AbortedError, and the abandoned job never reserves', async () => {
    const { kit, budget } = makeKit({ overrides: { searchapi: { ratePerMinute: 1 } } });
    ok();
    await drive(kit.request(nth(1)));
    const ac = new AbortController();
    const queued = kit.request(req({ url: `${SEARCH}?n=2`, signal: ac.signal }));
    setTimeout(() => ac.abort(), 5000);
    expect(await driveError(queued)).toBeInstanceOf(AbortedError);
    await idle(70_000);
    expect(budget.reserveCalls).toBe(1);
  });

  it('each provider has its own limiter', async () => {
    const { kit, events } = makeKit({ overrides: { searchapi: { ratePerMinute: 1 } } });
    ok();
    server.use(http.get(TP, () => HttpResponse.json({ success: true })));
    const t0 = Date.now();
    await drive(kit.request(nth(1)));
    await drive(kit.request(req({ url: TP, providerId: 'travelpayouts', headers: {} })));
    expect(fetchTimes(events, t0).every((t) => t < 1000)).toBe(true);
  });
});

describe('createLimiter token refunds (cost-006)', { timeout: 60_000 }, () => {
  beforeEach(useFakeTime);
  afterEach(() => vi.useRealTimers());

  it('a job abandoned by limiter-timeout refunds its minute and hour tokens when it is finally released', async () => {
    const limits = testLimits({ searchapi: { ratePerMinute: 1, ratePerHour: 10, concurrency: 1 } }).searchapi;
    const limiter = createLimiter(limits, { usedThisHour: 0 });
    const o = {
      signal: new AbortController().signal,
      maxWaitMs: 30_000,
      providerId: 'searchapi' as const,
      endpointPath: '/api/v1/search',
    };
    await drive(limiter.run(async () => 'a', o));
    await driveError(limiter.run(async () => 'b', o));
    await idle(61_000);
    // why: bottleneck's store yields through setTimeout(0), so even a reservoir read needs fake time driven.
    expect(await drive(limiter.reservoirs())).toEqual({ minute: 1, hour: 9 });
  });
});

describe('dead jobs and refused reservations do not hold limiter capacity (cost minor 2)', {
  timeout: 60_000,
}, () => {
  beforeEach(useFakeTime);
  afterEach(() => vi.useRealTimers());

  it('a reservation refused by the budget refunds its minute and hour tokens', async () => {
    const limits = testLimits({ searchapi: { ratePerMinute: 3, ratePerHour: 5 } }).searchapi;
    const limiter = createLimiter(limits, { usedThisHour: 0 });
    const o = {
      signal: new AbortController().signal,
      maxWaitMs: 30_000,
      providerId: 'searchapi' as const,
      endpointPath: '/api/v1/search',
    };
    const refused = new BudgetExceeded({ scope: 'provider-month', cap: 0, current: 0, requested: 1 });
    expect(
      await driveError(
        limiter.run(async () => {
          throw refused;
        }, o),
      ),
    ).toBe(refused);
    expect(await drive(limiter.reservoirs())).toEqual({ minute: 3, hour: 5 });
    await drive(limiter.run(async () => 'sent', o));
    expect(await drive(limiter.reservoirs())).toEqual({ minute: 2, hour: 4 });
  });

  it('a backlog of timed-out jobs is dropped before the per-minute stage, so a live job is not delayed by their minTime slots', async () => {
    const { kit, events } = makeKit({
      overrides: { searchapi: { ratePerMinute: 10, ratePerHour: 2, maxWaitSeconds: 30 } },
    });
    ok();
    const t0 = Date.now();
    await drive(Promise.all([kit.request(nth(1)), kit.request(nth(2))]));
    const dead = [3, 4, 5, 6, 7].map((i) => kit.request(nth(i)).catch((e: unknown) => e));
    for (const e of await drive(Promise.all(dead))) expect(asProviderError(e).kind).toBe('limiter-timeout');
    await idle(3_595_000 - (Date.now() - t0), 30_000);
    await drive(kit.request(nth(8)), HOURS);
    const at = fetchTimes(events, t0);
    expect(at).toHaveLength(3);
    expect(at[2] ?? Number.POSITIVE_INFINITY).toBeLessThan(3_612_000);
  });
});

// Spec rev 56 §5.3 (R-spacing; arch-r3-018): `holdUntil(providerId, at)` makes that provider's next start wait until
// `at`: awaited before the request joins the limiter's queue, under its signal, outside the queue's maximum wait.
describe('holdUntil: the next start waits for the worker’s nextLoadNotBefore (spec rev 56 §5.3)', {
  timeout: 60_000,
}, () => {
  beforeEach(useFakeTime);
  afterEach(() => vi.useRealTimers());
  const inMs = (ms: number) => asIsoDateTime(new Date(Date.now() + ms).toISOString());

  it('the held provider’s next fetch starts at `at`, not before', async () => {
    const { kit, events } = makeKit();
    ok();
    const t0 = Date.now();
    kit.holdUntil('searchapi', inMs(50_000));
    await drive(kit.request(nth(1)));
    const [at] = fetchTimes(events, t0);
    expect(at ?? 0).toBeGreaterThanOrEqual(50_000);
    expect(at ?? Number.POSITIVE_INFINITY).toBeLessThan(51_000);
  });
  it('an `at` in the past does nothing', async () => {
    const { kit, events } = makeKit();
    ok();
    const t0 = Date.now();
    kit.holdUntil('searchapi', inMs(-60_000));
    await drive(kit.request(nth(1)));
    expect(fetchTimes(events, t0)[0] ?? Number.POSITIVE_INFINITY).toBeLessThan(1000);
  });
  it('holds only that provider', async () => {
    const { kit, events } = makeKit();
    server.use(http.get(TP, () => HttpResponse.json({ success: true })));
    const t0 = Date.now();
    kit.holdUntil('searchapi', inMs(50_000));
    await drive(kit.request(req({ url: TP, providerId: 'travelpayouts', headers: {} })));
    expect(fetchTimes(events, t0)[0] ?? Number.POSITIVE_INFINITY).toBeLessThan(1000);
  });
  it('a hold longer than maxWaitSeconds still waits, and is no limiter timeout', async () => {
    const { kit, events } = makeKit({ overrides: { searchapi: { maxWaitSeconds: 30 } } });
    ok();
    const t0 = Date.now();
    kit.holdUntil('searchapi', inMs(120_000));
    const res = await drive(kit.request(nth(1)));
    expect(res.status).toBe(200);
    expect(fetchTimes(events, t0)[0] ?? 0).toBeGreaterThanOrEqual(120_000);
  });
  it('an abort during the hold → AbortedError, nothing reserved or sent', async () => {
    const { kit, budget } = makeKit();
    ok();
    kit.holdUntil('searchapi', inMs(120_000));
    const ac = new AbortController();
    const held = kit.request(req({ url: SEARCH, signal: ac.signal }));
    setTimeout(() => ac.abort(), 5000);
    expect(await driveError(held)).toBeInstanceOf(AbortedError);
    await idle(130_000, 5000);
    expect(budget.reserveCalls).toBe(0);
    expect(budget.count('fetch')).toBe(0);
  });
  it('a later hold extends an earlier one; an earlier one never shortens a later one', async () => {
    const { kit, events } = makeKit();
    ok();
    const t0 = Date.now();
    kit.holdUntil('searchapi', inMs(30_000));
    kit.holdUntil('searchapi', inMs(90_000));
    kit.holdUntil('searchapi', inMs(10_000));
    await drive(kit.request(nth(1)));
    expect(fetchTimes(events, t0)[0] ?? 0).toBeGreaterThanOrEqual(90_000);
  });
  it('a hold set while a request already waits on an earlier one holds it to the later `at`', async () => {
    const { kit, events } = makeKit();
    ok();
    const t0 = Date.now();
    kit.holdUntil('searchapi', inMs(30_000));
    const waiting = kit.request(nth(1));
    await idle(10_000, 5000);
    kit.holdUntil('searchapi', inMs(60_000));
    await drive(waiting);
    expect(fetchTimes(events, t0)[0] ?? 0).toBeGreaterThanOrEqual(70_000);
  });
  // why: CodeRabbit (WP21): a far-future `at` (a corrupt pacer record) would hold the provider without end; the worker
  // states at most a page in flight and its spacing, well inside the hour, so a later `at` is cut to HOLD_MAX_MS
  it('holds at most HOLD_MAX_MS (1 h) past now: a later `at` starts the fetch at the hour', async () => {
    expect(HOLD_MAX_MS).toBe(HOUR_MS);
    const { kit, events } = makeKit();
    ok();
    const t0 = Date.now();
    kit.holdUntil('searchapi', inMs(365 * 24 * HOUR_MS));
    await drive(kit.request(nth(1)), { stepMs: 500, maxMs: 2 * HOUR_MS });
    const [at] = fetchTimes(events, t0);
    expect(at ?? 0).toBeGreaterThanOrEqual(HOUR_MS);
    expect(at ?? Number.POSITIVE_INFINITY).toBeLessThan(HOUR_MS + 1000);
  });
  it('a hold for an id without limits (no limiter) does nothing', () => {
    const { kit } = makeKit({ limits: { searchapi: testLimits().searchapi } });
    expect(() => kit.holdUntil('camoufox', inMs(50_000))).not.toThrow();
  });
  // why: 21.4 review M1: a job already queued when the hold is set has passed the wait before the queue; it waits
  // again once its slot is granted, so the hold an answer sets inside a running job holds the job queued behind it
  it('createLimiter: a job already queued when a running job sets the hold starts at or after `at`', async () => {
    const limiter = createLimiter(testLimits({ searchapi: { concurrency: 1 } }).searchapi, {
      usedThisHour: 0,
    });
    const t0 = Date.now();
    // why: the second job queues for the first one's 10 s, within its maximum wait; the hold itself is outside it
    const o = {
      signal: new AbortController().signal,
      maxWaitMs: 20_000,
      providerId: 'searchapi' as const,
      endpointPath: '/api/v1/search',
    };
    const starts: number[] = [];
    const first = limiter.run(async () => {
      starts.push(Date.now() - t0);
      await new Promise<void>((resolve) => setTimeout(resolve, 10_000));
      limiter.holdUntil(t0 + 60_000);
    }, o);
    const second = limiter.run(async () => {
      starts.push(Date.now() - t0);
    }, o);
    await drive(Promise.all([first, second]));
    expect(starts[0] ?? Number.POSITIVE_INFINITY).toBeLessThan(1000);
    expect(starts[1] ?? 0).toBeGreaterThanOrEqual(60_000);
    expect(starts[1] ?? Number.POSITIVE_INFINITY).toBeLessThan(61_000);
  });
  it('createLimiter: an abort while a granted job waits for the hold → AbortedError, the job never runs, its tokens back', async () => {
    const limiter = createLimiter(testLimits({ searchapi: { concurrency: 1 } }).searchapi, {
      usedThisHour: 0,
    });
    const t0 = Date.now();
    const base = { maxWaitMs: 20_000, providerId: 'searchapi' as const, endpointPath: '/api/v1/search' };
    const ac = new AbortController();
    let ran = false;
    const first = limiter.run(
      async () => {
        await new Promise<void>((resolve) => setTimeout(resolve, 10_000));
        limiter.holdUntil(t0 + 60_000);
      },
      { ...base, signal: new AbortController().signal },
    );
    const second = limiter.run(
      async () => {
        ran = true;
      },
      { ...base, signal: ac.signal },
    );
    setTimeout(() => ac.abort(), 30_000);
    await drive(first);
    expect(await driveError(second)).toBeInstanceOf(AbortedError);
    expect(ran).toBe(false);
    // why: both jobs took a token; the aborted one sent nothing and hands both of its tokens back
    const l = testLimits().searchapi;
    expect(await drive(limiter.reservoirs())).toEqual({
      minute: l.ratePerMinute - 1,
      hour: l.ratePerHour - 1,
    });
  });
  it('createLimiter: run waits for the hold before the job joins the queue', async () => {
    const limiter = createLimiter(testLimits().searchapi, { usedThisHour: 0 });
    const t0 = Date.now();
    limiter.holdUntil(t0 + 40_000);
    let startedAt = Number.NaN;
    await drive(
      limiter.run(
        async () => {
          startedAt = Date.now() - t0;
        },
        {
          signal: new AbortController().signal,
          maxWaitMs: 1000,
          providerId: 'searchapi',
          endpointPath: '/api/v1/search',
        },
      ),
    );
    expect(startedAt).toBeGreaterThanOrEqual(40_000);
    expect(startedAt).toBeLessThan(41_000);
  });
});
