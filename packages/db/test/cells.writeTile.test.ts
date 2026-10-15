import { type CellKey, cellKeyString, fixedClock, type ProviderId, rollUp } from '@gmt/core';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { RowRejected } from '../src/internal/validate.js';
import { CalendarPricesRepo } from '../src/repositories/calendarPrices.js';
import { CellsRepo } from '../src/repositories/cells.js';
import { ExecutionsRepo } from '../src/repositories/executions.js';
import type { TileWrite } from '../src/types.js';
import { at, count, freshDb, T0 } from './helpers/db.js';
import { calendarPrice, cell, EWR, newExecution, withNights } from './helpers/factories.js';
import { rawOutcome } from './helpers/outcomes.js';

const A = cell();
const B = cell(undefined, EWR);
const C = cell(undefined, undefined, '2027-03-15', '2027-03-29');
type TileOutcome = TileWrite['outcomes'][number];
const out = (
  c: CellKey,
  status: TileOutcome['status'],
  minPence: number | null = null,
  over: Partial<TileOutcome> = {},
): TileOutcome => ({
  ...c,
  status,
  reason: null,
  lastError: null,
  fetchedAt: T0,
  minPence,
  cabin: 'economy',
  pointOfSale: 'unknown',
  sourceKind: 'authorised-cached',
  ...over,
});
const tile = (cells: CellKey[], outcomes: TileOutcome[], prices: TileWrite['prices'] = []): TileWrite => ({
  tileIndex: 0,
  cells,
  prices,
  outcomes,
  discards: 0,
});
const opts = { allowSynthetic: false };

function setup(providers: ProviderId[] = ['travelpayouts']) {
  const db = freshDb();
  const clock = fixedClock(T0);
  const { definition, execution } = newExecution(db, clock);
  const cells = new CellsRepo(db, clock, opts);
  cells.seed(execution.id, [A, B, C].map(withNights), providers);
  return {
    db,
    clock,
    definition,
    executionId: execution.id,
    cells,
    executions: new ExecutionsRepo(db, clock),
  };
}
const stored = (cells: CellsRepo, executionId: string, c: CellKey) =>
  cells.rollUps(executionId).get(cellKeyString(c))?.discovery;
const core = (cells: CellsRepo, executionId: string, c: CellKey) =>
  rollUp(cells.outcomes(executionId, { stage: 'discovery', cells: [c] }));

describe('CellsRepo.writeTile (spec §7 atomic unit "each tile\'s prices, outcomes and roll-ups")', () => {
  it('writes prices, outcomes and roll-ups together and resets auto_resume_count', () => {
    const { db, executionId, cells, executions } = setup();
    executions.incrementAutoResume(executionId);
    cells.writeTile(
      executionId,
      'travelpayouts',
      tile(
        [A, B, C],
        [out(A, 'priced', 39_900), out(B, 'empty'), out(C, 'no_data')],
        [calendarPrice(A, { pricePence: 39_900, priceNativeMinor: 39_900 })],
      ),
    );
    expect(count(db, 'calendar_prices')).toBe(1);
    expect(stored(cells, executionId, A)).toEqual({ status: 'priced', reason: null, minPence: 39_900 });
    expect([stored(cells, executionId, B)?.status, stored(cells, executionId, C)?.status]).toEqual([
      'empty',
      'no_data',
    ]);
    expect(cells.outcomes(executionId, { cells: [A] })[0]).toMatchObject({
      status: 'priced',
      minPence: 39_900,
      fetchedAt: T0,
      cabin: 'economy',
      pointOfSale: 'unknown',
      sourceKind: 'authorised-cached',
      attempts: 0,
      reusedFromExecutionId: null,
    });
    expect(executions.get(executionId)?.autoResumeCount).toBe(0);
  });

  it('writeTileError marks exactly its cells error, attempts + 1 per pass; reason is the kind, the message goes to last_error URL-free', () => {
    const { executionId, cells } = setup();
    const msg = 'HTTP 503 from https://api.travelpayouts.com/aviasales/v3/prices_for_dates?token=SECRET';
    cells.writeTileError(executionId, 'travelpayouts', [A, B], 'upstream', msg);
    cells.writeTileError(executionId, 'travelpayouts', [A], 'upstream', msg);
    expect(cells.outcomes(executionId, { cells: [A] })[0]).toMatchObject({
      status: 'error',
      reason: 'upstream',
      attempts: 2,
      lastError: 'HTTP 503 from https://api.travelpayouts.com/aviasales/v3/prices_for_dates',
    });
    expect(cells.outcomes(executionId, { cells: [B] })[0]).toMatchObject({ attempts: 1 });
    expect(cells.outcomes(executionId, { cells: [C] })[0]).toMatchObject({ status: 'not_run', attempts: 0 });
    expect(stored(cells, executionId, A)).toEqual(core(cells, executionId, A));
    expect(() => cells.writeTileError(executionId, 'travelpayouts', [C], msg, null)).toThrow(
      expect.objectContaining({ rule: 'error-reason' }),
    );
  });

  it('roll-ups are atomic: a SQL failure inside the write leaves no partial rows', () => {
    const { db, clock, executionId, cells, executions } = setup();
    executions.incrementAutoResume(executionId);
    new CalendarPricesRepo(db, clock, opts).insert(executionId, [calendarPrice(B)]); // a fresh price for B already exists
    let thrown: unknown;
    try {
      cells.writeTile(
        executionId,
        'travelpayouts',
        tile(
          [A, B],
          [out(A, 'priced', 41_200), out(B, 'priced', 41_200)],
          [calendarPrice(A), calendarPrice(B)],
        ),
      );
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(Database.SqliteError);
    expect(count(db, 'calendar_prices')).toBe(1);
    expect(cells.outcomes(executionId).map((o) => o.status)).toEqual(['not_run', 'not_run', 'not_run']);
    expect(stored(cells, executionId, A)?.status).toBe('not_run');
    expect(executions.get(executionId)?.autoResumeCount).toBe(1);
  });

  it('a rejection after an outcome and roll-up were written rolls those back too (test-011)', () => {
    const { db, executionId, cells } = setup();
    const stranger = cell(undefined, undefined, '2027-04-01', '2027-04-15');
    expect(() =>
      cells.writeTile(
        executionId,
        'travelpayouts',
        tile(
          [A, stranger],
          [out(A, 'priced', 41_200), out(stranger, 'priced', 41_200)],
          [calendarPrice(A), calendarPrice(stranger)],
        ),
      ),
    ).toThrow(expect.objectContaining({ rule: 'missing' }));
    expect(count(db, 'calendar_prices')).toBe(0);
    expect(cells.outcomes(executionId, { cells: [A] })[0]?.status).toBe('not_run');
    expect(stored(cells, executionId, A)).toEqual({ status: 'not_run', reason: null, minPence: null });
  });

  it('rejects malformed tiles before writing', () => {
    const { db, executionId, cells } = setup();
    const w =
      (t: TileWrite, providerId: ProviderId = 'travelpayouts') =>
      () =>
        cells.writeTile(executionId, providerId, t);
    expect(w(tile([A], [out(A, 'priced', 1)]))).toThrow(
      expect.objectContaining({ rule: 'priced-needs-price' }),
    );
    expect(w(tile([A], [out(A, 'empty')], [calendarPrice(A)]))).toThrow(
      expect.objectContaining({ rule: 'price-needs-priced' }),
    );
    expect(w(tile([A], [out(A, 'priced', 1)], [calendarPrice(A)]))).toThrow(
      expect.objectContaining({ rule: 'min-pence' }),
    );
    expect(
      w(
        tile(
          [A],
          [out(A, 'empty', null, { reason: 'HTTP 500 https://api.travelpayouts.com/x?token=SECRET' })],
        ),
      ),
    ).toThrow(expect.objectContaining({ rule: 'outcome-reason' }));
    expect(w(tile([A], [out(A, 'no_data', null, { reason: 'partial-expansion' })]))).toThrow(
      expect.objectContaining({ rule: 'outcome-reason' }),
    );
    expect(w(tile([A], [out(A, 'empty', null, { cabin: null })]))).toThrow(
      expect.objectContaining({ rule: 'outcome-provenance' }),
    );
    expect(w(tile([A], [out(A, 'no_data', null, { fetchedAt: null })]))).toThrow(
      expect.objectContaining({ rule: 'outcome-provenance' }),
    );
    expect(
      w(
        tile(
          [A],
          [out(A, 'priced', 41_200)],
          [calendarPrice(A), calendarPrice(A, { pricePence: 1, priceNativeMinor: 1 })],
        ),
      ),
    ).toThrow(expect.objectContaining({ rule: 'in-tile-conflict' }));
    expect(w(tile([A, B], [out(A, 'empty')]))).toThrow(expect.objectContaining({ rule: 'tile-partition' }));
    expect(w(tile([A], [out(A, 'empty'), out(B, 'empty')]))).toThrow(
      expect.objectContaining({ rule: 'tile-partition' }),
    );
    expect(w(tile([A], [out(A, 'error', null, { reason: 'upstream' })]))).toThrow(
      expect.objectContaining({ rule: 'tile-status' }),
    );
    expect(w(tile([A], [out(A, 'priced', 41_200)], [calendarPrice(A)]), 'searchapi')).toThrow(RowRejected);
    expect(count(db, 'calendar_prices')).toBe(0);
  });

  // test-r2-001: every field the outcome must share with its price, one row each.
  it.each([
    ['fetchedAt', { fetchedAt: at('2026-10-14T11:00:00.000Z') }],
    ['cabin', { cabin: 'business' }],
    ['pointOfSale', { pointOfSale: 'GB' }],
    ['sourceKind', { sourceKind: 'scraped-aggregate' }],
  ] as const)('refuses an outcome whose %s differs from its price', (_field, over) => {
    const { db, executionId, cells } = setup();
    expect(() =>
      cells.writeTile(
        executionId,
        'travelpayouts',
        tile([A], [out(A, 'priced', 41_200, over)], [calendarPrice(A)]),
      ),
    ).toThrow(expect.objectContaining({ rule: 'outcome-price-mismatch' }));
    expect(count(db, 'calendar_prices')).toBe(0);
  });

  it('fresh-on-fresh merges through core: an error never displaces priced; empty beats no_data; stored roll-ups equal core', () => {
    const { executionId, cells } = setup();
    cells.writeTile(
      executionId,
      'travelpayouts',
      tile(
        [A],
        [out(A, 'priced', 40_000)],
        [calendarPrice(A, { pricePence: 40_000, priceNativeMinor: 40_000 })],
      ),
    );
    cells.writeTileError(executionId, 'travelpayouts', [A, B], 'network', null);
    expect(cells.outcomes(executionId, { cells: [A] })[0]).toMatchObject({
      status: 'priced',
      minPence: 40_000,
      attempts: 1,
    });
    cells.writeTile(executionId, 'travelpayouts', tile([B], [out(B, 'no_data')]));
    expect(cells.outcomes(executionId, { cells: [B] })[0]).toMatchObject({ status: 'no_data', attempts: 1 });
    cells.writeTile(executionId, 'travelpayouts', tile([B], [out(B, 'empty')]));
    cells.writeTile(executionId, 'travelpayouts', tile([B], [out(B, 'no_data')]));
    expect(cells.outcomes(executionId, { cells: [B] })[0]?.status).toBe('empty');
    for (const c of [A, B, C]) expect(stored(cells, executionId, c)).toEqual(core(cells, executionId, c));
  });

  it('terminal outcomes across two providers store exactly what core rollUp returns', () => {
    const { executionId, cells } = setup(['travelpayouts', 'searchapi']);
    const sa = (c: CellKey, status: TileOutcome['status'], minPence: number | null = null) =>
      out(c, status, minPence, { pointOfSale: 'GB', sourceKind: 'scraped-aggregate' });
    const saPrice = (c: CellKey, pence: number) =>
      calendarPrice(c, {
        providerId: 'searchapi',
        sourceKind: 'scraped-aggregate',
        pointOfSale: 'GB',
        pricePence: pence,
        priceNativeMinor: pence,
      });
    cells.writeTile(
      executionId,
      'travelpayouts',
      tile(
        [A, B, C],
        [out(A, 'priced', 50_000), out(B, 'empty'), out(C, 'no_data')],
        [calendarPrice(A, { pricePence: 50_000, priceNativeMinor: 50_000 })],
      ),
    );
    cells.writeTile(
      executionId,
      'searchapi',
      tile([A, B], [sa(A, 'priced', 45_000), sa(B, 'no_data')], [saPrice(A, 45_000)]),
    );
    cells.writeTileError(executionId, 'searchapi', [C], 'upstream', null);
    for (const c of [A, B, C]) expect(stored(cells, executionId, c)).toEqual(core(cells, executionId, c));
    expect(stored(cells, executionId, A)).toMatchObject({ status: 'priced', minPence: 45_000 });
  });

  it('a fresh price replaces a reused copy outright, even when the reused price was cheaper (ruling 3)', () => {
    const { db, clock, definition, executionId, cells } = setup();
    const origin = newExecution(db, clock, { definition, status: 'completed' }).execution.id;
    rawOutcome(db, executionId, A, 'discovery', 'travelpayouts', {
      status: 'priced',
      minPence: 30_000,
      reusedFrom: origin,
      fetchedAt: '2026-10-10T05:00:00.000Z',
    });
    db.raw
      .prepare(`INSERT INTO calendar_prices (execution_id, provider_id, source_kind, cabin, origin, destination, departure_date, return_date, price_pence, price_native_minor, currency_native, fx_converted, point_of_sale, fetched_at, max_age_hours, reused_from_execution_id)
                VALUES (?, 'travelpayouts', 'authorised-cached', 'economy', 'LHR', 'JFK', '2027-03-14', '2027-03-28', 30000, 30000, 'GBP', 0, 'unknown', '2026-10-10T05:00:00.000Z', 48, ?)`)
      .run(executionId, origin);
    cells.writeTile(
      executionId,
      'travelpayouts',
      tile(
        [A],
        [out(A, 'priced', 38_000)],
        [calendarPrice(A, { pricePence: 38_000, priceNativeMinor: 38_000 })],
      ),
    );
    expect(cells.outcomes(executionId, { cells: [A] })[0]).toMatchObject({
      status: 'priced',
      minPence: 38_000,
      fetchedAt: T0,
      reusedFromExecutionId: null,
    });
    expect(
      db.raw.prepare('SELECT price_pence AS p, reused_from_execution_id AS r FROM calendar_prices').all(),
    ).toEqual([{ p: 38_000, r: null }]);
    expect(stored(cells, executionId, A)).toEqual({ status: 'priced', reason: null, minPence: 38_000 });
  });

  it('a fresh empty also replaces a reused priced copy and deletes its price row', () => {
    const { db, clock, definition, executionId, cells } = setup();
    const origin = newExecution(db, clock, { definition, status: 'completed' }).execution.id;
    rawOutcome(db, executionId, A, 'discovery', 'travelpayouts', {
      status: 'priced',
      minPence: 30_000,
      reusedFrom: origin,
    });
    db.raw
      .prepare(`INSERT INTO calendar_prices (execution_id, provider_id, source_kind, cabin, origin, destination, departure_date, return_date, price_pence, price_native_minor, currency_native, fx_converted, point_of_sale, fetched_at, max_age_hours, reused_from_execution_id)
                VALUES (?, 'travelpayouts', 'authorised-cached', 'economy', 'LHR', 'JFK', '2027-03-14', '2027-03-28', 30000, 30000, 'GBP', 0, 'unknown', ?, 48, ?)`)
      .run(executionId, T0, origin);
    cells.writeTile(executionId, 'travelpayouts', tile([A], [out(A, 'empty')]));
    expect(cells.outcomes(executionId, { cells: [A] })[0]).toMatchObject({
      status: 'empty',
      minPence: null,
      reusedFromExecutionId: null,
    });
    expect(count(db, 'calendar_prices')).toBe(0);
  });

  it('a tile error over a reused priced copy keeps the copy and its price and only counts the attempt (prov-r2-003, test-r2-002)', () => {
    const { db, clock, definition, executionId, cells } = setup();
    const origin = newExecution(db, clock, { definition, status: 'completed' }).execution.id;
    rawOutcome(db, executionId, A, 'discovery', 'travelpayouts', {
      status: 'priced',
      minPence: 30_000,
      reusedFrom: origin,
    });
    db.raw
      .prepare(`INSERT INTO calendar_prices (execution_id, provider_id, source_kind, cabin, origin, destination, departure_date, return_date, price_pence, price_native_minor, currency_native, fx_converted, point_of_sale, fetched_at, max_age_hours, reused_from_execution_id)
                VALUES (?, 'travelpayouts', 'authorised-cached', 'economy', 'LHR', 'JFK', '2027-03-14', '2027-03-28', 30000, 30000, 'GBP', 0, 'unknown', ?, 48, ?)`)
      .run(executionId, T0, origin);
    cells.writeTileError(executionId, 'travelpayouts', [A], 'upstream', 'HTTP 503');
    expect(cells.outcomes(executionId, { cells: [A] })[0]).toMatchObject({
      status: 'priced',
      minPence: 30_000,
      reusedFromExecutionId: origin,
      attempts: 1,
    });
    expect(count(db, 'calendar_prices')).toBe(1);
    expect(stored(cells, executionId, A)).toEqual({ status: 'priced', reason: null, minPence: 30_000 });
  });

  it('a fresh tile replaces skipped:budget outright (test-r2-002)', () => {
    const { executionId, cells } = setup();
    cells.setOutcome(executionId, A, 'discovery', 'travelpayouts', { status: 'skipped', reason: 'budget' });
    cells.writeTile(executionId, 'travelpayouts', tile([A], [out(A, 'empty')]));
    expect(cells.outcomes(executionId, { cells: [A] })[0]).toMatchObject({
      status: 'empty',
      reason: null,
      fetchedAt: T0,
    });
    expect(stored(cells, executionId, A)).toEqual({ status: 'empty', reason: null, minPence: null });
  });
});

describe('priced outcome reasons (spec §3, §5.6; ruling 2026-10-15)', () => {
  it.each([
    [null, null],
    ['partial-expansion', 'partial-expansion'],
    ['offers-dropped:3', null],
    ['partial-expansion;offers-dropped:3', 'partial-expansion'],
  ])('a priced outcome may carry %s; the roll-up reason is %s and equals core', (reason, rolled) => {
    const { executionId, cells } = setup();
    cells.writeTile(
      executionId,
      'travelpayouts',
      tile([A], [out(A, 'priced', 41_200, { reason })], [calendarPrice(A)]),
    );
    expect(cells.outcomes(executionId, { cells: [A] })[0]?.reason).toBe(reason);
    expect(stored(cells, executionId, A)).toEqual({ status: 'priced', reason: rolled, minPence: 41_200 });
    expect(stored(cells, executionId, A)).toEqual(core(cells, executionId, A));
  });

  it.each([
    'offers-dropped:0',
    'offers-dropped:01',
    'offers-dropped:',
    'offers-dropped:x',
    'offers-dropped:3;partial-expansion',
    'partial-expansion;partial-expansion',
    'partial-expansion;offers-dropped:0',
    'cabin-not-offered',
  ])('refuses the priced reason %s', (reason) => {
    const { executionId, cells } = setup();
    expect(() =>
      cells.writeTile(
        executionId,
        'travelpayouts',
        tile([A], [out(A, 'priced', 41_200, { reason })], [calendarPrice(A)]),
      ),
    ).toThrow(expect.objectContaining({ rule: 'outcome-reason' }));
  });

  it('offers-dropped is never accepted on an empty or no_data outcome', () => {
    const { executionId, cells } = setup();
    for (const status of ['empty', 'no_data'] as const)
      expect(() =>
        cells.writeTile(
          executionId,
          'travelpayouts',
          tile([A], [out(A, status, null, { reason: 'offers-dropped:1' })]),
        ),
      ).toThrow(expect.objectContaining({ rule: 'outcome-reason' }));
  });
});

describe('writeTile fresh-on-fresh priced overlap (brief ruling 3; ruling 2026-10-15)', () => {
  const priced = (c: CellKey, pence: number) => ({
    o: out(c, 'priced', pence),
    p: calendarPrice(c, { pricePence: pence, priceNativeMinor: pence }),
  });
  const pricesOf = (db: ReturnType<typeof setup>['db'], executionId: string, c: CellKey) =>
    new CalendarPricesRepo(db, fixedClock(T0), opts)
      .fetchedBy(executionId)
      .filter((r) => cellKeyString(r.cell) === cellKeyString(c))
      .map((r) => r.pricePence);

  it('a second priced tile over a fresh priced cell keeps the minimum, writes its other cells, and stays equal to core', () => {
    const { db, executionId, cells } = setup();
    const a1 = priced(A, 40_000);
    cells.writeTile(executionId, 'travelpayouts', tile([A], [a1.o], [a1.p]));

    // lower: replaces the fresh price row; the tile's other cell is written too
    const a2 = priced(A, 38_000);
    const b2 = priced(B, 51_000);
    cells.writeTile(executionId, 'travelpayouts', {
      ...tile([A, B], [a2.o, b2.o], [a2.p, b2.p]),
      tileIndex: 1,
    });
    expect(pricesOf(db, executionId, A)).toEqual([38_000]);
    expect(pricesOf(db, executionId, B)).toEqual([51_000]);
    expect(stored(cells, executionId, A)).toEqual({ status: 'priced', reason: null, minPence: 38_000 });

    // higher: the stored row and outcome keep 38,000; the other cell is still written
    const a3 = priced(A, 42_000);
    cells.writeTile(executionId, 'travelpayouts', {
      ...tile([A, C], [a3.o, out(C, 'empty')], [a3.p]),
      tileIndex: 2,
    });
    expect(pricesOf(db, executionId, A)).toEqual([38_000]);
    expect(count(db, 'calendar_prices')).toBe(2);
    expect(stored(cells, executionId, A)).toEqual({ status: 'priced', reason: null, minPence: 38_000 });
    expect(stored(cells, executionId, C)?.status).toBe('empty');
    for (const c of [A, B, C]) expect(stored(cells, executionId, c)).toEqual(core(cells, executionId, c));
  });

  it('an equal price keeps the existing row; a priced tile over a fresh empty cell inserts its price', () => {
    const { db, executionId, cells } = setup();
    const a1 = priced(A, 40_000);
    cells.writeTile(executionId, 'travelpayouts', tile([A, B], [a1.o, out(B, 'empty')], [a1.p]));
    const a2 = priced(A, 40_000);
    const b2 = priced(B, 45_000);
    cells.writeTile(executionId, 'travelpayouts', tile([A, B], [a2.o, b2.o], [a2.p, b2.p]));
    expect(pricesOf(db, executionId, A)).toEqual([40_000]);
    expect(pricesOf(db, executionId, B)).toEqual([45_000]);
    expect(stored(cells, executionId, B)).toEqual({ status: 'priced', reason: null, minPence: 45_000 });
  });
});
