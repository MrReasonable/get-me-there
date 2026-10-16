import {
  asIsoDate,
  type CellKey,
  type CellOutcomeStatus,
  cellKeyString,
  fixedClock,
  type ProviderId,
} from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { CellsRepo } from '../src/repositories/cells.js';
import { freshDb, T0 } from './helpers/db.js';
import { cell, EWR, newExecution, withNights } from './helpers/factories.js';
import { rawOutcome } from './helpers/outcomes.js';

const day = (n: number) =>
  cell(
    undefined,
    undefined,
    `2027-05-${String(n).padStart(2, '0')}`,
    `2027-06-${String(n).padStart(2, '0')}`,
  );

function setup(cells: CellKey[], discovery: ProviderId[] = ['searchapi']) {
  const db = freshDb();
  const clock = fixedClock(T0);
  const { execution } = newExecution(db, clock);
  const repo = new CellsRepo(db, clock, { allowSynthetic: false });
  repo.seed(execution.id, cells.map(withNights), discovery);
  return { db, executionId: execution.id, repo };
}

describe('selection persistence (spec §6.7, §7 atomic unit "selection persistence + verification seeding")', () => {
  it('selected cells get not_run, the rest of allCells skipped:not_selected, roll-ups follow, and selection runs once', () => {
    const all = [day(1), day(2), day(3)];
    const { executionId, repo } = setup(all);
    expect(repo.hasVerificationOutcomes(executionId)).toBe(false);
    repo.seedVerification(
      executionId,
      [
        { cell: day(1), reason: 'always_include' },
        { cell: day(3), reason: 'top_n' },
      ],
      all,
      ['searchapi'],
    );
    expect(repo.hasVerificationOutcomes(executionId)).toBe(true);
    expect(repo.selected(executionId)).toEqual([
      { cell: day(1), reason: 'always_include' },
      { cell: day(3), reason: 'top_n' },
    ]);
    expect(
      repo.outcomes(executionId, { stage: 'verification' }).map((o) => [o.departureDate, o.status, o.reason]),
    ).toEqual([
      ['2027-05-01', 'not_run', null],
      ['2027-05-02', 'skipped', 'not_selected'],
      ['2027-05-03', 'not_run', null],
    ]);
    expect(repo.rollUps(executionId).get(cellKeyString(day(2)))?.verification).toEqual({
      status: 'skipped',
      reason: 'not_selected',
      minPence: null,
    });
    expect(() => repo.seedVerification(executionId, [], all, ['searchapi'])).toThrow(
      expect.objectContaining({ rule: 'selection-once' }),
    );
  });

  it('a selection outside allCells, or allCells outside the execution, writes nothing', () => {
    const { executionId, repo } = setup([day(1), day(2)]);
    expect(() =>
      repo.seedVerification(executionId, [{ cell: day(2), reason: 'top_n' }], [day(1)], ['searchapi']),
    ).toThrow(expect.objectContaining({ rule: 'selection-member' }));
    expect(() =>
      repo.seedVerification(
        executionId,
        [{ cell: day(1), reason: 'top_n' }],
        [day(1), day(9)],
        ['searchapi'],
      ),
    ).toThrow(expect.objectContaining({ rule: 'selection-member' }));
    expect(repo.selected(executionId)).toEqual([]);
    expect(repo.hasVerificationOutcomes(executionId)).toBe(false);
  });

  it('with no verification provider the selection is stored and the verification roll-up stays NULL', () => {
    const { executionId, repo } = setup([day(1)]);
    repo.seedVerification(executionId, [{ cell: day(1), reason: 'stride' }], [day(1)], []);
    expect(repo.selected(executionId)).toHaveLength(1);
    expect(repo.rollUps(executionId).get(cellKeyString(day(1)))?.verification.status).toBeNull();
  });
});

describe('resume query per (stage, provider) (spec §7 "Resume")', () => {
  // n, status, reason, attempts, auto, manual
  const cases: Array<[number, CellOutcomeStatus, string | null, number, boolean, boolean]> = [
    [1, 'not_run', null, 0, true, true],
    [2, 'error', 'network', 2, true, true],
    [3, 'error', 'network', 3, false, false],
    [4, 'error', null, 0, true, true],
    [5, 'error', 'auth', 1, false, true],
    [6, 'error', 'quota', 1, false, true],
    [7, 'error', 'parse', 1, false, true],
    [8, 'error', 'no-return-legs', 1, false, false],
    [9, 'error', 'fx-unavailable', 1, false, false],
    [10, 'error', 'currency-unsupported', 1, false, false],
    [11, 'error', 'unknown-airport-tz', 1, false, false],
    [12, 'skipped', 'budget', 0, true, true],
    [13, 'skipped', 'provider_disabled', 0, false, true],
    [14, 'skipped', 'not_selected', 0, false, false],
    [15, 'skipped', 'departed', 0, false, false],
    [16, 'priced', null, 0, false, false],
    [17, 'empty', null, 0, false, false],
    [18, 'no_data', null, 0, false, false],
    [19, 'no_data', 'cabin-not-offered', 0, false, false],
  ];

  it('automatic and manual resume select exactly the spec rows; priced, empty and no_data are never selected', () => {
    const { db, executionId, repo } = setup(cases.map(([n]) => day(n)));
    for (const [n, status, reason, attempts] of cases)
      rawOutcome(db, executionId, day(n), 'discovery', 'searchapi', { status, reason, attempts });
    const days = (cells: CellKey[]) => cells.map((c) => Number(c.departureDate.slice(8)));
    expect(days(repo.resumable(executionId, 'discovery', 'searchapi', false))).toEqual(
      cases.filter((c) => c[4]).map((c) => c[0]),
    );
    expect(days(repo.resumable(executionId, 'discovery', 'searchapi', true))).toEqual(
      cases.filter((c) => c[5]).map((c) => c[0]),
    );
    expect(repo.resumable(executionId, 'verification', 'searchapi', true)).toEqual([]);
    expect(repo.resumable(executionId, 'discovery', 'travelpayouts', true)).toEqual([]);
  });
});

describe('markDeparted (spec §8.1 "Before planning … become skipped:departed")', () => {
  it('turns not_run and skipped outcomes departing on or before today into skipped:departed, in both stages', () => {
    const d14 = cell(undefined, undefined, '2026-10-14', '2026-10-28');
    const d15 = cell(undefined, undefined, '2026-10-15', '2026-10-29');
    const d16 = cell(undefined, undefined, '2026-10-16', '2026-10-30');
    const d14b = cell(undefined, EWR, '2026-10-14', '2026-10-28');
    const all = [d14, d15, d16, d14b];
    const { db, executionId, repo } = setup(all);
    repo.seedVerification(executionId, [{ cell: d15, reason: 'top_n' }], all, ['searchapi']);
    rawOutcome(db, executionId, d14b, 'discovery', 'searchapi', { status: 'priced', minPence: 30_000 });
    // changed: d14 discovery not_run and verification skipped:not_selected; d15 discovery and verification not_run;
    // d14b verification skipped:not_selected. d14b discovery is priced and stays.
    expect(repo.markDeparted(executionId, asIsoDate('2026-10-15'))).toBe(5);
    expect(repo.outcomes(executionId, { cells: [d14] }).map((o) => [o.stage, o.status, o.reason])).toEqual([
      ['discovery', 'skipped', 'departed'],
      ['verification', 'skipped', 'departed'],
    ]);
    expect(repo.outcomes(executionId, { cells: [d14b], stage: 'discovery' })[0]?.status).toBe('priced');
    expect(repo.outcomes(executionId, { cells: [d16], stage: 'discovery' })[0]?.status).toBe('not_run');
    expect(repo.rollUps(executionId).get(cellKeyString(d14))?.discovery).toEqual({
      status: 'skipped',
      reason: 'departed',
      minPence: null,
    });
    expect(repo.markDeparted(executionId, asIsoDate('2026-10-15'))).toBe(0);
  });

  it('turns error outcomes departing on or before today into skipped:departed, retryable or not (ruling 1, ssr I1)', () => {
    const d14 = cell(undefined, undefined, '2026-10-14', '2026-10-28');
    const d15 = cell(undefined, undefined, '2026-10-15', '2026-10-29');
    const d16 = cell(undefined, undefined, '2026-10-16', '2026-10-30');
    const { db, executionId, repo } = setup([d14, d15, d16]);
    rawOutcome(db, executionId, d14, 'discovery', 'searchapi', {
      status: 'error',
      reason: 'upstream',
      attempts: 1,
    });
    rawOutcome(db, executionId, d15, 'discovery', 'searchapi', {
      status: 'error',
      reason: 'no-return-legs',
      attempts: 1,
    });
    rawOutcome(db, executionId, d16, 'discovery', 'searchapi', {
      status: 'error',
      reason: 'upstream',
      attempts: 1,
    });
    expect(repo.markDeparted(executionId, asIsoDate('2026-10-15'))).toBe(2);
    expect(
      repo
        .outcomes(executionId, { stage: 'discovery' })
        .map((o) => [o.departureDate, o.status, o.reason, o.attempts]),
    ).toEqual([
      ['2026-10-14', 'skipped', 'departed', 1],
      ['2026-10-15', 'skipped', 'departed', 1],
      ['2026-10-16', 'error', 'upstream', 1],
    ]);
    expect(repo.resumable(executionId, 'discovery', 'searchapi', true).map((c) => c.departureDate)).toEqual([
      '2026-10-16',
    ]);
  });
});
