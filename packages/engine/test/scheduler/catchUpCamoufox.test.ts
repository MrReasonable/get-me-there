// A catch-up never loads browser pages (spec §8.2 rev 36; decision 79; WP16a Task 16a.2): it keeps the camoufox
// provider for reuse only, its other camoufox cells are skipped:scheduled_only (catch-up-no-browser), no resume ever
// runs them, and the next scheduled run fetches them. A browser-only definition's missed firing is recorded once.
// Stub providers through the real engine and budget guard; London Heathrow → New York JFK only.
import { asIsoDateTime, ProviderError } from '@gmt/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEngine } from '../../src/index.js';
import { catchUpAll, catchUpDefinition } from '../../src/scheduler/catchUp.js';
import {
  type CamoufoxEngine,
  engineWith,
  outcomes,
  stubCamoufox,
  stubSearchApiVerification,
  stubTravelpayouts,
} from '../support/camoufox.js';
import { frankfurterBody, stubFrankfurter } from '../support/fx.js';

beforeEach(() => {
  expect.hasAssertions();
});
afterEach(() => {
  vi.useRealTimers();
});

const at = asIsoDateTime;
/** Four departure days a week ahead, 10 nights each: four cells, one camoufox page each. */
const WINDOW = { kind: 'relative', startOffsetDays: 7, lengthDays: 4 } as const;
const F1 = at('2027-03-01T06:00:00.000Z');
const upstream = () =>
  new ProviderError({
    kind: 'upstream',
    retryable: true,
    providerId: 'camoufox',
    message: 'the page did not settle',
  });
const rows = (e: CamoufoxEngine) =>
  e.ctx.repos.executions.listForDefinition(e.definition.id, { limit: 100, includeChildren: false });

describe('a catch-up keeps camoufox for reuse only (decision 79)', () => {
  it('copies fresh camoufox outcomes with no page load, leaves the rest scheduled_only, runs Travelpayouts; no resume loads a page; the next scheduled run fetches them', async () => {
    const camoufox = stubCamoufox({ cells: 4, failTile: 2, error: upstream() });
    const travelpayouts = stubTravelpayouts({ cells: 4 });
    const e = engineWith([camoufox, travelpayouts], {
      scheduleCron: '0 6 * * *',
      window: WINDOW,
      createdAt: at('2027-03-01T00:00:00.000Z'),
    });
    // why: Travelpayouts' prices age out within the hour, so the catch-up has to fetch its cells again
    e.ctx.repos.definitions.update(e.definition.id, {
      providers: { ...e.definition.providers, discoveryRefreshHours: { camoufox: 168, travelpayouts: 1 } },
    });
    e.clock.set(at('2027-03-01T02:00:00.000Z'));
    const first = await e.runToEnd();
    expect(outcomes(e, first.id, 'camoufox').map((o) => o.status)).toEqual([
      'priced',
      'priced',
      'error',
      'priced',
    ]);
    const pages = camoufox.calls.length;
    const camoufoxLedger = e.ledgerRows('camoufox').length;
    const tpCalls = travelpayouts.calls.length;

    e.clock.set(at('2027-03-01T08:00:00.000Z'));
    const def = e.ctx.repos.definitions.get(e.definition.id);
    if (def === null) throw new Error('no definition');
    expect(await catchUpDefinition(e.ctx, e.orch, def, e.clock.now())).toEqual({
      kind: 'catch-up',
      firing: F1,
    });
    const catchUp = rows(e).find((x) => x.isCatchUp);
    if (catchUp === undefined) throw new Error('no catch-up');
    expect(await e.settled(catchUp.id)).toMatchObject({ status: 'completed', scheduledFor: F1 });
    expect(
      outcomes(e, catchUp.id, 'camoufox').map((o) => [
        o.status,
        o.reason,
        o.skipDetail,
        o.reusedFromExecutionId,
      ]),
    ).toEqual([
      ['priced', null, null, first.id],
      ['priced', null, null, first.id],
      ['skipped', 'scheduled_only', 'catch-up-no-browser', null],
      ['priced', null, null, first.id],
    ]);
    expect(camoufox.calls).toHaveLength(pages);
    expect(e.ledgerRows('camoufox')).toHaveLength(camoufoxLedger);
    expect(travelpayouts.calls.length).toBeGreaterThan(tpCalls);
    expect(
      outcomes(e, catchUp.id, 'travelpayouts').every(
        (o) => o.status === 'priced' && o.reusedFromExecutionId === null,
      ),
    ).toBe(true);
    // the catch-up's estimate plans no camoufox page
    expect(catchUp.estimate?.perProvider.map((p) => p.providerId)).toEqual(['travelpayouts']);

    // a manual resume of a paused catch-up, an automatic resume and a boot resume each load no page
    e.ctx.repos.executions.setStatus(catchUp.id, 'paused_error');
    await e.resume(catchUp.id, { manual: true });
    e.ctx.repos.executions.setStatus(catchUp.id, 'interrupted');
    await e.resume(catchUp.id, { manual: false });
    e.ctx.repos.executions.setStatus(catchUp.id, 'interrupted');
    const booted = createEngine(e.deps);
    await booted.boot();
    await e.settled(catchUp.id);
    await booted.shutdown();
    expect(camoufox.calls).toHaveLength(pages);
    expect(outcomes(e, catchUp.id, 'camoufox')[2]).toMatchObject({
      status: 'skipped',
      reason: 'scheduled_only',
    });

    // the next scheduled run (its live tick, punctual) fetches the cell the catch-up left
    e.clock.set(at('2027-03-02T06:00:00.000Z'));
    await e.tick();
    const next = rows(e).find((x) => x.scheduledFor === '2027-03-02T06:00:00.000Z');
    if (next === undefined) throw new Error('no scheduled run');
    await e.settled(next.id);
    // why: the relative window moved on a day, so the run fetches the cell the catch-up left (10 Mar) and the new day
    // (12 Mar), and copies the two still-fresh ones
    expect(camoufox.calls.slice(pages).map((t) => t.coveredCells.map((c) => c.departureDate))).toEqual([
      ['2027-03-10'],
      ['2027-03-12'],
    ]);
    expect(
      outcomes(e, next.id, 'camoufox').map((o) => [
        o.departureDate,
        o.status,
        o.reusedFromExecutionId === null,
      ]),
    ).toEqual([
      ['2027-03-09', 'priced', false],
      ['2027-03-10', 'priced', true],
      ['2027-03-11', 'priced', false],
      ['2027-03-12', 'priced', true],
    ]);
  });

  it('positive control: a punctual live tick’s run plans its camoufox cells as not_run and fetches them', async () => {
    const camoufox = stubCamoufox({ cells: 4 });
    const e = engineWith([camoufox, stubTravelpayouts({ cells: 4 })], {
      scheduleCron: '0 6 * * *',
      window: WINDOW,
      createdAt: at('2027-03-01T00:00:00.000Z'),
    });
    e.clock.set(F1);
    await e.tick();
    const [run] = rows(e);
    if (run === undefined) throw new Error('no run');
    await e.settled(run.id);
    expect(run).toMatchObject({ scheduledFor: F1, isCatchUp: false });
    expect(camoufox.calls).toHaveLength(4);
    expect(outcomes(e, run.id, 'camoufox').map((o) => o.status)).toEqual([
      'priced',
      'priced',
      'priced',
      'priced',
    ]);
  });
});

describe('a browser-only definition’s missed firing (decision 79)', () => {
  it.each([
    ['without verification', false],
    ['with SearchApi verification configured', true],
  ])(
    '%s: one skipped_missed row with skip_code browser-only-definition, one notice, no run, no ledger row, across five minute-job ticks',
    async (_label, verify) => {
      const camoufox = stubCamoufox({ cells: 4 });
      const e = engineWith(verify ? [camoufox, stubSearchApiVerification()] : [camoufox], {
        scheduleCron: '0 6 * * *',
        window: WINDOW,
        createdAt: at('2027-03-01T00:00:00.000Z'),
        ...(verify
          ? {
              verification: ['searchapi'],
              env: { SEARCHAPI_KEY: 'test-searchapi-key-0123456789abcdef', SEARCHAPI_PLAN: '40usd' },
            }
          : {}),
      });
      for (let m = 0; m < 5; m++) {
        e.clock.set(at(new Date(Date.parse('2027-03-01T08:00:00.000Z') + m * 60_000).toISOString()));
        await catchUpAll(e.ctx, e.orch);
      }
      expect(rows(e).map((x) => [x.status, x.scheduledFor, x.skipCode])).toEqual([
        ['skipped_missed', F1, 'browser-only-definition'],
      ]);
      expect(e.notifications.map((n) => n.kind)).toEqual(['skipped_missed']);
      expect(e.notifications[0]?.body).toContain(
        'was not caught up: only the browser provider could run it, and a catch-up loads no browser pages.',
      );
      expect(camoufox.calls).toEqual([]);
      expect(e.ledgerRows('camoufox')).toEqual([]);
    },
  );
});

describe('the late tick through croner (fake timers; the engine reads the faked system time)', () => {
  it('registered, asleep 6 h past a firing, then 30 s: exactly one catch-up, its camoufox cells scheduled_only, no page', {
    timeout: 30_000,
  }, async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    const camoufox = stubCamoufox({ cells: 4 });
    const e = engineWith([camoufox, stubTravelpayouts({ cells: 4 })], {
      scheduleCron: '0 6 * * *',
      window: WINDOW,
      systemClock: true,
      createdAt: at('2027-03-01T00:00:00.000Z'),
      now: at('2027-03-01T05:59:00.000Z'),
    });
    stubFrankfurter(() => Response.json(frankfurterBody({ EUR: 1.15, USD: 1.27 })));
    const engine = createEngine(e.deps);
    await engine.boot();
    vi.setSystemTime(new Date('2027-03-01T12:00:00.000Z'));
    await vi.advanceTimersByTimeAsync(30_000);
    await vi.advanceTimersByTimeAsync(60_000);
    const [run, ...rest] = rows(e);
    expect(rest).toEqual([]);
    if (run === undefined) throw new Error('no catch-up');
    expect(run).toMatchObject({ scheduledFor: F1, isCatchUp: true });
    await e.settled(run.id);
    expect(outcomes(e, run.id, 'camoufox').map((o) => [o.reason, o.skipDetail])).toEqual(
      Array(4).fill(['scheduled_only', 'catch-up-no-browser']),
    );
    expect(camoufox.calls).toEqual([]);
    await engine.shutdown();
  });
});
