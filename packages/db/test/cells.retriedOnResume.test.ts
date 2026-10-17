// retriedOnResume is RESUMABLE_SQL as a predicate (plan decision 54): over every status × reason × attempts × manual
// combination, the predicate and the resume query pick the same cells.
import { cellKeyString, fixedClock } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { CellsRepo, retriedOnResume } from '../src/repositories/cells.js';
import { freshDb, T0 } from './helpers/db.js';
import { cell, newExecution, withNights } from './helpers/factories.js';
import { rawOutcome } from './helpers/outcomes.js';

const CASES: Array<{ status: string; reason: string | null; attempts: number }> = [
  { status: 'not_run', reason: null, attempts: 0 },
  { status: 'priced', reason: null, attempts: 1 },
  { status: 'empty', reason: null, attempts: 1 },
  { status: 'skipped', reason: 'budget', attempts: 0 },
  { status: 'skipped', reason: 'provider_disabled', attempts: 0 },
  { status: 'skipped', reason: 'not_selected', attempts: 0 },
  { status: 'error', reason: 'upstream', attempts: 1 },
  { status: 'error', reason: 'upstream', attempts: 3 },
  { status: 'error', reason: 'auth', attempts: 1 },
  { status: 'error', reason: 'quota', attempts: 5 },
  { status: 'error', reason: 'parse', attempts: 1 },
  { status: 'error', reason: 'no-return-legs', attempts: 1 },
  { status: 'error', reason: 'no-priced-options', attempts: 1 },
  { status: 'error', reason: 'fx-unavailable', attempts: 1 },
];

describe('retriedOnResume (spec §7 Resume; plan decision 54)', () => {
  it.each([false, true])('agrees with the resume query (manual %s)', (manual) => {
    const db = freshDb();
    const clock = fixedClock(T0);
    const { execution } = newExecution(db, clock);
    const repo = new CellsRepo(db, clock, { allowSynthetic: false });
    const cells = CASES.map((_, i) =>
      cell(undefined, undefined, `2027-05-${String(i + 1).padStart(2, '0')}`, '2027-06-20'),
    );
    repo.seed(execution.id, cells.map(withNights), ['searchapi']);
    CASES.forEach((c, i) => {
      const at = cells[i];
      if (at !== undefined) rawOutcome(db, execution.id, at, 'discovery', 'searchapi', c);
    });
    const byQuery = new Set(
      repo.resumable(execution.id, 'discovery', 'searchapi', manual).map(cellKeyString),
    );
    const byPredicate = repo
      .outcomes(execution.id)
      .filter((o) => retriedOnResume(o, manual))
      .map(cellKeyString);
    expect(new Set(byPredicate)).toEqual(byQuery);
    expect(byQuery.size).toBe(manual ? 7 : 3); // why: not_run, budget, a young upstream error; manual adds disabled, auth, quota, parse
  });
});
