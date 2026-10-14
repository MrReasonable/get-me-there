import { asIsoDate, fixedClock } from '@gmt/core';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import type { Db } from '../src/client.js';
import { CalendarPricesRepo } from '../src/repositories/calendarPrices.js';
import { ExecutionsRepo } from '../src/repositories/executions.js';
import { at, count, freshDb, sqliteCode, T0 } from './helpers/db.js';
import { calendarPrice, cell, newExecution } from './helpers/factories.js';

function setup(allowSynthetic = false) {
  const db = freshDb();
  const clock = fixedClock(T0);
  const { execution } = newExecution(db, clock);
  return {
    db,
    clock,
    executionId: execution.id,
    repo: new CalendarPricesRepo(db, clock, { allowSynthetic }),
  };
}

/** Raw insert bypassing the repository, to prove the SQL constraints hold on their own. */
function rawInsert(db: Db, executionId: string, over: Record<string, unknown>): void {
  const row = {
    execution_id: executionId,
    provider_id: 'travelpayouts',
    source_kind: 'authorised-cached',
    cabin: 'economy',
    origin: 'LHR',
    destination: 'JFK',
    departure_date: '2027-03-14',
    return_date: '2027-03-28',
    price_pence: 41_200,
    price_native_minor: 41_200,
    currency_native: 'GBP',
    fx_rate_nano: null,
    fx_rate_date: null,
    fx_source: null,
    fx_converted: 0,
    point_of_sale: 'unknown',
    fetched_at: T0,
    ...over,
  };
  const cols = Object.keys(row);
  db.raw
    .prepare(
      `INSERT INTO calendar_prices (${cols.join(', ')}) VALUES (${cols.map((c) => `@${c}`).join(', ')})`,
    )
    .run(row);
}

describe('calendar_prices writes (spec §5.5, §6.3, §7)', () => {
  it('stores provenance explicitly and reads it back: max_age_hours NULL ⇔ unknown, FX columns when converted', () => {
    const { repo, executionId } = setup();
    const converted = calendarPrice(cell(undefined, undefined, '2027-03-15', '2027-03-29'), {
      providerId: 'searchapi',
      sourceKind: 'scraped-aggregate',
      maxAgeHours: null,
      pointOfSale: 'GB',
      currencyNative: 'USD',
      priceNativeMinor: 54_900,
      pricePence: 41_175,
      fx: {
        converted: true,
        rateNano: 750_000_000,
        rateDate: asIsoDate('2026-10-13'),
        source: 'frankfurter',
      },
      providerObservedAt: at('2026-10-14T11:00:00.000Z'),
    });
    const ids = repo.insert(executionId, [calendarPrice(cell()), converted]);
    expect(ids).toHaveLength(2);
    const [first, second] = repo.fetchedBy(executionId);
    expect(first).toMatchObject({
      id: ids[0],
      executionId,
      maxAgeHours: 48,
      provenance: {
        providerId: 'travelpayouts',
        sourceKind: 'authorised-cached',
        fetchedAt: T0,
        maxAgeHours: 48,
        fx: { converted: false },
        pointOfSale: 'unknown',
        cabin: 'economy',
      },
    });
    expect(first?.provenance).not.toHaveProperty('providerObservedAt');
    expect(second).toMatchObject({
      maxAgeHours: null,
      currencyNative: 'USD',
      provenance: {
        maxAgeHours: 'unknown',
        providerObservedAt: '2026-10-14T11:00:00.000Z',
        fx: { converted: true, rateNano: 750_000_000, rateDate: '2026-10-13', source: 'frankfurter' },
      },
    });
  });

  it('provider ⇔ kind, both directions, in the repository and in SQL; the gate refuses fixture rows unless allowed', () => {
    const { db, repo, executionId } = setup(true);
    const write = (over: Parameters<typeof calendarPrice>[1]) => () =>
      repo.insert(executionId, [calendarPrice(cell(), over)]);
    expect(write({ providerId: 'fixture', sourceKind: 'authorised-cached' })).toThrow(
      expect.objectContaining({ rule: 'provider-kind' }),
    );
    expect(write({ providerId: 'searchapi', sourceKind: 'synthetic' })).toThrow(
      expect.objectContaining({ rule: 'provider-kind' }),
    );
    expect(
      sqliteCode(() =>
        rawInsert(db, executionId, { provider_id: 'fixture', source_kind: 'authorised-cached' }),
      ),
    ).toBe('SQLITE_CONSTRAINT_CHECK');
    expect(
      sqliteCode(() => rawInsert(db, executionId, { provider_id: 'searchapi', source_kind: 'synthetic' })),
    ).toBe('SQLITE_CONSTRAINT_CHECK');
    expect(write({ providerId: 'fixture', sourceKind: 'synthetic' })).not.toThrow();
    const closed = new CalendarPricesRepo(db, fixedClock(T0), { allowSynthetic: false });
    expect(() =>
      closed.insert(executionId, [
        calendarPrice(cell(undefined, undefined, '2027-03-20', '2027-04-03'), {
          providerId: 'fixture',
          sourceKind: 'synthetic',
        }),
      ]),
    ).toThrow(expect.objectContaining({ rule: 'synthetic-gate' }));
  });

  it('FX CHECK constraints, both directions, and price_pence = price_native_minor when unconverted', () => {
    const { db, repo, executionId } = setup();
    expect(
      sqliteCode(() =>
        rawInsert(db, executionId, {
          fx_converted: 1,
          currency_native: 'GBP',
          fx_rate_nano: 1,
          fx_rate_date: '2026-10-13',
          fx_source: 'x',
        }),
      ),
    ).toBe('SQLITE_CONSTRAINT_CHECK');
    expect(sqliteCode(() => rawInsert(db, executionId, { fx_converted: 0, currency_native: 'USD' }))).toBe(
      'SQLITE_CONSTRAINT_CHECK',
    );
    expect(
      sqliteCode(() =>
        rawInsert(db, executionId, {
          fx_converted: 1,
          currency_native: 'USD',
          fx_rate_nano: null,
          fx_rate_date: '2026-10-13',
          fx_source: 'x',
        }),
      ),
    ).toBe('SQLITE_CONSTRAINT_CHECK');
    const write = (over: Parameters<typeof calendarPrice>[1]) => () =>
      repo.insert(executionId, [calendarPrice(cell(), over)]);
    expect(write({ currencyNative: 'USD' })).toThrow(expect.objectContaining({ rule: 'fx' }));
    expect(write({ priceNativeMinor: 41_201 })).toThrow(/must equal price_native_minor/);
    expect(
      write({ fx: { converted: true, rateNano: 1, rateDate: asIsoDate('2026-10-13'), source: 'x' } }),
    ).toThrow(/GBP price cannot be FX-converted/);
  });

  it('price tables reject non-integers and non-toISOString timestamps (repository and SQL); a numeric text is stored as an integer by affinity', () => {
    const { db, repo, executionId } = setup();
    const write = (over: Parameters<typeof calendarPrice>[1]) => () =>
      repo.insert(executionId, [calendarPrice(cell(), over)]);
    expect(write({ pricePence: 412.5, priceNativeMinor: 412.5 })).toThrow(
      expect.objectContaining({ rule: 'integer' }),
    );
    // why: a non-ISO timestamp cannot reach the typed repository without a cast; the SQL CHECK below is its guard (arch-r2-006).
    expect(write({ maxAgeHours: 1.5 })).toThrow(/max_age_hours/);
    expect(write({ pointOfSale: 'gb' })).toThrow(/point_of_sale/);
    expect(write({ reusedFromExecutionId: 'someone-else' })).toThrow(
      expect.objectContaining({ rule: 'reused' }),
    );
    expect(
      sqliteCode(() => rawInsert(db, executionId, { price_pence: 412.5, price_native_minor: 412.5 })),
    ).toBe('SQLITE_CONSTRAINT_CHECK');
    expect(
      sqliteCode(() => rawInsert(db, executionId, { price_pence: 'abc', price_native_minor: 'abc' })),
    ).toBe('SQLITE_CONSTRAINT_CHECK');
    expect(sqliteCode(() => rawInsert(db, executionId, { fetched_at: '2026-10-14T12:00:00Z' }))).toBe(
      'SQLITE_CONSTRAINT_CHECK',
    );
    expect(sqliteCode(() => rawInsert(db, executionId, { fetched_at: '2026-10-14 12:00:00.000' }))).toBe(
      'SQLITE_CONSTRAINT_CHECK',
    );
    expect(count(db, 'calendar_prices')).toBe(0);
    rawInsert(db, executionId, { price_pence: '412', price_native_minor: '412' }); // test-017: INTEGER affinity stores 412, which is an integer
    expect(
      db.raw.prepare('SELECT typeof(price_pence) AS t, price_pence AS p FROM calendar_prices').get(),
    ).toEqual({ t: 'integer', p: 412 });
  });

  it('UNIQUE (execution, provider, cell): a second row for the same key throws; another provider or execution does not', () => {
    const { db, clock, repo, executionId } = setup();
    repo.insert(executionId, [calendarPrice(cell())]);
    expect(
      sqliteCode(() =>
        repo.insert(executionId, [calendarPrice(cell(), { pricePence: 40_000, priceNativeMinor: 40_000 })]),
      ),
    ).toBe('SQLITE_CONSTRAINT_UNIQUE');
    repo.insert(executionId, [
      calendarPrice(cell(), { providerId: 'searchapi', sourceKind: 'scraped-aggregate', pointOfSale: 'GB' }),
    ]);
    repo.insert(newExecution(db, clock, { status: 'completed' }).execution.id, [calendarPrice(cell())]);
    expect(count(db, 'calendar_prices')).toBe(3);
  });
});

describe('plan Review Focus 5: a SqliteError inside a repository transaction', () => {
  it('propagates with its SQLite code and message, holds no URL, and rolls the whole transaction back', () => {
    const { db, clock, repo, executionId } = setup();
    const link = 'https://www.aviasales.com/search/LON1403NYC28031?marker=SECRET-TOKEN-0123456789';
    let thrown: unknown;
    try {
      db.transaction(() => {
        repo.insert(executionId, [calendarPrice(cell(), { vendorLink: link })]);
        repo.insert(executionId, [calendarPrice(cell(), { vendorLink: link })]); // same key
      });
    } catch (e) {
      thrown = e;
    }
    if (!(thrown instanceof Database.SqliteError)) throw new Error('expected a SqliteError');
    expect(thrown.code).toBe('SQLITE_CONSTRAINT_UNIQUE');
    expect(thrown.message).toMatch(/^UNIQUE constraint failed: calendar_prices\./);
    expect(thrown.message).not.toMatch(/https?:|SECRET|marker=/);
    expect(count(db, 'calendar_prices')).toBe(0);
    // the engine records it on the execution (WP7); the column never holds a URL query or userinfo
    const executions = new ExecutionsRepo(db, clock);
    executions.setStatus(executionId, 'paused_error', {
      errorText: `${thrown.message} while writing tile 3 (${link.replace('https://', 'https://user:pw@')})`,
    });
    const text = executions.get(executionId)?.errorText ?? '';
    expect(text).toContain('UNIQUE constraint failed: calendar_prices.');
    expect(text).not.toMatch(/SECRET|marker=|pw@/);
  });
});
