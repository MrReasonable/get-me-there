import { billingMonthWindow, fixedClock, isoDateTimeOfEpochMs, parseConfig } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { MONTH_WINDOW_SQL, monthWindow } from '../src/budget/window.js';
import { budgetConfigFromConfig, effectiveCallCap } from '../src/budgetConfig.js';
import { SqliteBudgetGuard } from '../src/budgetGuard.js';
import { at, freshDb, T0 } from './helpers/db.js';
import { budgetConfig, limits } from './helpers/factories.js';

describe('budget windows (spec §7 "Budget windows")', () => {
  it.each([
    ['2026-10-14T12:00:00.000Z', 1, '2026-10-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z'],
    ['2026-10-14T12:00:00.000Z', 15, '2026-09-15T00:00:00.000Z', '2026-10-15T00:00:00.000Z'],
    ['2026-10-15T00:00:00.000Z', 15, '2026-10-15T00:00:00.000Z', '2026-11-15T00:00:00.000Z'],
    ['2026-10-14T23:59:59.999Z', 15, '2026-09-15T00:00:00.000Z', '2026-10-15T00:00:00.000Z'],
    ['2027-01-03T08:00:00.000Z', 28, '2026-12-28T00:00:00.000Z', '2027-01-28T00:00:00.000Z'],
    ['2028-02-29T10:00:00.000Z', 28, '2028-02-28T00:00:00.000Z', '2028-03-28T00:00:00.000Z'],
    ['2027-03-01T00:00:00.000Z', 28, '2027-02-28T00:00:00.000Z', '2027-03-28T00:00:00.000Z'],
  ])('now %s, billing day %i → [%s, %s)', (now, day, start, end) => {
    expect(monthWindow(freshDb(), at(now), day)).toEqual({ windowStart: start, windowEnd: end });
  });

  it('agrees with core’s billingMonthWindow, the worker’s window (decision 82), over 2,800 sampled instants and every billing day', () => {
    const db = freshDb();
    // why: a seeded generator, so the sweep is the same on every run; instants from 2026 to 2030, every millisecond
    // equally likely, with the billing-day midnights themselves mixed in
    let seed = 0x5eed;
    const next = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed / 2_147_483_648;
    };
    const from = Date.parse('2026-01-01T00:00:00.000Z');
    const span = Date.parse('2031-01-01T00:00:00.000Z') - from;
    let checked = 0;
    for (let day = 1; day <= 28; day++)
      for (let i = 0; i < 100; i++) {
        const ms = Math.floor(from + next() * span);
        const d = new Date(ms);
        const now = isoDateTimeOfEpochMs(
          i % 10 === 0 ? Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), day) : ms,
        );
        expect(billingMonthWindow(now, day), `${now} day ${day}`).toEqual(monthWindow(db, now, day));
        checked++;
      }
    expect(checked).toBe(2800);
  });

  it('rejects billing days outside 1–28; the SQL is parameterised', () => {
    const db = freshDb();
    expect(() => monthWindow(db, T0, 0)).toThrow();
    expect(() => monthWindow(db, T0, 29)).toThrow(RangeError);
    expect(MONTH_WINDOW_SQL).toContain('@billingDay');
  });

  it('rows at the window edges: start inclusive, end exclusive, in provider and global scopes', () => {
    const db = freshDb();
    const insert = db.raw.prepare(
      `INSERT INTO provider_requests (provider_id, endpoint_path, started_at, outcome, billable, cost_micro_gbp, http_attempt) VALUES ('searchapi', '/s', ?, 'ok', 1, 0, 1)`,
    );
    for (const t of [
      '2026-09-14T23:59:59.999Z',
      '2026-09-15T00:00:00.000Z',
      '2026-10-14T23:59:59.999Z',
      '2026-10-15T00:00:00.000Z',
    ])
      insert.run(t);
    const guard = new SqliteBudgetGuard(
      db,
      budgetConfig({ searchapi: limits({ billingDay: 15, monthlyCallCap: 10 }) }, { globalBillingDay: 15 }),
      fixedClock(at('2026-10-14T12:00:00.000Z')),
    );
    expect(guard.usage({ kind: 'provider-month', providerId: 'searchapi' })).toEqual({
      calls: 2,
      costMicroGbp: 0,
      cap: 10,
      windowUsed: true,
      windowStart: '2026-09-15T00:00:00.000Z',
      windowEnd: '2026-10-15T00:00:00.000Z',
    });
    expect(guard.usage({ kind: 'global-month' })).toMatchObject({
      calls: 2,
      windowStart: '2026-09-15T00:00:00.000Z',
    });
  });
});

describe('an unused window is marked, never reported as "no cap" (ruling 2, decision 67)', () => {
  it.each([
    ['month', 'provider-month', 'provider-lifetime'],
    ['lifetime', 'provider-lifetime', 'provider-month'],
  ] as const)('a %s plan: %s is used and capped, %s is unused', (window, used, unused) => {
    const guard = new SqliteBudgetGuard(
      freshDb(),
      budgetConfig({ searchapi: limits({ window, monthlyCallCap: 24 }) }),
      fixedClock(T0),
    );
    expect(guard.usage({ kind: used, providerId: 'searchapi' })).toMatchObject({ cap: 24, windowUsed: true });
    expect(guard.usage({ kind: unused, providerId: 'searchapi' })).toMatchObject({
      cap: null,
      windowUsed: false,
    });
    expect(guard.usage({ kind: 'global-month' }).windowUsed).toBe(true);
  });
});

describe('budgetConfigFromConfig (spec §12 presets)', () => {
  const base = { NODE_ENV: 'test', DATABASE_PATH: ':memory:', BIND_ADDRESS: '127.0.0.1' };
  const parse = (env: Record<string, string>) => {
    const r = parseConfig(env, { realpath: (p) => p });
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    return r.config;
  };

  it('40usd: fee, billing day and rate carried, billable; travelpayouts never billable; spend passed through', () => {
    const c = parse({
      ...base,
      SEARCHAPI_KEY: 'test-searchapi-key-0123456789abcdef',
      SEARCHAPI_PLAN: '40usd',
      SEARCHAPI_BILLING_DAY: '15',
      TRAVELPAYOUTS_TOKEN: 'test-travelpayouts-token-0123456789',
    });
    const b = budgetConfigFromConfig(c);
    expect(b.providers.searchapi).toMatchObject({
      billable: true,
      window: 'month',
      billingDay: 15,
      monthlyCallCap: 10_000,
      planFixedMicroGbp: 32_000_000,
      costPerCallMicroGbp: 0,
      trialUsed: 0,
    });
    expect(b.providers.travelpayouts).toMatchObject({
      billable: false,
      monthlyCallCap: 50_000,
      costPerCallMicroGbp: 0,
      trialUsed: 0,
    });
    expect(b.spend).toEqual(c.spend);
    expect(Object.keys(b)).toEqual(['providers', 'spend']); // ruling 6: no fixtureCostMicroGbp
  });

  it('trial: lifetime window carrying SEARCHAPI_TRIAL_USED; the effective cap is the allowance left', () => {
    const b = budgetConfigFromConfig(
      parse({ ...base, SEARCHAPI_KEY: 'test-searchapi-key-0123456789abcdef', SEARCHAPI_TRIAL_USED: '9' }),
    );
    expect(b.providers.searchapi).toMatchObject({
      window: 'lifetime',
      monthlyCallCap: 100,
      trialUsed: 9,
      billable: true,
    });
    const over = budgetConfigFromConfig(
      parse({ ...base, SEARCHAPI_KEY: 'test-searchapi-key-0123456789abcdef', SEARCHAPI_TRIAL_USED: '150' }),
    ).providers.searchapi;
    if (over === undefined) throw new Error('fixture');
    expect(effectiveCallCap(over)).toBe(0);
    expect(effectiveCallCap(limits({ window: 'month', monthlyCallCap: 10, trialUsed: 9 }))).toBe(10); // monthly windows ignore it
  });

  it('fixture appears only under syntheticAllowed, billable at the configured test rate', () => {
    expect(
      budgetConfigFromConfig(parse({ ...base, FIXTURE_COST_MICRO_GBP: '3200' })).providers.fixture,
    ).toMatchObject({ billable: true, costPerCallMicroGbp: 3200 });
    expect(
      budgetConfigFromConfig(
        parse({ ...base, NODE_ENV: 'production', DATABASE_PATH: '/data/get-me-there.db' }),
      ).providers.fixture,
    ).toBeUndefined();
  });

  it('the fixture entry’s invented limits never reach the ledger: a row carries only the configured test rate (arch-M5)', () => {
    const b = budgetConfigFromConfig(
      parse({ ...base, FIXTURE_COST_MICRO_GBP: '3200', MONTHLY_SPEND_CAP_PENCE: '100' }),
    );
    const db = freshDb();
    const guard = new SqliteBudgetGuard(db, b, fixedClock(T0));
    const call = {
      providerId: 'fixture',
      executionId: null,
      tileIndex: 0,
      httpAttempt: 1,
      endpointPath: '/fixture',
    } as const;
    guard
      .reserve({ ...call, costMicroGbp: 3200 })
      .finalise({ outcome: 'ok', httpStatus: 200, durationMs: 1 });
    expect(() => guard.reserve({ ...call, costMicroGbp: 0 })).toThrow(/3200/);
    expect(
      db.raw.prepare('SELECT provider_id, cost_micro_gbp, billable FROM provider_requests').all(),
    ).toEqual([{ provider_id: 'fixture', cost_micro_gbp: 3200, billable: 1 }]);
  });
});
