import {
  asIsoDate,
  type CellKey,
  type CellOutcome,
  cellKeyString,
  fixedClock,
  type ProviderId,
  rollUp,
} from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { CELL_KEY_SQL } from '../src/internal/outcomeRow.js';
import { RowRejected } from '../src/internal/validate.js';
import { CellsRepo } from '../src/repositories/cells.js';
import { freshDb, sqliteCode, T0 } from './helpers/db.js';
import { cell, EWR, newExecution, withNights } from './helpers/factories.js';

const PROVIDERS: ProviderId[] = ['travelpayouts', 'searchapi'];
const dayCell = (j: number): CellKey =>
  cell(
    undefined,
    undefined,
    `2027-03-${String(10 + j).padStart(2, '0')}`,
    `2027-04-${String(10 + j).padStart(2, '0')}`,
  );
type Variant = Pick<CellOutcome, 'status' | 'reason'>;
const NON_TERMINAL: Variant[] = [
  { status: 'not_run', reason: null },
  { status: 'error', reason: 'upstream' },
  { status: 'error', reason: 'auth' },
  { status: 'skipped', reason: 'budget' },
  { status: 'skipped', reason: 'provider_disabled' },
  { status: 'skipped', reason: 'departed' },
  { status: 'skipped', reason: 'not_selected' },
];

function setup(cells: CellKey[], providers: ProviderId[] = PROVIDERS) {
  const db = freshDb();
  const clock = fixedClock(T0);
  const { execution } = newExecution(db, clock);
  const repo = new CellsRepo(db, clock, { allowSynthetic: false });
  repo.seed(execution.id, cells.map(withNights), providers);
  return { db, repo, executionId: execution.id };
}

/** The stored roll-up must equal core's rollUp over the cell's current outcomes (ruling 2: one implementation). */
function expectStoredMatchesCore(repo: CellsRepo, executionId: string, c: CellKey): void {
  expect(repo.rollUps(executionId).get(cellKeyString(c))?.discovery).toEqual(
    rollUp(repo.outcomes(executionId, { stage: 'discovery', cells: [c] })),
  );
}

describe('CellsRepo seeding and stored roll-ups (spec §3, §6.6, §7)', () => {
  it('seed writes cells and not_run outcomes per discovery provider; verification has no rows (row 0 → NULL)', () => {
    const { repo, executionId } = setup([cell(), cell(undefined, EWR)]);
    expect(repo.outcomes(executionId)).toHaveLength(4);
    expect(repo.outcomes(executionId, { providerId: 'searchapi', cells: [cell()] })).toEqual([
      {
        ...cell(),
        executionId,
        stage: 'discovery',
        providerId: 'searchapi',
        status: 'not_run',
        reason: null,
        attempts: 0,
        lastError: null,
        fetchedAt: null,
        minPence: null,
        cabin: null,
        pointOfSale: null,
        sourceKind: null,
        reusedFromExecutionId: null,
      },
    ]);
    expect(repo.rollUps(executionId).get(cellKeyString(cell()))).toEqual({
      discovery: { status: 'not_run', reason: null, minPence: null },
      verification: { status: null, reason: null, minPence: null },
    });
    expect(repo.buckets(executionId, 'discovery', 'travelpayouts')).toEqual({
      priced: 0,
      empty: 0,
      no_data: 0,
      error: 0,
      skipped: 0,
      not_run: 2,
      reused: 0,
    });
  });

  it('a stage with no provider configured has no outcome rows and a NULL roll-up', () => {
    const { repo, executionId } = setup([cell()], []);
    expect(repo.outcomes(executionId)).toEqual([]);
    expect(repo.rollUps(executionId).get(cellKeyString(cell()))?.discovery).toEqual({
      status: null,
      reason: null,
      minPence: null,
    });
  });

  it('every pair of non-terminal outcomes stores exactly what core rollUp returns (49 combinations)', () => {
    const cells = NON_TERMINAL.map((_, j) => dayCell(j));
    for (const a of NON_TERMINAL) {
      const { repo, executionId } = setup(cells);
      for (const [j, b] of NON_TERMINAL.entries()) {
        const c = dayCell(j);
        repo.setOutcome(executionId, c, 'discovery', 'travelpayouts', a);
        repo.setOutcome(executionId, c, 'discovery', 'searchapi', b);
        expectStoredMatchesCore(repo, executionId, c);
      }
    }
  });

  it('spec §6.6 rows that do not depend on reason rules: not_run beats error and skipped; all skipped keeps the priority', () => {
    const { repo, executionId } = setup([cell()]);
    repo.setOutcome(executionId, cell(), 'discovery', 'travelpayouts', {
      status: 'error',
      reason: 'upstream',
    });
    expect(repo.rollUps(executionId).get(cellKeyString(cell()))?.discovery.status).toBe('not_run');
    repo.setOutcome(executionId, cell(), 'discovery', 'travelpayouts', {
      status: 'skipped',
      reason: 'not_selected',
    });
    repo.setOutcome(executionId, cell(), 'discovery', 'searchapi', { status: 'skipped', reason: 'budget' });
    expect(repo.rollUps(executionId).get(cellKeyString(cell()))?.discovery).toEqual({
      status: 'skipped',
      reason: 'budget',
      minPence: null,
    });
  });

  it('setOutcome rules: attempts, URL-free last_error, unknown row, closed reasons, no terminal status, no data fields', () => {
    const { repo, executionId } = setup([cell()], ['searchapi']);
    repo.setOutcome(executionId, cell(), 'discovery', 'searchapi', {
      status: 'error',
      reason: 'network',
      lastError: 'socket hang up https://www.searchapi.io/api/v1/search?api_key=SECRET',
      incrementAttempts: true,
    });
    expect(repo.outcomes(executionId)[0]).toMatchObject({
      status: 'error',
      reason: 'network',
      attempts: 1,
      lastError: 'socket hang up https://www.searchapi.io/api/v1/search',
    });
    const set =
      (patch: Parameters<CellsRepo['setOutcome']>[4], c = cell()) =>
      () =>
        repo.setOutcome(executionId, c, 'discovery', 'searchapi', patch);
    expect(set({ status: 'error', reason: 'x' }, cell(undefined, EWR))).toThrow(RowRejected);
    expect(set({ status: 'skipped', reason: 'bored' })).toThrow(
      expect.objectContaining({ rule: 'skip-reason' }),
    );
    expect(set({ status: 'error', reason: 'HTTP 500 https://www.searchapi.io/x?api_key=SECRET' })).toThrow(
      expect.objectContaining({ rule: 'error-reason' }),
    );
    expect(set({ status: 'priced' })).toThrow(expect.objectContaining({ rule: 'terminal-outcome' }));
    expect(set({ status: 'no_data', reason: 'cabin-not-offered' })).toThrow(
      expect.objectContaining({ rule: 'terminal-outcome' }),
    );
    expect(set({ minPence: 100 })).toThrow(expect.objectContaining({ rule: 'outcome-field' }));
    expect(set({ sourceKind: 'synthetic' })).toThrow(expect.objectContaining({ rule: 'outcome-field' }));
    expect(set({ status: 'not_run', reason: 'retry https://www.searchapi.io/x?api_key=SECRET' })).toThrow(
      expect.objectContaining({ rule: 'outcome-reason' }),
    );
  });

  it('setOutcomesForProvider and markNoData move one provider in bulk; terminal rows are never rewritten', () => {
    const { repo, executionId } = setup([dayCell(0), dayCell(1), dayCell(2)]);
    repo.setOutcome(executionId, dayCell(2), 'discovery', 'searchapi', {
      status: 'error',
      reason: 'upstream',
    });
    expect(
      repo.setOutcomesForProvider(executionId, 'discovery', 'searchapi', ['not_run'], {
        status: 'skipped',
        reason: 'provider_disabled',
      }),
    ).toBe(2);
    expect(repo.outcomes(executionId, { providerId: 'searchapi' }).map((o) => [o.status, o.reason])).toEqual([
      ['skipped', 'provider_disabled'],
      ['skipped', 'provider_disabled'],
      ['error', 'upstream'],
    ]);
    expect(() =>
      repo.setOutcomesForProvider(executionId, 'discovery', 'searchapi', ['not_run'], {
        status: 'skipped',
        reason: 'whim',
      }),
    ).toThrow(expect.objectContaining({ rule: 'skip-reason' }));
    expect(() =>
      repo.setOutcomesForProvider(executionId, 'discovery', 'searchapi', ['priced'], {
        status: 'not_run',
        reason: null,
      }),
    ).toThrow(expect.objectContaining({ rule: 'terminal-outcome' }));
    expect(() =>
      repo.setOutcomesForProvider(executionId, 'discovery', 'searchapi', ['not_run'], {
        status: 'empty',
        reason: null,
      }),
    ).toThrow(expect.objectContaining({ rule: 'terminal-outcome' }));
    expect(repo.markNoData(executionId, 'discovery', 'travelpayouts', 'cabin-not-offered')).toBe(3);
    expect(repo.outcomes(executionId, { providerId: 'travelpayouts', cells: [dayCell(0)] })[0]).toMatchObject(
      { status: 'no_data', reason: 'cabin-not-offered' },
    );
    expectStoredMatchesCore(repo, executionId, dayCell(0));
    expect(repo.markNoData(executionId, 'discovery', 'travelpayouts', 'cabin-not-offered')).toBe(0); // only not_run rows move
    expect(() =>
      repo.setOutcome(executionId, dayCell(0), 'discovery', 'travelpayouts', {
        status: 'not_run',
        reason: null,
      }),
    ).toThrow(expect.objectContaining({ rule: 'terminal-outcome' }));
  });

  it('bucketsPerDay groups the six buckets by departure date, stage and provider', () => {
    const { repo, executionId } = setup([
      dayCell(0),
      cell(undefined, EWR, '2027-03-10', '2027-04-10'),
      dayCell(1),
    ]);
    repo.setOutcome(executionId, dayCell(0), 'discovery', 'searchapi', {
      status: 'error',
      reason: 'upstream',
    });
    const m = repo.bucketsPerDay(executionId);
    expect([...m.keys()]).toEqual([asIsoDate('2027-03-10'), asIsoDate('2027-03-11')]);
    expect(m.get(asIsoDate('2027-03-10'))).toEqual([
      {
        stage: 'discovery',
        providerId: 'searchapi',
        buckets: { priced: 0, empty: 0, no_data: 0, error: 1, skipped: 0, not_run: 1, reused: 0 },
        total: 2,
      },
      {
        stage: 'discovery',
        providerId: 'travelpayouts',
        buckets: { priced: 0, empty: 0, no_data: 0, error: 0, skipped: 0, not_run: 2, reused: 0 },
        total: 2,
      },
    ]);
  });

  it('CELL_KEY_SQL builds exactly core cellKeyString, the key every map and json_each filter uses (arch-r2-008)', () => {
    const { db, executionId } = setup([cell(undefined, EWR)]);
    expect(
      db.raw.prepare(`SELECT ${CELL_KEY_SQL} AS k FROM search_cells WHERE execution_id = ?`).get(executionId),
    ).toEqual({ k: cellKeyString(cell(undefined, EWR)) });
  });

  it('cell_outcomes CHECKs hold on their own: priced ⇔ min_pence, provenance on terminal rows, closed skip reasons (test-r2-004)', () => {
    const { db, executionId } = setup([cell()], ['travelpayouts']);
    const raw = (set: string) => () =>
      db.raw.prepare(`UPDATE cell_outcomes SET ${set} WHERE execution_id = ?`).run(executionId);
    const PROV =
      "fetched_at = '2026-10-14T12:00:00.000Z', cabin = 'economy', point_of_sale = 'unknown', source_kind = 'authorised-cached'";
    expect(sqliteCode(raw(`status = 'priced', min_pence = NULL, ${PROV}`))).toBe('SQLITE_CONSTRAINT_CHECK');
    expect(sqliteCode(raw(`status = 'empty', min_pence = 5, ${PROV}`))).toBe('SQLITE_CONSTRAINT_CHECK');
    for (const missing of ['fetched_at', 'cabin', 'point_of_sale', 'source_kind']) {
      for (const status of ['priced', 'empty', 'no_data']) {
        expect(
          sqliteCode(
            raw(
              `status = '${status}', min_pence = ${status === 'priced' ? 100 : 'NULL'}, ${PROV}, ${missing} = NULL`,
            ),
          ),
          `${status} without ${missing}`,
        ).toBe('SQLITE_CONSTRAINT_CHECK');
      }
    }
    expect(sqliteCode(raw(`status = 'skipped', reason = 'whim'`))).toBe('SQLITE_CONSTRAINT_CHECK');
    expect(sqliteCode(raw(`status = 'skipped', reason = NULL`))).toBe('SQLITE_CONSTRAINT_CHECK'); // arch-r3-003
    expect(
      sqliteCode(
        raw(
          `status = 'no_data', reason = NULL, fetched_at = NULL, cabin = NULL, point_of_sale = NULL, source_kind = NULL`,
        ),
      ),
    ).toBe('SQLITE_CONSTRAINT_CHECK');
    raw(`status = 'no_data', reason = 'cabin-not-offered'`)(); // the one data-less terminal outcome
    raw(`status = 'priced', reason = NULL, min_pence = 100, ${PROV}`)(); // positive control
    expect(
      db.raw.prepare('SELECT status FROM cell_outcomes WHERE execution_id = ?').get(executionId),
    ).toEqual({ status: 'priced' });
  });
});
