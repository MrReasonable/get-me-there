import { fixedClock } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { ERROR_REASONS } from '../src/internal/enums.js';
import { CellsRepo } from '../src/repositories/cells.js';
import { freshDb, T0 } from './helpers/db.js';
import { cell, newExecution, withNights } from './helpers/factories.js';

const day = (n: number) => cell(undefined, undefined, `2027-05-0${n}`, `2027-06-0${n}`);

describe('no-priced-options (spec §5.4, decision 37)', () => {
  it('is an error reason of its own, and neither an automatic nor a manual resume selects it', () => {
    expect(ERROR_REASONS).toContain('no-priced-options');
    const db = freshDb();
    const clock = fixedClock(T0);
    const { execution } = newExecution(db, clock);
    const repo = new CellsRepo(db, clock, { allowSynthetic: false });
    repo.seed(execution.id, [day(1), day(2)].map(withNights), []);
    repo.seedVerification(
      execution.id,
      [
        { cell: day(1), reason: 'top_n' },
        { cell: day(2), reason: 'top_n' },
      ],
      [day(1), day(2)],
      ['searchapi'],
    );
    for (const [c, reason] of [
      [day(1), 'no-priced-options'],
      [day(2), 'upstream'],
    ] as const)
      repo.setOutcome(execution.id, c, 'verification', 'searchapi', {
        status: 'error',
        reason,
        lastError: 'step 1 returned options and none was priced',
        incrementAttempts: true,
      });
    expect(repo.outcomes(execution.id, { cells: [day(1)], stage: 'verification' })[0]?.reason).toBe(
      'no-priced-options',
    );
    for (const manual of [false, true])
      expect(repo.resumable(execution.id, 'verification', 'searchapi', manual)).toEqual([day(2)]);
  });
});
