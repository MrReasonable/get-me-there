// WP18 V3: http-kit writes the adapters' own class of a failed call on its ledger row (Reservation.classify), the one
// classification the Status report reads. 401, 403 with quota words, 403 without, 429 with credits words, 5xx, a socket
// failure and a 200 whose body is not JSON.
import { HttpResponse, http } from 'msw/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { classifySearchApiError } from '../../src/searchapi/limits.js';
import { makeKit, req, SEARCH } from '../fakes.js';
import { server } from '../support/msw.js';
import { drive, driveError, useFakeTime } from '../support/time.js';

const reply = (status: number, body: unknown) =>
  server.use(
    http.get(
      SEARCH,
      () =>
        new HttpResponse(typeof body === 'string' ? body : JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' },
        }),
    ),
  );

describe('the class of a failed call is recorded where it is classified (V3)', () => {
  beforeEach(useFakeTime);
  afterEach(() => vi.useRealTimers());

  it.each([
    ['401 invalid key', 401, { error: 'Invalid API key' }, 'auth'],
    ['403 with quota words', 403, { error: 'You have used all your credits for this plan' }, 'quota'],
    ['403 without them', 403, { error: 'Forbidden' }, 'auth'],
    ['429 with credit words', 429, { error: 'Monthly credits exhausted' }, 'quota'],
    ['402', 402, { error: 'payment required' }, 'quota'],
    ['500', 500, { error: 'boom' }, 'upstream'],
  ] as const)('%s is %s', async (_name, status, body, kind) => {
    const { kit, budget } = makeKit({ overrides: { searchapi: { classifyError: classifySearchApiError } } });
    reply(status, body);
    await driveError(kit.request(req({ url: SEARCH })));
    // why: a 5xx is retried, so every attempt's row carries the class
    const kinds = new Set(budget.rowsOf('searchapi').map((r) => r.errorKind));
    expect([...kinds]).toEqual([kind]);
  });

  it('a 200 whose body is not JSON is recorded as parse, though the row ends ok', async () => {
    const { kit, budget } = makeKit();
    reply(200, '<html>maintenance</html>');
    await driveError(kit.request(req({ url: SEARCH })));
    const [row] = budget.rowsOf('searchapi');
    expect(row?.outcome).toBe('ok');
    expect(row?.errorKind).toBe('parse');
  });

  it('a good answer records no class, and a socket failure records the network class', async () => {
    const good = makeKit();
    reply(200, { fine: true });
    await drive(good.kit.request(req({ url: SEARCH })));
    expect(good.budget.rowsOf('searchapi').map((r) => r.errorKind)).toEqual([undefined]);
    const down = makeKit();
    server.use(http.get(SEARCH, () => HttpResponse.error()));
    await driveError(down.kit.request(req({ url: SEARCH })));
    expect(new Set(down.budget.rowsOf('searchapi').map((r) => r.errorKind))).toEqual(new Set(['network']));
  });
});
