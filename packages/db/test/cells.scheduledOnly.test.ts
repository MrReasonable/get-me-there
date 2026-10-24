// `skipped:scheduled_only` and its detail through CellsRepo (spec §3, §7 rev 36; decisions 79 and 83; WP16a Task
// 16a.1): written with its detail, read back, rolled up per spec §6.6 row 6, never selected by any resume, and cleared
// when a departed cell is skipped:departed. The worked example only.
import { type CellKey, cellKeyString, fixedClock, type ProviderId } from '@gmt/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { RowRejected } from '../src/internal/validate.js';
import { CellsRepo, retriedOnResume } from '../src/repositories/cells.js';
import { freshDb, T0 } from './helpers/db.js';
import { cell, newExecution, withNights } from './helpers/factories.js';

beforeEach(() => {
  expect.hasAssertions();
});

const day = (n: number): CellKey =>
  cell(
    undefined,
    undefined,
    `2027-05-${String(n).padStart(2, '0')}`,
    `2027-06-${String(n).padStart(2, '0')}`,
  );

function setup(cells: CellKey[], discovery: ProviderId[] = ['camoufox', 'travelpayouts']) {
  const db = freshDb();
  const clock = fixedClock(T0);
  const { execution } = newExecution(db, clock);
  const repo = new CellsRepo(db, clock, { allowSynthetic: false });
  repo.seed(execution.id, cells.map(withNights), discovery);
  return { db, executionId: execution.id, repo };
}

describe('skipped:scheduled_only (spec §3 rev 36)', () => {
  it('setOutcomesForProvider writes the detail with the reason, and outcomes read it back; other rows carry none', () => {
    const { executionId, repo } = setup([day(1), day(2)]);
    expect(
      repo.setOutcomesForProvider(executionId, 'discovery', 'camoufox', ['not_run'], {
        status: 'skipped',
        reason: 'scheduled_only',
        skipDetail: 'catch-up-no-browser',
      }),
    ).toBe(2);
    expect(
      repo
        .outcomes(executionId, { stage: 'discovery' })
        .map((o) => [o.providerId, o.status, o.reason, o.skipDetail]),
    ).toEqual([
      ['camoufox', 'skipped', 'scheduled_only', 'catch-up-no-browser'],
      ['travelpayouts', 'not_run', null, null],
      ['camoufox', 'skipped', 'scheduled_only', 'catch-up-no-browser'],
      ['travelpayouts', 'not_run', null, null],
    ]);
  });

  it('setOutcome writes one cell outside its browser window; the roll-up ranks scheduled_only after provider_unavailable and before departed', () => {
    const { executionId, repo } = setup([day(1)]);
    repo.setOutcome(executionId, day(1), 'discovery', 'camoufox', {
      status: 'skipped',
      reason: 'scheduled_only',
      skipDetail: 'outside-browser-window',
    });
    repo.setOutcome(executionId, day(1), 'discovery', 'travelpayouts', {
      status: 'skipped',
      reason: 'departed',
    });
    expect(repo.rollUps(executionId).get(cellKeyString(day(1)))?.discovery).toEqual({
      status: 'skipped',
      reason: 'scheduled_only',
      minPence: null,
    });
    expect(repo.outcomes(executionId, { providerId: 'camoufox' })[0]?.skipDetail).toBe(
      'outside-browser-window',
    );
  });

  it('refuses scheduled_only without a detail, and a detail with any other reason or status', () => {
    const { executionId, repo } = setup([day(1)]);
    const rule = (fn: () => unknown): string | null => {
      try {
        fn();
        return null;
      } catch (e) {
        if (e instanceof RowRejected) return e.rule;
        throw e;
      }
    };
    expect(
      rule(() =>
        repo.setOutcomesForProvider(executionId, 'discovery', 'camoufox', ['not_run'], {
          status: 'skipped',
          reason: 'scheduled_only',
        }),
      ),
    ).toBe('skip-detail');
    expect(
      rule(() =>
        repo.setOutcomesForProvider(executionId, 'discovery', 'camoufox', ['not_run'], {
          status: 'skipped',
          reason: 'budget',
          skipDetail: 'catch-up-no-browser',
        }),
      ),
    ).toBe('skip-detail');
    expect(
      rule(() =>
        repo.setOutcome(executionId, day(1), 'discovery', 'camoufox', {
          status: 'not_run',
          reason: null,
          skipDetail: 'outside-browser-window',
        }),
      ),
    ).toBe('skip-detail');
    expect(repo.outcomes(executionId).every((o) => o.status === 'not_run' && o.skipDetail === null)).toBe(
      true,
    );
  });

  it('no resume, manual or automatic, ever selects it, and retriedOnResume agrees', () => {
    const { executionId, repo } = setup([day(1), day(2)], ['camoufox']);
    repo.setOutcome(executionId, day(1), 'discovery', 'camoufox', {
      status: 'skipped',
      reason: 'scheduled_only',
      skipDetail: 'catch-up-no-browser',
    });
    for (const manual of [false, true])
      expect(repo.resumable(executionId, 'discovery', 'camoufox', manual)).toEqual([day(2)]);
    const [o] = repo.outcomes(executionId, { cells: [day(1)] });
    if (o === undefined) throw new Error('no outcome');
    expect(retriedOnResume(o, false)).toBe(false);
    expect(retriedOnResume(o, true)).toBe(false);
  });

  it('a departed scheduled_only cell becomes skipped:departed and loses its detail', () => {
    const { executionId, repo } = setup([day(1)], ['camoufox']);
    repo.setOutcome(executionId, day(1), 'discovery', 'camoufox', {
      status: 'skipped',
      reason: 'scheduled_only',
      skipDetail: 'outside-browser-window',
    });
    expect(repo.markDeparted(executionId, day(1).departureDate)).toBe(1);
    expect(repo.outcomes(executionId).map((o) => [o.status, o.reason, o.skipDetail])).toEqual([
      ['skipped', 'departed', null],
    ]);
  });

  it('moving a scheduled_only cell to another skip clears the detail', () => {
    const { executionId, repo } = setup([day(1)], ['camoufox']);
    repo.setOutcome(executionId, day(1), 'discovery', 'camoufox', {
      status: 'skipped',
      reason: 'scheduled_only',
      skipDetail: 'outside-browser-window',
    });
    repo.setOutcomesForProvider(executionId, 'discovery', 'camoufox', ['skipped'], {
      status: 'skipped',
      reason: 'provider_disabled',
    });
    expect(repo.outcomes(executionId).map((o) => [o.reason, o.skipDetail])).toEqual([
      ['provider_disabled', null],
    ]);
  });
});
