// SearchApi's own balance (settings plan ruling 10): GET /api/v1/me under the unledgered `searchapi-account` id.
// Every body here is SYNTHETIC, built from the vendor's documented account shape (searchapi.io/docs/account-api);
// nothing recorded from the real account is kept in the repository.
import { BudgetExceeded } from '@gmt/core';
import { HttpResponse, http } from 'msw/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assertEgress } from '../../src/http/egress.js';
import { errorProviderId, ledgeredId } from '../../src/http/types.js';
import { searchApiAccount } from '../../src/searchapi/account.js';
import { searchApiAccountHttpLimits } from '../../src/searchapi/limits.js';
import { hangUntilAborted } from '../../src/testing/network.js';
import { makeKit, SENTINELS } from '../fakes.js';
import { server } from '../support/msw.js';
import { drive, useFakeTime } from '../support/time.js';

const ME = 'https://www.searchapi.io/api/v1/me';
const KEY = SENTINELS.searchapi;

/** A trial account body (synthetic): no `subscription` key, a one-off balance and a zero monthly allowance. */
const TRIAL = {
  account: { current_month_usage: 0, monthly_allowance: 0, remaining_credits: 38, remaining_searches: 38 },
  api_usage: { searches_this_hour: 0 },
};
/** A subscribed account body (synthetic): the documented `subscription` period, ISO instants in UTC. */
const subscribed = (periodEnd: string) => ({
  account: {
    current_month_usage: 12,
    monthly_allowance: 10_000,
    remaining_credits: 9_988,
    remaining_searches: 9_988,
  },
  api_usage: { searches_this_hour: 3 },
  subscription: { period_start: '2026-11-01T00:00:00Z', period_end: periodEnd },
});

function serve(body: unknown, status = 200) {
  const seen: Array<{ authorization: string | null; accept: string | null }> = [];
  server.use(
    http.get(ME, ({ request }) => {
      seen.push({
        authorization: request.headers.get('authorization'),
        accept: request.headers.get('accept'),
      });
      const text = typeof body === 'string' ? body : JSON.stringify(body);
      return new HttpResponse(text, { status, headers: { 'content-type': 'application/json' } });
    }),
  );
  return seen;
}

beforeEach(() => {
  useFakeTime();
  expect.hasAssertions();
});
afterEach(() => {
  server.resetHandlers();
  vi.useRealTimers();
});

const ask = (k: ReturnType<typeof makeKit>, timezone = 'Europe/London') =>
  drive(searchApiAccount(k.kit, KEY, { timezone, log: k.log, signal: new AbortController().signal }));

describe('searchApiAccount (synthetic bodies)', () => {
  it('a trial body gives its credits, a zero allowance and no period end', async () => {
    const seen = serve(TRIAL);
    const k = makeKit();
    await expect(ask(k)).resolves.toEqual({
      remaining: 38,
      monthlyAllowance: 0,
      periodEnd: null,
      fetchedAt: k.clock.now(),
    });
    // why: the key travels only as the Bearer header
    expect(seen).toEqual([{ authorization: `Bearer ${KEY.reveal()}`, accept: 'application/json' }]);
  });

  it.each([
    ['America/New_York', '2026-12-01T03:00:00Z', '2026-11-30'],
    ['Europe/London', '2026-07-31T23:30:00Z', '2026-08-01'],
    ['Europe/London', '2026-12-01T00:00:00Z', '2026-12-01'],
  ])('the period end in %s: %s is %s', async (timezone, instant, date) => {
    serve(subscribed(instant));
    const got = await ask(makeKit(), timezone);
    expect(got).toMatchObject({ remaining: 9_988, monthlyAllowance: 10_000, periodEnd: date });
  });

  it.each([
    ['a 401', () => serve({ error: 'Invalid API key.' }, 401)],
    ['a 500', () => serve({ error: 'down' }, 500)],
    ['a body that is not JSON', () => serve('<html>nope</html>')],
    ['a body without the account', () => serve({ api_usage: {} })],
    [
      'credits that are not a number',
      () => serve({ account: { ...TRIAL.account, remaining_searches: 'many' } }),
    ],
    ['a negative balance', () => serve({ account: { ...TRIAL.account, remaining_searches: -1 } })],
    ['a period end that is not an instant', () => serve(subscribed('soon'))],
  ])('%s gives null, with the key in no log line', async (_name, arrange) => {
    arrange();
    const k = makeKit();
    await expect(ask(k)).resolves.toBeNull();
    for (const line of k.log.lines) expect(line).not.toContain(KEY.reveal());
  });

  it('a timeout gives null after exactly one attempt, with the key in no log line', async () => {
    let attempts = 0;
    server.use(
      http.get(ME, ({ request }) => {
        attempts += 1;
        return hangUntilAborted(request);
      }),
    );
    // why: the limits as wired (10 s timeout, no transport retry), at rates that never queue
    const k = makeKit({
      limits: {
        'searchapi-account': {
          ...searchApiAccountHttpLimits({ maxWaitSeconds: 3900 }),
          ratePerMinute: 600,
          ratePerHour: 36_000,
        },
      },
    });
    await expect(ask(k)).resolves.toBeNull();
    expect(attempts).toBe(1);
    for (const line of k.log.lines) expect(line).not.toContain(KEY.reveal());
  }, 15_000);

  it('a 429 naming its quota with a short Retry-After gives null after exactly one attempt (quota is never retried)', async () => {
    let attempts = 0;
    server.use(
      http.get(ME, () => {
        attempts += 1;
        return new HttpResponse(JSON.stringify({ error: 'You have run out of credits.' }), {
          status: 429,
          headers: { 'content-type': 'application/json', 'retry-after': '2' },
        });
      }),
    );
    const k = makeKit({
      limits: {
        'searchapi-account': {
          ...searchApiAccountHttpLimits({ maxWaitSeconds: 3900 }),
          ratePerMinute: 600,
          ratePerHour: 36_000,
        },
      },
    });
    await expect(ask(k)).resolves.toBeNull();
    expect(attempts).toBe(1);
    expect(k.log.lines.join('\n')).toContain('quota');
  });

  it('an abort propagates, it is not an answer', async () => {
    server.use(http.get(ME, ({ request }) => hangUntilAborted(request)));
    const k = makeKit();
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 1000);
    await expect(
      drive(searchApiAccount(k.kit, KEY, { timezone: 'Europe/London', log: k.log, signal: ac.signal })),
    ).rejects.toMatchObject({ name: 'AbortedError' });
  });

  it('writes no ledger row and takes no reservation, and works with the local cap spent', async () => {
    serve(TRIAL);
    const k = makeKit();
    // why: a reservation made now would be refused, as every SearchApi call is once the local cap is spent
    k.budget.refuse = () =>
      new BudgetExceeded({
        scope: 'provider-lifetime',
        cap: 24,
        current: 24,
        requested: 1,
        providerId: 'searchapi',
      });
    await expect(ask(k)).resolves.toMatchObject({ remaining: 38 });
    expect(k.budget.reserveCalls).toBe(0);
    expect(k.budget.rows).toEqual([]);
  });

  it('is never answered from a cache: two asks reach SearchApi twice', async () => {
    const seen = serve(TRIAL);
    const k = makeKit();
    await ask(k);
    await ask(k);
    expect(seen).toHaveLength(2);
  });
});

describe('the account id (unledgered, its own limits)', () => {
  const limits = searchApiAccountHttpLimits({ maxWaitSeconds: 3900 });
  it('is never ledgered, has no cache, a 10 s timeout and SearchApi’s host', () => {
    expect(ledgeredId('searchapi-account')).toBeNull();
    expect(errorProviderId('searchapi-account')).toBe('searchapi');
    expect(limits).toMatchObject({
      hosts: ['www.searchapi.io'],
      billable: 'never',
      costPerCallMicroGbp: 0,
      requestTimeoutSeconds: 10,
      concurrency: 1,
      retryTransport: false,
      // why: never the shared hour-long wait: a read that cannot start within its timeout is dropped
      maxWaitSeconds: 10,
    });
    expect(searchApiAccountHttpLimits({ maxWaitSeconds: 3 }).maxWaitSeconds).toBe(3);
  });
  const req = (path: string, method: 'GET' | 'POST' = 'GET') => ({
    providerId: 'searchapi-account' as const,
    executionId: null,
    tileIndex: null,
    endpointPath: path,
    method,
    url: new URL(`https://www.searchapi.io${path}`),
    headers: {},
    cache: 'never' as const,
    signal: new AbortController().signal,
    recordFixtures: false,
  });
  it('egress allows GET /api/v1/me and refuses the search route and any other method', () => {
    expect(() => assertEgress(req('/api/v1/me'), limits, [KEY])).not.toThrow();
    expect(() => assertEgress(req('/api/v1/search'), limits, [KEY])).toThrow(/GET \/api\/v1\/me only/);
    expect(() => assertEgress(req('/api/v1/me', 'POST'), limits, [KEY])).toThrow(/only/);
  });
});
