import { asIsoDate, asIsoDateTime, fixedClock } from '@gmt/core';
import { MIGRATIONS_DIR } from '@gmt/db';
import * as engine from '@gmt/engine';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { engineFor } from '../../src/bootstrap/engine.js';
import { buildPorts, loadConfigFromEnv } from '../../src/wiring.js';
import { SENTINEL_SMTP, silentLog, testEnv } from '../helpers/env.js';
import { exampleDefinitionInput, JFK, LHR } from '../helpers/examples.js';
import { createHarness } from '../helpers/harness.js';
import { at, cell, seeder } from '../helpers/seed.js';
import { onCleanup } from '../helpers/tmp.js';

function ports(extra: Record<string, string> = {}) {
  const p = buildPorts(loadConfigFromEnv(testEnv(extra)), {
    log: silentLog,
    clock: fixedClock(asIsoDateTime('2026-10-20T09:00:00.000Z')),
    migrationsDir: MIGRATIONS_DIR,
  });
  onCleanup(() => p.db.close());
  return p;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('engineFor: the production engine wiring (spec §8.1, §8.3; review TS-6)', () => {
  it('passes WP11 runAlerts as the alerts step and the log notifier alone without SMTP', () => {
    const spy = vi.spyOn(engine, 'createEngine');
    engineFor(ports(), silentLog);
    expect(spy).toHaveBeenCalledTimes(1);
    const [deps, opts] = spy.mock.calls[0] ?? [];
    expect(opts?.alerts).toBe(engine.runAlerts);
    expect(deps?.notifiers.map((n) => n.id)).toEqual(['log']);
  });

  it('adds the EmailNotifier when SMTP_* is configured', () => {
    const spy = vi.spyOn(engine, 'createEngine');
    engineFor(
      ports({
        SMTP_HOST: 'smtp.example.com',
        SMTP_PORT: '465',
        SMTP_USER: 'alerts',
        SMTP_PASS: SENTINEL_SMTP,
        ALERT_EMAIL_TO: 'operator@example.com',
        ALERT_EMAIL_FROM: 'get-me-there@example.com',
      }),
      silentLog,
    );
    expect(spy.mock.calls[0]?.[0].notifiers.map((n) => n.id)).toEqual(['log', 'email']);
  });
});

describe('engineFor: the consent check (spec §8.3 consent expiry)', () => {
  it('passes the Status view consent check to the engine; it reads off while the browser provider is not enabled', async () => {
    const spy = vi.spyOn(engine, 'createEngine');
    engineFor(ports(), silentLog, { home: null });
    const check = spy.mock.calls[0]?.[1]?.consentCheck;
    expect(check).toBeDefined();
    expect(await check?.()).toEqual({
      state: 'off',
      cause: 'none',
      summary: 'browser provider not enabled',
      fix: null,
    });
  });
  it('uses the notifiers it is given', () => {
    const spy = vi.spyOn(engine, 'createEngine');
    const own = { id: 'own', send: async () => ({ ok: true }) };
    engineFor(ports(), silentLog, { notifiers: [own] });
    expect(spy.mock.calls[0]?.[0].notifiers).toEqual([own]);
  });
});

// Spec revision 55 §8.1 (WP20 Task 20.9 review finding 11): the app's engine is given the board's ranking, which the
// flight-list step and the on-demand read both read (EngineContext.rankedDatePairs). Without it the read finds no
// figure (`no_price`); with it the same pair is judged on its newest list (`fresh`).
describe('engineFor: the ranking for the flight lists (spec rev 55 §8.1)', () => {
  it('passes rankedDatePairs, so the on-demand read finds the figure the board ranks', async () => {
    const h = await createHarness({
      env: {
        CAMOUFOX_ENABLED: 'true',
        CAMOUFOX_WORKER_URL: 'http://127.0.0.1:8090',
        CAMOUFOX_WORKER_KEY: 'test-worker-key-0123456789abcdef0123456789abcdef',
      },
    });
    const one = cell(LHR, JFK, '2026-11-02', '2026-11-12');
    const def = h.ports.repos.definitions.create(
      exampleDefinitionInput({
        window: { kind: 'absolute', from: asIsoDate('2026-11-02'), to: asIsoDate('2026-11-02') },
        minNights: 10,
        maxNights: 10,
        providers: { discovery: ['fixture', 'camoufox'], verification: [], discoveryRefreshHours: {} },
      }),
    );
    const s = seeder(h.ports);
    s.execution('E', { def, status: 'completed', startedAt: at(-2), finishedAt: at(-1) });
    s.cells('E', [one]);
    s.tile('E', one, { status: 'priced', fetchedAt: at(-2) });
    h.ports.repos.flightLists.insert({
      definitionId: def.id,
      executionId: null,
      providerId: 'camoufox',
      sourceKind: 'scraped-self',
      cabin: 'economy',
      ...one,
      fetchedAt: at(-1),
      pointOfSale: 'GB',
      status: 'read',
      reason: null,
      listed: 'no-flights',
      minMinor: null,
      tabMinor: null,
      cheapestView: null,
      optionsUnparsed: 0,
      optionsOtherCell: 0,
      resultsStated: null,
      flights: [],
    });
    const spy = vi.spyOn(engine, 'createEngine');
    const app = engineFor(h.ports, silentLog);
    const reader = spy.mock.calls[0]?.[1]?.rankedDatePairs;
    expect(reader).toBeDefined();
    const pair = { departureDate: one.departureDate, returnDate: one.returnDate };
    // why: the harness's own engine is built without the ranking; the app's engine is built by engineFor
    expect(await h.engine.readFlightList(def.id, pair)).toEqual({ ok: false, code: 'no_price' });
    // why: the worker's flags read (none verified), so the young outbound-only list is fresh; with them unread it is
    // read again (21.6 re-review N2)
    app.setWorkerFlags('camoufox', {});
    expect(await app.readFlightList(def.id, pair)).toEqual({ ok: false, code: 'fresh' });
    await app.shutdown();
  });
});
