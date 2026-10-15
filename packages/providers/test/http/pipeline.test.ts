import { HttpResponse, http } from 'msw/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeKit, req, SEARCH } from '../fakes.js';
import { server } from '../support/msw.js';
import { drive, useFakeTime } from '../support/time.js';

describe('http-kit pipeline order (spec §5.3)', () => {
  beforeEach(useFakeTime);
  afterEach(() => vi.useRealTimers());

  it('reserves before every fetch: 503 then 200 → reserve, fetch, finalise(error), reserve, fetch, finalise(ok)', async () => {
    const { kit, budget } = makeKit();
    let n = 0;
    server.use(
      http.get(SEARCH, () => {
        n += 1;
        return n === 1
          ? HttpResponse.json({ error: 'busy' }, { status: 503 })
          : HttpResponse.json({ ok: true });
      }),
    );

    const res = await drive(kit.request(req({ url: `${SEARCH}?engine=google_flights_calendar` })));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(res.fromCache).toBe(false);
    expect(budget.sequence()).toEqual([
      'reserve',
      'fetch',
      'finalise:error',
      'reserve',
      'fetch',
      'finalise:ok',
    ]);
    const reserves = budget.events.flatMap((e) => (e.type === 'reserve' ? [e] : []));
    expect(reserves.map((e) => e.httpAttempt)).toEqual([1, 2]);
    expect(reserves.every((e) => e.endpointPath === '/api/v1/search' && e.tileIndex === 0)).toBe(true);
    const finals = budget.events.flatMap((e) => (e.type === 'finalise' ? [e] : []));
    expect(finals.map((e) => e.httpStatus)).toEqual([503, 200]);
  });
});
