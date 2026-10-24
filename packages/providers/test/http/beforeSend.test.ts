// http-kit's `beforeSend` (decision 83; WP16a review S3, S4): the caller's last check runs once the limiter admits the
// attempt and before the reservation, so a refusal sends nothing, reserves nothing, ledgers nothing and is not retried,
// and the limiter hands its hour and minute tokens back (its start-to-start spacing cannot be, and is pinned here).
// Fake transport (msw) and fake time; the worked example's vendor host only.
import { AbortedError } from '@gmt/core';
import { HttpResponse, http } from 'msw/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLimiter, NotSent } from '../../src/http/limiter.js';
import { makeKit, req, SEARCH, testLimits } from '../fakes.js';
import { server } from '../support/msw.js';
import { drive, driveError, useFakeTime } from '../support/time.js';

const fetches = (events: ReturnType<typeof makeKit>['events']) => events.filter((e) => e.type === 'fetch');

describe('http-kit beforeSend (review S4)', () => {
  beforeEach(useFakeTime);
  afterEach(() => vi.useRealTimers());

  it('a refusal sends nothing, reserves nothing, ledgers nothing and is not retried; the caller gets its own error', async () => {
    const { kit, budget, events } = makeKit();
    server.use(http.get(SEARCH, () => HttpResponse.json({ ok: true })));
    let calls = 0;
    const err = await driveError(
      kit.request(
        req({
          url: `${SEARCH}?engine=google_flights_calendar`,
          beforeSend: () => {
            calls += 1;
            throw new AbortedError();
          },
        }),
      ),
    );
    expect(err).toBeInstanceOf(AbortedError);
    expect(calls).toBe(1);
    expect(fetches(events)).toEqual([]);
    expect(budget.reserveCalls).toBe(0);
    expect(budget.rows).toEqual([]);
    expect(budget.sequence()).toEqual([]);
  });

  it('runs once the limiter admits the attempt and before its reservation', async () => {
    const { kit, budget } = makeKit({ overrides: { searchapi: { ratePerMinute: 1, concurrency: 1 } } });
    server.use(http.get(SEARCH, () => HttpResponse.json({ ok: true })));
    const seen: Array<{ at: number; reservesBefore: number }> = [];
    const t0 = Date.now();
    const one = (n: number) =>
      kit.request(
        req({
          url: `${SEARCH}?n=${n}`,
          beforeSend: () => {
            seen.push({ at: Date.now() - t0, reservesBefore: budget.reserveCalls });
          },
        }),
      );
    await drive(Promise.all([one(1), one(2)]), { stepMs: 1000, maxMs: 300_000 });
    expect(seen.map((s) => s.reservesBefore)).toEqual([0, 1]);
    // the second waited for the limiter's next minute before its check ran
    expect(seen[1]?.at ?? 0).toBeGreaterThanOrEqual(55_000);
  });

  it('a refusal on the second attempt, after a retryable 503 on the first: one reservation, one fetch, nothing more', async () => {
    const { kit, budget, events } = makeKit();
    server.use(http.get(SEARCH, () => HttpResponse.json({ error: 'busy' }, { status: 503 })));
    let calls = 0;
    const err = await driveError(
      kit.request(
        req({
          url: `${SEARCH}?engine=google_flights_calendar`,
          beforeSend: () => {
            calls += 1;
            if (calls === 2) throw new AbortedError();
          },
        }),
      ),
    );
    expect(err).toBeInstanceOf(AbortedError);
    expect(calls).toBe(2);
    expect(fetches(events)).toHaveLength(1);
    expect(budget.sequence()).toEqual(['reserve', 'fetch', 'finalise:error']);
  });
});

describe('the limiter and a refusal before sending (review S3)', () => {
  beforeEach(useFakeTime);
  afterEach(() => vi.useRealTimers());

  it('returns the hour and minute tokens and rejects with the caller’s error; the start-to-start spacing stands', async () => {
    const limits = {
      ...testLimits().camoufox,
      ratePerMinute: 2,
      ratePerHour: 10,
      concurrency: 1,
      minIntervalMs: 30_000,
    };
    const limiter = createLimiter(limits, { usedThisHour: 0 });
    const opts = {
      signal: new AbortController().signal,
      maxWaitMs: 600_000,
      providerId: 'camoufox' as const,
      endpointPath: '/v1/page',
    };
    const before = await drive(limiter.reservoirs());
    const refused = await driveError(
      limiter.run(async () => {
        throw new NotSent(new AbortedError());
      }, opts),
    );
    expect(refused).toBeInstanceOf(AbortedError);
    expect(await drive(limiter.reservoirs())).toEqual(before);
    const refusedAt = Date.now();
    let startedAt = 0;
    await drive(
      limiter.run(async () => {
        startedAt = Date.now();
      }, opts),
      { stepMs: 1000, maxMs: 120_000 },
    );
    // why: bottleneck's minTime counts from the refused job's launch, which happened; it is not handed back
    expect(startedAt - refusedAt).toBeGreaterThanOrEqual(29_000);
  });
});
