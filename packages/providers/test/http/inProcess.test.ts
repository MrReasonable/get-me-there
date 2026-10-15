import { AbortedError, Secret } from '@gmt/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeBudget, makeKit, req, testLimits } from '../fakes.js';
import { drive, driveError, useFakeTime } from '../support/time.js';

const HEALTH = 'http://fixture.local/health';
const healthReq = (over: Partial<Parameters<typeof req>[0]> = {}) =>
  req({ url: HEALTH, providerId: 'fixture', headers: {}, tileIndex: null, ...over });
const finals = (events: ReturnType<typeof makeKit>['events']) =>
  events.flatMap((e) => (e.type === 'finalise' ? [e] : []));

describe('in-process transport seam (spec §5.3 rev 11)', () => {
  beforeEach(useFakeTime);
  afterEach(() => vi.useRealTimers());

  it('dispatches fixture.local in process; reserve precedes dispatch and finalise follows; msw sees nothing', async () => {
    const budget = new FakeBudget([]);
    const seen: string[] = [];
    const { kit } = makeKit({
      budget,
      inProcessHosts: {
        'fixture.local': async (r) => {
          seen.push(`${r.method} ${r.url}`);
          budget.events.push({ type: 'fetch', at: Date.now(), url: r.url, method: r.method, headers: {} });
          return Response.json({ synthetic: true, ok: true });
        },
      },
    });
    expect((await drive(kit.request(healthReq()))).body).toEqual({ synthetic: true, ok: true });
    expect(seen).toEqual([`GET ${HEALTH}`]);
    expect(budget.sequence()).toEqual(['reserve', 'fetch', 'finalise:ok']);
  });

  it('the per-request timeout and abort apply to an in-process call', async () => {
    const hang = { 'fixture.local': () => new Promise<Response>(() => undefined) };
    const timed = makeKit({ inProcessHosts: hang, overrides: { fixture: { requestTimeoutSeconds: 5 } } });
    expect(await driveError(timed.kit.request(healthReq()))).toMatchObject({
      kind: 'network',
      message: expect.stringContaining('[timeout]'),
    });
    expect(timed.budget.sequence()).toEqual(['reserve', 'finalise:unknown']);
    const aborted = makeKit({ inProcessHosts: hang });
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 1000);
    expect(await driveError(aborted.kit.request(healthReq({ signal: ac.signal })))).toBeInstanceOf(
      AbortedError,
    );
  });

  it('an in-process Response.error() is a socket error: network, retried to 3 attempts', async () => {
    const { kit, budget } = makeKit({ inProcessHosts: { 'fixture.local': async () => Response.error() } });
    expect(await driveError(kit.request(healthReq()))).toMatchObject({
      kind: 'network',
      retryable: true,
      message: expect.stringContaining('[socket]'),
    });
    expect(budget.sequence()).toEqual([
      'reserve',
      'finalise:error',
      'reserve',
      'finalise:error',
      'reserve',
      'finalise:error',
    ]);
  });

  it('egress still applies: a provider whose allowlist lacks fixture.local cannot reach it in process', async () => {
    const { kit, budget } = makeKit({ inProcessHosts: { 'fixture.local': async () => Response.json({}) } });
    expect(await driveError(kit.request(healthReq({ providerId: 'searchapi' })))).toMatchObject({
      message: expect.stringContaining('[egress-denied]'),
    });
    expect(budget.reserveCalls).toBe(0);
  });
});

describe('createHttpKit construction checks (ruling 7, sec-003)', () => {
  it('refuses an in-process host other than fixture.local', () => {
    expect(() => makeKit({ inProcessHosts: { 'www.searchapi.io': async () => Response.json({}) } })).toThrow(
      /fixture\.local/,
    );
  });
  it('refuses inProcessHosts or limits.fixture unless syntheticAllowed is true', () => {
    expect(() =>
      makeKit({
        syntheticAllowed: false,
        inProcessHosts: { 'fixture.local': async () => Response.json({}) },
      }),
    ).toThrow(/syntheticAllowed/);
    expect(() => makeKit({ syntheticAllowed: false })).toThrow(/syntheticAllowed/);
    const limits = testLimits();
    expect(() =>
      makeKit({ syntheticAllowed: false, limits: { searchapi: limits.searchapi, fx: limits.fx } }),
    ).not.toThrow();
  });
  it('refuses a configured secret shorter than 8 characters', () => {
    expect(() => makeKit({ secrets: [new Secret('short')] })).toThrow(/at least 8/);
  });
  it('refuses an empty secrets list when a real provider is configured, and allows it for fixture/fx only', () => {
    expect(() => makeKit({ secrets: [] })).toThrow(/secrets/);
    expect(() => makeKit({ secrets: [new Secret('')] })).toThrow(/secrets/);
    const limits = testLimits();
    expect(() => makeKit({ secrets: [], limits: { fixture: limits.fixture, fx: limits.fx } })).not.toThrow();
  });
});

describe('body failures and redirects, driven in process (cost-001, arch-r2-005)', () => {
  beforeEach(useFakeTime);
  afterEach(() => vi.useRealTimers());

  const brokenBody = () =>
    new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode('{"calendar": ['));
        c.error(new Error('connection reset'));
      },
    });

  // why: msw rejects the fetch itself when a mocked body stream errors, so a failure after the status line is driven
  // through the in-process seam, which hands the stream to the reader untouched (arch-r2-005).
  const fixtureBody = (billable: 'http-200' | 'never') =>
    makeKit({
      overrides: { fixture: { billable } },
      inProcessHosts: { 'fixture.local': async () => new Response(brokenBody(), { status: 200 }) },
    });
  const fixtureReq = () => req({ url: 'http://fixture.local/calendar', providerId: 'fixture', headers: {} });

  it('a body that fails after a billed 200 status → finalised unknown with status 200, non-retryable (cost-001)', async () => {
    const { kit, budget, events } = fixtureBody('http-200');
    expect(await driveError(kit.request(fixtureReq()))).toMatchObject({
      kind: 'network',
      retryable: false,
      message: expect.stringContaining('[body-read-failed]'),
    });
    expect(budget.sequence()).toEqual(['reserve', 'finalise:unknown']);
    expect(finals(events)[0]?.httpStatus).toBe(200);
  });

  it('the same failure on a free vendor → finalised error with the status, retried', async () => {
    const { kit, events } = fixtureBody('never');
    expect(await driveError(kit.request(fixtureReq()))).toMatchObject({ kind: 'network', retryable: true });
    expect(finals(events).map((e) => [e.outcome, e.httpStatus])).toEqual([
      ['error', 200],
      ['error', 200],
      ['error', 200],
    ]);
  });

  // why: msw 3 follows a mocked 3xx itself with the real fetch, whatever the request's redirect mode, so a mocked 302
  // would reach the network (seen in a scratch run); the redirect rule is proven here and by the classifyThrown case in
  // errors.test.ts, none of which leaves the process.
  it('a 3xx answer is refused: one attempt, finalised error with the status, nothing followed', async () => {
    let calls = 0;
    const { kit, budget } = makeKit({
      inProcessHosts: {
        'fixture.local': async () => {
          calls += 1;
          return new Response(null, { status: 302, headers: { location: 'https://evil.example/steal' } });
        },
      },
    });
    const r = req({ url: 'http://fixture.local/calendar', providerId: 'fixture', headers: {} });
    expect(await driveError(kit.request(r))).toMatchObject({
      kind: 'upstream',
      retryable: false,
      httpStatus: 302,
      message: expect.stringContaining('[redirect-refused]'),
    });
    expect(calls).toBe(1);
    expect(budget.sequence()).toEqual(['reserve', 'finalise:error']);
  });

  it("every request is built with redirect: 'error' (the same init goes to fetch and to the in-process seam)", async () => {
    const seen: string[] = [];
    const { kit } = makeKit({
      inProcessHosts: {
        'fixture.local': async (r) => {
          seen.push(r.redirect);
          return Response.json({ synthetic: true, ok: true });
        },
      },
    });
    await drive(kit.request(req({ url: 'http://fixture.local/health', providerId: 'fixture', headers: {} })));
    expect(seen).toEqual(['error']);
  });
});
