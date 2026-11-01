// Spec revision 55 §10 (sec-001): the cards, create-and-start, restore and flight-lists routes sit behind the auth gate
// like every route; the POSTs need X-Requested-With; the cards and the flight lists carry no error_text, key, password
// or path (the redaction sweep), a flight list's `reason` being one STOP_DETAILS word only.
import { randomUUID } from 'node:crypto';
import { asIsoDate } from '@gmt/core';
import { afterEach, describe, expect, it } from 'vitest';
import { SENTINEL_AUTH } from '../helpers/env.js';
import { exampleDefinitionInput, JFK, LHR, SMALL_WINDOW } from '../helpers/examples.js';
import { createHarness, type Harness } from '../helpers/harness.js';
import { at, seeder } from '../helpers/seed.js';

let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});

const ROUTES = [
  { method: 'GET', path: '/api/definitions/cards' },
  { method: 'POST', path: '/api/definitions/create-and-start' },
  { method: 'POST', path: '/api/definitions/some-id/restore' },
  // why: spec revision 55 §10 (Task 20.9): the flight-lists routes sit behind the same gate
  { method: 'GET', path: '/api/definitions/some-id/flight-lists?pairs=2026-11-02_2026-11-12' },
  { method: 'POST', path: '/api/definitions/some-id/flight-lists' },
] as const;

describe('the new routes behind the gate (revision 55 §10, sec-001)', () => {
  it.each(ROUTES)('$method $path answers 401 without credentials', async ({ method, path }) => {
    h = await createHarness();
    const r = await h.request(path, { method, auth: false, ...(method === 'POST' ? { json: {} } : {}) });
    expect(r.status).toBe(401);
  });

  it.each(ROUTES.filter((r) => r.method === 'POST'))(
    '$method $path answers 403 without X-Requested-With',
    async ({ method, path }) => {
      h = await createHarness();
      const r = await h.request(path, {
        method,
        body: JSON.stringify({ requestKey: randomUUID() }),
        headers: { 'content-type': 'application/json' },
        csrf: false,
      });
      expect(r.status).toBe(403);
    },
  );

  it('the cards carry no error_text, key, password or path', async () => {
    h = await createHarness();
    const x = h;
    const def = x.ports.repos.definitions.create(exampleDefinitionInput({ window: SMALL_WINDOW }));
    const s = seeder(x.ports);
    s.execution('E', { def, status: 'paused_error', startedAt: at(-1) });
    x.ports.repos.executions.patch(s.id('E'), {
      errorText: `worker said test-worker-key-0123456789abcdef0123456789abcdef at /home/operator/.local/state/db`,
    });
    const text = await (await x.request('/api/definitions/cards')).text();
    for (const leak of [
      'test-worker-key',
      SENTINEL_AUTH,
      '/home/operator',
      'errorText',
      'error_text',
      'worker said',
    ])
      expect(text).not.toContain(leak);
  });

  it('the flight lists carry no key, password, path or free text: a failed list reason is one word', async () => {
    h = await createHarness({
      env: {
        CAMOUFOX_ENABLED: 'true',
        CAMOUFOX_WORKER_URL: 'http://127.0.0.1:8090',
        CAMOUFOX_WORKER_KEY: 'test-worker-key-0123456789abcdef0123456789abcdef',
      },
    });
    const x = h;
    const def = x.ports.repos.definitions.create(
      exampleDefinitionInput({
        window: SMALL_WINDOW,
        minNights: 1,
        maxNights: 1,
        providers: { discovery: ['fixture', 'camoufox'], verification: [], discoveryRefreshHours: {} },
      }),
    );
    x.ports.repos.flightLists.insert({
      definitionId: def.id,
      executionId: null,
      providerId: 'camoufox',
      sourceKind: 'scraped-self',
      cabin: 'economy',
      origin: LHR,
      destination: JFK,
      departureDate: SMALL_WINDOW.from,
      returnDate: asIsoDate('2026-11-03'),
      fetchedAt: at(-1),
      pointOfSale: 'GB',
      status: 'failed',
      reason: 'provider-unavailable',
      listed: null,
      minMinor: null,
      tabMinor: null,
      cheapestView: null,
      optionsUnparsed: 0,
      optionsOtherCell: 0,
      resultsStated: null,
      flights: [],
    });
    const res = await x.request(`/api/definitions/${def.id}/flight-lists?pairs=2026-11-02_2026-11-03`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('"reason":"provider-unavailable"');
    for (const leak of [
      'test-worker-key',
      SENTINEL_AUTH,
      '/home/',
      'errorText',
      'error_text',
      'lastError',
      '127.0.0.1',
    ])
      expect(text).not.toContain(leak);
  });
});
