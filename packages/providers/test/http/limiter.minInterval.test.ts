import { HttpResponse, http } from 'msw/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeKit, req, SEARCH } from '../fakes.js';
import { server } from '../support/msw.js';
import { drive, useFakeTime } from '../support/time.js';

const nth = (i: number) => req({ url: `${SEARCH}?n=${i}` });
// why: the fetch event is stamped as msw sees the request, a millisecond either side of the limiter's start.
const SLACK_MS = 5;
const starts = (events: ReturnType<typeof makeKit>['events']) =>
  events.flatMap((e) => (e.type === 'fetch' ? [e.at] : []));

describe('limiter minIntervalMs (decision 69 ruling 7: start to start)', { timeout: 60_000 }, () => {
  beforeEach(useFakeTime);
  afterEach(() => vi.useRealTimers());

  it('with minIntervalMs 120 000 and ratePerMinute 1, six jobs start at least 120 s apart', async () => {
    const { kit, events } = makeKit({
      overrides: {
        searchapi: { minIntervalMs: 120_000, ratePerMinute: 1, ratePerHour: 100, concurrency: 1 },
      },
    });
    server.use(http.get(SEARCH, () => HttpResponse.json({ ok: true })));
    await drive(Promise.all([1, 2, 3, 4, 5, 6].map((i) => kit.request(nth(i)))), {
      stepMs: 1000,
      maxMs: 1_200_000,
    });
    const at = starts(events);
    expect(at).toHaveLength(6);
    for (let i = 1; i < at.length; i++)
      expect((at[i] ?? 0) - (at[i - 1] ?? 0)).toBeGreaterThanOrEqual(120_000 - SLACK_MS);
  });
  it('without it the old ceil(60000 / ratePerMinute) rule is unchanged', async () => {
    const { kit, events } = makeKit({ overrides: { searchapi: { ratePerMinute: 4, concurrency: 1 } } });
    server.use(http.get(SEARCH, () => HttpResponse.json({ ok: true })));
    await drive(Promise.all([1, 2, 3].map((i) => kit.request(nth(i)))), { stepMs: 250 });
    const at = starts(events);
    for (let i = 1; i < at.length; i++) {
      expect((at[i] ?? 0) - (at[i - 1] ?? 0)).toBeGreaterThanOrEqual(15_000 - SLACK_MS);
      expect((at[i] ?? 0) - (at[i - 1] ?? 0)).toBeLessThan(120_000);
    }
  });
});
